import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  useEditHistoryStore,
  useGenerateStore,
  useSessionDetailRuntimeStore,
  useSessionDetailUiStore,
  type WorkspaceRibbonRegisteredActions
} from '@renderer/store'
import type { SessionWorkspaceTab } from '@renderer/types/session-detail'
import { normalizePagesForSelection } from '../shared'
import type { WorkspaceRibbonState } from '../workspace/toolbar/types'

export function useWorkspaceRibbonActionsRegistration(
  actions: WorkspaceRibbonRegisteredActions
): void {
  const actionsRef = useRef(actions)
  const setWorkspaceRibbonActions = useSessionDetailRuntimeStore(
    (state) => state.setWorkspaceRibbonActions
  )

  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  useEffect(() => {
    const registeredActions: WorkspaceRibbonRegisteredActions = {
      onUndo: () => actionsRef.current.onUndo(),
      onRedo: () => actionsRef.current.onRedo(),
      onSaveCurrentPage: () => actionsRef.current.onSaveCurrentPage(),
      onDiscardAllEdits: () => actionsRef.current.onDiscardAllEdits(),
      onBackToSessions: () => actionsRef.current.onBackToSessions(),
      onAddFromLibrary: (type) => actionsRef.current.onAddFromLibrary(type),
      onAddFromLocal: (type) => actionsRef.current.onAddFromLocal(type),
      onAddText: () => actionsRef.current.onAddText(),
      onAddArtText: (templateId) => actionsRef.current.onAddArtText(templateId)
    }
    setWorkspaceRibbonActions(registeredActions)
    return () => setWorkspaceRibbonActions(null)
  }, [setWorkspaceRibbonActions])
}

export function useWorkspaceRibbonController(isSavingEdits: boolean): {
  selectedPageKey: string | null
  state: WorkspaceRibbonState
  activateTab: (tab: SessionWorkspaceTab) => void
} {
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const activeTab = useSessionDetailUiStore((state) => state.workspaceTab)
  const setActiveTab = useSessionDetailUiStore((state) => state.setWorkspaceTab)
  const interactionMode = useSessionDetailUiStore((state) => state.interactionMode)
  const setInteractionMode = useSessionDetailUiStore((state) => state.setInteractionMode)
  const clearSelectedElement = useSessionDetailUiStore((state) => state.clearSelectedElement)
  const setSpeechScriptDialogOpen = useSessionDetailUiStore(
    (state) => state.setSpeechScriptDialogOpen
  )
  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )

  const selectedPageKey = selectedPage?.htmlPath
    ? `${selectedPage.pageId}:${selectedPage.htmlPath}`
    : null
  const pageId = selectedPage?.pageId
  const canUndo = useEditHistoryStore((state) => state.canUndo(pageId))
  const canRedo = useEditHistoryStore((state) => state.canRedo(pageId))
  const hasPendingEdits = useEditHistoryStore((state) => state.hasPendingEdits(pageId))

  const activateTab = useCallback(
    (tab: SessionWorkspaceTab): void => {
      setActiveTab(tab)
      if (tab === 'preview') {
        setInteractionMode('preview')
        setSpeechScriptDialogOpen(false)
        return
      }
      if (tab === 'speech') {
        clearSelectedElement()
        setInteractionMode('preview')
        setSpeechScriptDialogOpen(true)
        return
      }
      if (tab === 'ai') {
        clearSelectedElement()
        setInteractionMode('ai-inspect')
        setSpeechScriptDialogOpen(false)
        return
      }
      if (interactionMode !== 'edit') {
        setInteractionMode('edit')
      }
      setSpeechScriptDialogOpen(false)
    },
    [
      clearSelectedElement,
      interactionMode,
      setActiveTab,
      setInteractionMode,
      setSpeechScriptDialogOpen
    ]
  )

  const state: WorkspaceRibbonState = useMemo(
    () => ({
      isGenerating,
      isSavingEdits,
      canUndo,
      canRedo,
      hasPendingEdits,
      activeTab
    }),
    [activeTab, canRedo, canUndo, hasPendingEdits, isGenerating, isSavingEdits]
  )

  return {
    selectedPageKey,
    state,
    activateTab
  }
}
