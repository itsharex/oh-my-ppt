import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import log from 'electron-log/main.js'
import type {
  GeneratedImageAsset,
  ImageGenerationHistoryRecord,
  ImageModelProvider
} from '@shared/image-generation'
import type { IpcContext } from '../context'
import { readAppLocale, uiText } from '../config/locale-utils'
import { allowLocalAssetRoot } from '../io/assets-handlers'
import { resolveImageGenerationProvider } from '../../image-generation/providers'
import type { ResolvedImageModelConfig } from '../../image-generation/types'

type ImageRunState = {
  runId: string
  sessionId: string
  pageId: string
  progress: number
  label: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  abortController: AbortController
  updatedAt: number
}

const imageRunStates = new Map<string, ImageRunState>()

const VALID_IMAGE_PROVIDERS = [
  'jimeng',
  'jimeng4',
  'agnes',
  'siliconflow'
] as const

const resolveProvider = (provider: unknown): ImageModelProvider => {
  if (VALID_IMAGE_PROVIDERS.includes(provider as ImageModelProvider)) {
    return provider as ImageModelProvider
  }
  throw new Error('Unsupported image provider')
}

const readJsonObject = (value: unknown): Record<string, unknown> => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const readConfigString = (config: ResolvedImageModelConfig, key: string): string => {
  const value = config.modelConfig[key]
  return typeof value === 'string' ? value.trim() : ''
}

const resolveDisplayModel = (config: ResolvedImageModelConfig): string =>
  readConfigString(config, 'model') || readConfigString(config, 'reqKey') || config.provider

const resolveImageModelConfig = async (
  ctx: IpcContext,
  modelConfigId?: string
): Promise<ResolvedImageModelConfig> => {
  const raw =
    modelConfigId && modelConfigId.trim().length > 0
      ? await ctx.db.getImageModelConfig(modelConfigId.trim())
      : await ctx.db.getActiveImageModelConfig()
  if (!raw) throw new Error('请先在设置中配置并启用生图模型。')
  return {
    id: raw.id,
    name: raw.name,
    provider: resolveProvider(raw.provider),
    active: raw.active === 1,
    modelConfig: readJsonObject(ctx.decryptApiKey(raw.modelConfig || '{}'))
  }
}

const resolvePageContext = async (
  ctx: IpcContext,
  sessionId: string,
  pageId: string
): Promise<{ pageId: string; title: string; contentOutline: string; htmlPath: string }> => {
  const pages = await ctx.db.listSessionPages(sessionId)
  const page = pages.find(
    (item) => item.id === pageId || item.file_slug === pageId || item.legacy_page_id === pageId
  )
  if (!page) throw new Error('请先选择一个可用页面。')
  const snapshots = await ctx.db.listLatestGenerationPageSnapshot(sessionId)
  const snapshot = snapshots.find(
    (item) => item.page_id === page.id || item.page_id === page.file_slug || item.page_id === page.legacy_page_id
  )
  return {
    pageId: page.id,
    title: page.title || snapshot?.title || `Page ${page.page_number}`,
    contentOutline: snapshot?.content_outline || '',
    htmlPath: page.html_path
  }
}

