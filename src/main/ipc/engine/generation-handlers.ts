import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import type { SessionStatus } from '../../db/schema'
import { createEmitAssistantMessage } from '../generation/generation-utils'
import { executeDeckGeneration, resolveDeckContext } from '../generation/deck-flow'
import {
  executeTemplateDeckGeneration,
  resolveTemplateDeckContext
} from '../generation/template-deck-flow'
import { executeEditGeneration, resolveEditContext } from '../generation/edit-flow'
import { executeDeckAllPageEditGeneration } from '../generation/edit-deck-allpage-flow'
import { executeRetryFailedPages, resolveRetryContext } from '../generation/retry-flow'
import type { DeckContext, EditContext, RetryContext } from '../generation/types'
import { resolveAddPageContext, executeAddPageGeneration, type AddPageContext } from '../generation/add-page-flow'
import { resolveRetrySinglePageContext, executeRetrySinglePageGeneration, type RetrySinglePageContext } from '../generation/retry-single-page-flow'
import { finalizeGenerationFailure } from '../generation/finalization'

function normalizeRestoredSessionStatus(status: unknown): SessionStatus {
  return status === 'completed' || status === 'failed' || status === 'archived' ? status : 'active'
}

type StartingSessionRun = {
  controller: AbortController
  operation: string
  startedAt: number
}

