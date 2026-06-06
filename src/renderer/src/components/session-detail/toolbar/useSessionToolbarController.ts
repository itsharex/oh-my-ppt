import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useGenerateStore,
  useSessionDetailUiStore,
  useSessionStore,
  useTemplateStore,
  useToastStore
} from '@renderer/store'
import { useT } from '@renderer/i18n'
import { normalizePagesForSelection } from '../shared/pageUtils'
import { useSessionExportActions } from '../hooks/useSessionExportActions'

export function useSessionToolbarController(sessionId: string) {
  const t = useT()
  const navigate = useNavigate()
  const currentSession = useSessionStore((state) => state.currentSession)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const isManagingPages = useSessionDetailUiStore((state) => state.isManagingPages)
  const setHistoryDialogOpen = useSessionDetailUiStore((state) => state.setHistoryDialogOpen)
  const { createTemplateFromSession } = useTemplateStore()
  const { success: toastSuccess, error: toastError } = useToastStore()
  const exportActions = useSessionExportActions(sessionId)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)

  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )
  const sessionStatus =
    currentSession && typeof (currentSession as { status?: unknown }).status === 'string'
      ? String((currentSession as { status?: unknown }).status)
      : ''
  const historyDisabled =
    isGenerating ||
    isAddingPage ||
    isRetryingSinglePage ||
    isManagingPages ||
    sessionStatus === 'active'

  const handleSaveTemplate = async (payload: {
    name: string
    description: string
    tags: string[]
  }): Promise<void> => {
    if (!sessionId || savingTemplate) return
    setSavingTemplate(true)
    try {
      await createTemplateFromSession({
        sessionId,
        ...payload
      })
      toastSuccess(t('sessionDetail.templateSaved'), {
        action: {
          label: t('sessionDetail.viewTemplates'),
          onClick: () => navigate('/templates')
        }
      })
      setSaveTemplateOpen(false)
    } catch (err) {
      toastError(t('sessionDetail.templateSaveFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setSavingTemplate(false)
    }
  }

  return {
    hasPages: pages.length > 0,
    isGenerating,
    historyDisabled,
    canPreview: Boolean(selectedPage?.htmlPath || pages[0]?.htmlPath),
    canRevealFile: Boolean(selectedPage?.htmlPath),
    sessionTitle: currentSession?.title || '',
    saveTemplateOpen,
    savingTemplate,
    defaultTemplateName: currentSession?.title || '未命名模板',
    setSaveTemplateOpen,
    handleSaveTemplate,
    exportActions,
    openHistory: () => {
      if (!historyDisabled) setHistoryDialogOpen(true)
    }
  }
}