const sanitizeExt = (extension: string): string =>
  /^\.[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : '.png'

export function registerImageGenerationHandlers(ctx: IpcContext): void {
  ipcMain.handle('images:generate', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (!sessionId) throw new Error(uiText(locale, '会话 ID 不能为空。', 'Session ID is required.'))
    if (!pageId) throw new Error(uiText(locale, '请先选择页面。', 'Select a page first.'))
    if (!prompt) throw new Error(uiText(locale, '请先填写图片描述。', 'Enter an image prompt first.'))

    const modelConfig = await resolveImageModelConfig(
      ctx,
      typeof record.modelConfigId === 'string' ? record.modelConfigId : undefined
    )
    const pageContext = await resolvePageContext(ctx, sessionId, pageId)
    const count =
      typeof record.count === 'number' && record.count > 0
        ? Math.min(Math.floor(record.count), 4)
        : 1
    const size = typeof record.size === 'string' && record.size.trim() ? record.size.trim() : '16:9'
    const displayModel = resolveDisplayModel(modelConfig)
    const runId = nanoid(12)
    const abortController = new AbortController()
    const startedAt = Date.now()
    imageRunStates.set(sessionId, {
      runId,
      sessionId,
      pageId: pageContext.pageId,
      progress: 5,
      label: uiText(locale, '准备生图', 'Preparing image generation'),
      status: 'running',
      abortController,
      updatedAt: Date.now()
    })

    try {
      log.info('[images:generate] start', {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        requestedPageId: pageId,
        pageTitle: pageContext.title,
        modelConfigId: modelConfig.id,
        modelConfigName: modelConfig.name,
        provider: modelConfig.provider,
        model: displayModel,
        count,
        size,
        promptLength: prompt.length,
        negativePromptLength:
          typeof record.negativePrompt === 'string' ? record.negativePrompt.length : 0,
        hasSeed: typeof record.seed === 'number'
      })
      const adapter = resolveImageGenerationProvider(modelConfig.provider)
      const results = await adapter.generate(modelConfig, {
        prompt,
        count,
        size,
        negativePrompt: typeof record.negativePrompt === 'string' ? record.negativePrompt : undefined,
        seed: typeof record.seed === 'number' ? record.seed : undefined,
        signal: abortController.signal
      })
      log.info('[images:generate] provider returned', {
        runId,
        provider: modelConfig.provider,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 80,
        label: uiText(locale, '正在保存图片', 'Saving images'),
        status: 'running',
        abortController,
        updatedAt: Date.now()
      })
      const projectDir = await ctx.resolveSessionProjectDir(sessionId)
      const imagesDir = path.join(projectDir, 'images')
      log.info('[images:generate] save start', {
        runId,
        imagesDir,
        resultCount: results.length
      })
      await fs.promises.mkdir(imagesDir, { recursive: true })
      allowLocalAssetRoot(imagesDir)
      const createdAt = Math.floor(Date.now() / 1000)
      const assets: GeneratedImageAsset[] = []
      for (const result of results) {
        const id = nanoid(10)
        const extension = sanitizeExt(result.extension)
        const fileName = `${ctx.toSafeAssetBaseName(`generated-${pageContext.title}`)}-${id}${extension}`
        const absolutePath = path.join(imagesDir, fileName)
        await fs.promises.writeFile(absolutePath, result.bytes)
        const stat = await fs.promises.stat(absolutePath)
        log.info('[images:generate] asset saved', {
          runId,
          assetId: id,
          fileName,
          mimeType: result.mimeType,
          size: stat.size
        })
        assets.push({
          id,
          fileName,
          originalName: fileName,
          relativePath: `./images/${fileName}`,
          absolutePath,
          mimeType: result.mimeType,
          size: stat.size,
          prompt,
          modelConfigId: modelConfig.id,
          provider: modelConfig.provider,
          model: displayModel,
          pageId: pageContext.pageId,
          createdAt
        })
      }
      const historyId = await ctx.db.insertImageGenerationHistory({
        sessionId,
        pageId: pageContext.pageId,
        prompt,
        imagePaths: assets.map((asset) => asset.relativePath),
        modelConfigId: modelConfig.id,
        provider: modelConfig.provider,
        model: displayModel,
        createdAt
      })
      const history: ImageGenerationHistoryRecord = {
        id: historyId,
        sessionId,
        pageId: pageContext.pageId,
        prompt,
        imagePaths: assets.map((asset) => asset.relativePath),
        assets,
        modelConfigId: modelConfig.id,
        provider: modelConfig.provider,
        model: displayModel,
        createdAt
      }
      log.info('[images:generate] history saved', {
        runId,
        historyId,
        imagePathCount: history.imagePaths.length
      })
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 100,
        label: uiText(locale, '生图完成', 'Image generation completed'),
        status: 'completed',
        abortController,
        updatedAt: Date.now()
      })
      log.info('[images:generate] completed', {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        assetCount: assets.length,
        elapsedMs: Date.now() - startedAt
      })
      return { history }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const wasCancelled = abortController.signal.aborted
      const logPayload = {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        provider: modelConfig.provider,
        message,
        elapsedMs: Date.now() - startedAt
      }
      if (wasCancelled) {
        log.warn('[images:generate] cancelled', logPayload)
      } else {
        log.error('[images:generate] failed', logPayload)
      }
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 100,
        label: wasCancelled ? uiText(locale, '已取消生图', 'Image generation cancelled') : message,
        status: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        abortController,
        updatedAt: Date.now()
      })
      throw error
    }
  })

  ipcMain.handle('images:cancel', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return { success: false }
    const state = imageRunStates.get(sessionId.trim())
    if (!state || state.status !== 'running') return { success: false }
    log.warn('[images:cancel] abort requested', {
      runId: state.runId,
      sessionId: state.sessionId,
      pageId: state.pageId,
      progress: state.progress
    })
    state.abortController.abort()
    return { success: true }
  })

  ipcMain.handle('images:getState', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return null
    const state = imageRunStates.get(sessionId.trim())
    if (!state) return null
    return {
      runId: state.runId,
      sessionId: state.sessionId,
      pageId: state.pageId,
      progress: state.progress,
      label: state.label,
      status: state.status,
      error: state.error || null,
      updatedAt: state.updatedAt
    }
  })
}
