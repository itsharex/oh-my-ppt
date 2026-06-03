import { useEffect, useMemo, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import {
  useSessionDetailUiStore,
  type SessionWorkspaceTab
} from '@renderer/store'
import { DynamicToolRow } from './toolbar/DynamicToolRow'
import { PrimaryActions } from './toolbar/PrimaryActions'
import { WorkspaceTabs } from './toolbar/WorkspaceTabs'
import type { WorkspaceRibbonActions, WorkspaceRibbonState } from './toolbar/types'

export function WorkspaceRibbon({
  selectedPageKey,
  isGenerating,
  isSavingEdits,
  canUndo,
  canRedo,
  hasPendingEdits,
  actions
}: {
  selectedPageKey: string | null
  isGenerating: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
  actions: WorkspaceRibbonActions
}): React.JSX.Element | null {
  const [isPreviewSettling, setIsPreviewSettling] = useState(false)
  const activeTab = useSessionDetailUiStore((s) => s.workspaceTab)
  const setActiveTab = useSessionDetailUiStore((s) => s.setWorkspaceTab)
  const interactionMode = useSessionDetailUiStore((s) => s.interactionMode)
  const setInteractionMode = useSessionDetailUiStore((s) => s.setInteractionMode)
  const clearSelectedElement = useSessionDetailUiStore((s) => s.clearSelectedElement)
  const setSpeechScriptDialogOpen = useSessionDetailUiStore((s) => s.setSpeechScriptDialogOpen)

  useEffect(() => {
    if (!selectedPageKey) {
      setIsPreviewSettling(false)
      return
    }
    setIsPreviewSettling(true)
    const timer = window.setTimeout(() => {
      setIsPreviewSettling(false)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [selectedPageKey])

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

  if (!selectedPageKey) return null

  const toolbarDisabled = isGenerating || isSavingEdits || isPreviewSettling

  const activateTab = (tab: SessionWorkspaceTab): void => {
    setActiveTab(tab)
    if (tab === 'preview') {
      setInteractionMode('preview')
      setSpeechScriptDialogOpen(false)
      return
    }
    if (tab === 'speech') {
      clearSelectedElement()
      setInteractionMode('preview')
      actions.onOpenSpeechScript()
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
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 px-3 pb-1.5 pt-1 transition-opacity duration-200',
        isPreviewSettling && 'pointer-events-none opacity-0'
      )}
    >
      <div className="actions-tool flex min-w-0 items-center gap-2 px-1.5 py-0.5">
        <PrimaryActions
          disabled={toolbarDisabled}
          isSavingEdits={isSavingEdits}
          canUndo={canUndo}
          canRedo={canRedo}
          hasPendingEdits={hasPendingEdits}
          onBackToSessions={actions.onBackToSessions}
          onSaveCurrentPage={actions.onSaveCurrentPage}
          onUndo={actions.onUndo}
          onRedo={actions.onRedo}
        />
        <WorkspaceTabs activeTab={activeTab} disabled={toolbarDisabled} onActivate={activateTab} />
      </div>

      <DynamicToolRow
        state={state}
        disabled={toolbarDisabled}
        actions={actions}
      />
    </div>
  )
}