export function registerGenerationHandlers(ctx: IpcContext): void {
  const {
    db,
    agentManager,
    sessionRunStates,
    pruneFinishedSessionRunStates,
    beginSessionRunState,
    emitGenerateChunk
  } = ctx
  const startingSessionRuns = new Map<string, StartingSessionRun>()
  const emitAssistant = createEmitAssistantMessage(db, emitGenerateChunk)

  const reserveStartingSessionRun = (
    operation: string,
    sessionId: string
  ):
    | { alreadyRunning: true; runId?: string }
    | { alreadyRunning: false; startingRun: StartingSessionRun } => {
    const runningState = sessionRunStates.get(sessionId)
    if (runningState?.status === 'running') {
      log.info(`[${operation}] attach to existing run`, {
        sessionId,
        runId: runningState.runId
      })
      return { alreadyRunning: true, runId: runningState.runId }
    }
    const existingStartingRun = startingSessionRuns.get(sessionId)
    if (existingStartingRun) {
      log.info(`[${operation}] attach to starting run`, {
        sessionId,
        operation: existingStartingRun.operation,
        startedAt: existingStartingRun.startedAt
      })
      return { alreadyRunning: true }
    }
    const startingRun = {
      controller: new AbortController(),
      operation,
      startedAt: Date.now()
    }
    startingSessionRuns.set(sessionId, startingRun)
    return { alreadyRunning: false, startingRun }
  }

  const releaseStartingSessionRun = (
    sessionId: string,
    startingRun: StartingSessionRun | null
  ): void => {
    if (!startingRun) return
    if (startingSessionRuns.get(sessionId) === startingRun) {
      startingSessionRuns.delete(sessionId)
    }
  }

  const assertStartingRunNotCanceled = (startingRun: StartingSessionRun | null): void => {
    if (startingRun?.controller.signal.aborted) {
      throw new Error('生成已取消')
    }
  }

  const logPreContextFailure = (operation: string, sessionId: string, error: unknown): void => {
    log.error(`[${operation}] failed before context`, {
      sessionId,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  ipcMain.handle('generate:state', async (_event, rawSessionId: unknown) => {
    pruneFinishedSessionRunStates()
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const activeState = sessionRunStates.get(sessionId)
    if (activeState) {
      return {
        sessionId,
        runId: activeState.runId,
        status: activeState.status,
        hasActiveRun: activeState.status === 'running',
        progress: activeState.progress,
        totalPages: activeState.totalPages,
        events: activeState.events,
        error: activeState.error,
        startedAt: activeState.startedAt,
        updatedAt: activeState.updatedAt
      }
    }

    const session = await db.getSession(sessionId)
    const sessionRecord = (session || {}) as Record<string, unknown>
    const sessionStatus = String(sessionRecord.status || 'active')
    const normalizedStatus =
      sessionStatus === 'completed' ? 'completed' : sessionStatus === 'failed' ? 'failed' : 'idle'
    const pageCount = Number(sessionRecord.page_count ?? sessionRecord.pageCount ?? 1) || 1
    return {
      sessionId,
      runId: null,
      status: normalizedStatus,
      hasActiveRun: false,
      progress: normalizedStatus === 'completed' ? 100 : 0,
      totalPages: Math.max(1, Math.floor(pageCount)),
      events: [],
      error: null,
      startedAt: null,
      updatedAt: null
    }
  })

  ipcMain.handle('generate:start', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const startingReservation = requestedSessionId
      ? reserveStartingSessionRun('generate:start', requestedSessionId)
      : null
    if (startingReservation?.alreadyRunning) {
      return { success: true, runId: startingReservation.runId, alreadyRunning: true }
    }
    const startingRun =
      startingReservation?.alreadyRunning === false ? startingReservation.startingRun : null

    let context: DeckContext | EditContext | null = null
    try {
      const requestedType =
        payload &&
        typeof payload === 'object' &&
        (payload as { type?: unknown }).type === 'page'
          ? 'page'
          : 'deck'
      const requestedChatType =
        payload &&
        typeof payload === 'object' &&
        (payload as { chatType?: unknown }).chatType === 'main'
          ? 'main'
          : 'page'
      const isDeckAllPageEdit = requestedType === 'page' && requestedChatType === 'main'
      context =
        requestedType === 'page'
          ? await resolveEditContext(ctx, event, payload)
          : await resolveDeckContext(ctx, event, payload)
      assertStartingRunNotCanceled(startingRun)
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: context.effectiveMode,
        totalPages: context.totalPages,
        previousSessionStatus: context.previousSessionStatus
      })
      if (isDeckAllPageEdit && context.effectiveMode === 'edit') {
        await executeDeckAllPageEditGeneration(ctx, emitAssistant, context)
      } else if (context.effectiveMode === 'edit') {
        await executeEditGeneration(ctx, emitAssistant, context)
      } else {
        await executeDeckGeneration(ctx, emitAssistant, context)
      }
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:start', requestedSessionId, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        releaseStartingSessionRun(requestedSessionId, startingRun)
      }
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:startTemplate', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const startingReservation = requestedSessionId
      ? reserveStartingSessionRun('generate:startTemplate', requestedSessionId)
      : null
    if (startingReservation?.alreadyRunning) {
      return { success: true, runId: startingReservation.runId, alreadyRunning: true }
    }
    const startingRun =
      startingReservation?.alreadyRunning === false ? startingReservation.startingRun : null

    let context: Awaited<ReturnType<typeof resolveTemplateDeckContext>> | null = null
    try {
      context = await resolveTemplateDeckContext(ctx, event, payload)
      assertStartingRunNotCanceled(startingRun)
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: context.effectiveMode,
        totalPages: context.totalPages,
        previousSessionStatus: context.previousSessionStatus
      })
      await executeTemplateDeckGeneration(ctx, emitAssistant, context)
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:startTemplate', requestedSessionId, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        releaseStartingSessionRun(requestedSessionId, startingRun)
      }
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retryFailedPages', async (event, payload) => {
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const startingReservation = requestedSessionId
      ? reserveStartingSessionRun('generate:retryFailedPages', requestedSessionId)
      : null
    if (startingReservation?.alreadyRunning) {
      return { success: true, runId: startingReservation.runId, alreadyRunning: true }
    }

    const startingRun =
      startingReservation?.alreadyRunning === false ? startingReservation.startingRun : null
    let context: RetryContext | null = null
    try {
      context = await resolveRetryContext(ctx, event, payload)
      assertStartingRunNotCanceled(startingRun)
      const retryTotalPages = Math.max(
        1,
        (await db.listLatestGenerationPageSnapshot(context.sessionId)).filter(
          (page) => page.status !== 'completed'
        ).length || context.totalPages
      )
      assertStartingRunNotCanceled(startingRun)
      beginSessionRunState({
        sessionId: context.sessionId,
        runId: context.runId,
        mode: 'retry',
        previousSessionStatus: context.previousSessionStatus,
        totalPages: retryTotalPages
      })
      await executeRetryFailedPages(ctx, emitAssistant, context)
      return { success: true, runId: context.runId }
    } catch (error) {
      if (context) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:retryFailedPages', requestedSessionId, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        releaseStartingSessionRun(requestedSessionId, startingRun)
      }
      if (context) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:addPage', async (_event, payload) => {
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    const userMsg = typeof addPagePayload.userMessage === 'string' ? addPagePayload.userMessage.trim() : ''
    if (!userMsg) {
      throw new Error('userMessage is required for addPage')
    }

    const startingReservation = reserveStartingSessionRun('generate:addPage', requestedSessionId)
    if (startingReservation.alreadyRunning) {
      return { success: true, runId: startingReservation.runId, alreadyRunning: true }
    }

    const startingRun = startingReservation.startingRun
    let addPageCtx: AddPageContext | null = null
    try {
      const insertAfter = Number(addPagePayload.insertAfterPageNumber) || 0

      // Resolve context independently — no shared resolveGenerationContext
      const modelConfigId =
        typeof addPagePayload.modelConfigId === 'string'
          ? addPagePayload.modelConfigId.trim()
          : undefined
      addPageCtx = await resolveAddPageContext(
        ctx,
        requestedSessionId,
        userMsg,
        insertAfter,
        modelConfigId
      )
      assertStartingRunNotCanceled(startingRun)

      // Persist user message
      await db.addMessage(addPageCtx.sessionId, {
        role: 'user',
        content: userMsg,
        type: 'text',
        chat_scope: 'main' as const,
        run_model: addPageCtx.runModel
      })
      assertStartingRunNotCanceled(startingRun)

      beginSessionRunState({
        sessionId: addPageCtx.sessionId,
        runId: addPageCtx.runId,
        mode: 'addPage',
        previousSessionStatus: addPageCtx.previousSessionStatus,
        totalPages: 1
      })

      await executeAddPageGeneration(ctx, addPageCtx)
      return { success: true, runId: addPageCtx.runId }
    } catch (error) {
      if (addPageCtx) {
        await finalizeGenerationFailure(ctx, addPageCtx, error)
      } else {
        logPreContextFailure('generate:addPage', requestedSessionId, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        releaseStartingSessionRun(requestedSessionId, startingRun)
      }
      if (addPageCtx) {
        agentManager.removeSession(addPageCtx.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retrySinglePage', async (_event, payload) => {
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    const requestedPageId =
      typeof addPagePayload.pageId === 'string' ? addPagePayload.pageId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    if (!requestedPageId) {
      throw new Error('pageId 不能为空')
    }

    const startingReservation = reserveStartingSessionRun(
      'generate:retrySinglePage',
      requestedSessionId
    )
    if (startingReservation.alreadyRunning) {
      return { success: true, runId: startingReservation.runId, alreadyRunning: true }
    }

    const startingRun = startingReservation.startingRun
    let retryCtx: RetrySinglePageContext | null = null
    try {
      const modelConfigId =
        typeof addPagePayload.modelConfigId === 'string'
          ? addPagePayload.modelConfigId.trim()
          : undefined
      retryCtx = await resolveRetrySinglePageContext(
        ctx,
        requestedSessionId,
        requestedPageId,
        modelConfigId
      )
      assertStartingRunNotCanceled(startingRun)

      beginSessionRunState({
        sessionId: retryCtx.sessionId,
        runId: retryCtx.runId,
        mode: 'retrySinglePage',
        previousSessionStatus: retryCtx.previousSessionStatus,
        totalPages: 1
      })

      await executeRetrySinglePageGeneration(ctx, retryCtx)
      return { success: true, runId: retryCtx.runId }
    } catch (error) {
      if (retryCtx) {
        await finalizeGenerationFailure(ctx, retryCtx, error)
      } else {
        logPreContextFailure('generate:retrySinglePage', requestedSessionId, error)
      }
      throw error
    } finally {
      if (requestedSessionId) {
        releaseStartingSessionRun(requestedSessionId, startingRun)
      }
      if (retryCtx) {
        agentManager.removeSession(retryCtx.sessionId)
      }
    }
  })

  ipcMain.handle('generate:cancel', async (_event, sessionId) => {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : ''
    const cancelSessionId = normalizedSessionId || String(sessionId || '')
    if (!cancelSessionId) return { success: true }
    const startingRun = normalizedSessionId ? startingSessionRuns.get(normalizedSessionId) : null
    if (startingRun && !startingRun.controller.signal.aborted) {
      startingRun.controller.abort()
      log.info('[generate:cancel] cancel starting run', {
        sessionId: cancelSessionId,
        operation: startingRun.operation
      })
    }
    agentManager.cancelSession(cancelSessionId)
    const activeState = sessionRunStates.get(cancelSessionId)
    if (activeState?.status === 'running') {
      emitGenerateChunk(cancelSessionId, {
        type: 'run_error',
        payload: {
          runId: activeState.runId,
          message: '生成已取消'
        }
      })
      await db.updateSessionStatus(
        cancelSessionId,
        normalizeRestoredSessionStatus(activeState.previousSessionStatus)
      )
    }
    return { success: true }
  })
}
