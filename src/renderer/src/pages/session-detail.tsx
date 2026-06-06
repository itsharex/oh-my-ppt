import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ipc } from '@renderer/lib/ipc'
import type {
  EditableElementSnapshot,
  EditModeMovePayload,
  EditSelectionPayload
} from '../components/preview/edit-mode-script'
import type { PreviewIframeHandle } from '../components/preview/PreviewIframe'
import { TooltipProvider } from '../components/ui/Tooltip'
import { MessagePanel } from '../components/session-detail/ai-panel'
import { PageSidebar } from '../components/session-detail/sidebar'
import { PreviewStage } from '../components/session-detail/preview'
import {
  ElementInspectorPanel,
  type ElementEditDraft
} from '../components/session-detail/element-inspector'
import {
  EmptyEditWorkbenchPanel,
  WorkspaceRibbon
} from '../components/session-detail/workspace'
import { SessionToolbar } from '../components/session-detail/toolbar'
import { SpeechScriptDrawer } from '../components/session-detail/speech'
import {
  AddBlankPageDialog,
  AddPageDialog,
  AssetPickerDialog,
  DeleteElementDialog,
  DeletePageDialog,
  HistoryDialog,
  PageProgressOverlay,
  PageTitleEditDialog
} from '../components/session-detail/modal'
import {
  buildImageMessageCacheKey,
  imageHistoryToMessages,
  mergeImageMessages,
  normalizePagesForSelection,
  type ChatType
} from '../components/session-detail/shared'
import {
  buildSelectedElementFromSnapshot,
  EMPTY_ELEMENT_DRAFT,
  fontSizeToNumber,
  normalizeFontWeight,
  normalizeTextAlign,
  opacityToInput,
  rgbToHex
} from '../components/session-detail/element-inspector/elementEditUtils'
import {
  editTargetMatchesDeletedSelector,
  useEditHistoryStore,
  useGenerateStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore,
  type ImageGenerationMessage
} from '../store'
import type { GenerateChunkEvent } from '@shared/generation.js'
import type { GeneratedImageAsset } from '@shared/image-generation.js'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'
import { buildArtTextHtmlFragment, type ArtTextTemplateId } from '../lib/artTextTemplates'
import { escapeHtmlText } from '../lib/utils'
import { useT } from '../i18n'
import { nanoid } from 'nanoid'

const PPT_PAGE_WIDTH = 1600
const PPT_PAGE_HEIGHT = 900
const ADDED_ELEMENT_EDGE_PADDING = 20
const ADDED_TEXT_WIDTH = 420
const ADDED_TEXT_MIN_HEIGHT = 96
const ADDED_TEXT_BASE_LEFT = 590
const ADDED_TEXT_BASE_TOP = 360
const ADDED_TEXT_OFFSET_STEP = 28
const ADDED_ART_TEXT_WIDTH = 560
const ADDED_ART_TEXT_MIN_HEIGHT = 130
const ADDED_MEDIA_OFFSET_STEP = 30

type ElementPropertyStylePatch = {
  zIndex?: number
  opacity?: number
  backgroundColor?: string
  color?: string
  fontSize?: string
  fontWeight?: string
  textAlign?: string
  objectFit?: string
}

type ElementPropertyAttrsPatch = {
  alt?: string
  poster?: string
  controls?: boolean
  muted?: boolean
  loop?: boolean
  autoplay?: boolean
  playsInline?: boolean
  preload?: string
}

type ElementPropertyPatch = {
  html?: string
  text?: string
  textTarget?: EditSelectionPayload['textTarget']
  style?: ElementPropertyStylePatch
  attrs?: ElementPropertyAttrsPatch
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .replace(/</g, '\\3C ')
    .replace(/>/g, '\\3E ')
}

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const t = useT()
  const isMac = window.electron?.process?.platform === 'darwin'
  const {
    currentSession,
    currentGeneratedPages,
    loadSession,
    loadMessages,
    setMessages,
    addMessage,
    resetRuntimeState
  } = useSessionStore()
  const { isGenerating, updateProgress, cancelGeneration, progress, currentPages, error } =
    useGenerateStore()
  const chatType = useSessionDetailUiStore((state) => state.chatType)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const workspaceTab = useSessionDetailUiStore((state) => state.workspaceTab)
  const setChatType = useSessionDetailUiStore((state) => state.setChatType)
  const resetForPageChange = useSessionDetailUiStore((state) => state.resetForPageChange)
  const resetForSessionChange = useSessionDetailUiStore((state) => state.resetForSessionChange)
  const assetPickerOpen = useSessionDetailUiStore((state) => state.assetPickerOpen)
  const assetPickerType = useSessionDetailUiStore((state) => state.assetPickerType)
  const setAssetPickerOpen = useSessionDetailUiStore((state) => state.setAssetPickerOpen)
  const speechScriptDialogOpen = useSessionDetailUiStore((state) => state.speechScriptDialogOpen)
  const activeChatRef = useRef<{ chatType: ChatType; pageId?: string }>({ chatType: 'page' })
  const editHistory = useEditHistoryStore()
  const [isSavingEdits, setIsSavingEdits] = useState(false)
  const [textSelection, setTextSelection] = useState<EditSelectionPayload | null>(null)
  const [textDraft, setTextDraft] = useState<ElementEditDraft>(EMPTY_ELEMENT_DRAFT)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pendingDeleteSelector, setPendingDeleteSelector] = useState<string | null>(null)
  const previewIframeRef = useRef<PreviewIframeHandle | null>(null)
  const sendingMessageRef = useRef(false)
  const {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
    warning: toastWarning
  } = useToastStore()

  const orderedPages = useMemo(
    () => [...currentPages].sort((a, b) => a.pageNumber - b.pageNumber),
    [currentPages]
  )

  const normalizedOrderedPages = useMemo(
    () => normalizePagesForSelection(orderedPages),
    [orderedPages]
  )

  const selectedPage = useMemo(
    () =>
      normalizedOrderedPages.find((page) => page.id === selectedPageId) ??
      normalizedOrderedPages[0] ??
      null,
    [normalizedOrderedPages, selectedPageId]
  )

  useEffect(() => {
    resetForPageChange()
    window.setTimeout(() => {
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
    }, 0)
  }, [resetForPageChange, selectedPage?.pageId])

  const canEditInSessionDetail = useMemo(() => {
    if (!currentSession) return false
    return getEditorGate(currentSession).canEdit
  }, [currentSession])
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setMessages([])
    useGenerateStore.getState().setPages([])
    resetForSessionChange()
    void (async () => {
      try {
        await ipc.migratePageOutlinesToSourceSkeletons({ sessionId: id })
      } catch (err) {
        console.warn('[session] migrate page outlines failed', err)
      }
      if (!cancelled) {
        await loadSession(id)
      }
    })()
    // Cleanup on unmount (leaving session-detail)
    return () => {
      cancelled = true
      useGenerateStore.getState().reset()
      useSessionDetailUiStore.getState().resetForSessionChange()
      useEditHistoryStore.getState().clear()
    }
  }, [id, loadSession, resetForSessionChange, setMessages])

  useEffect(() => {
    useGenerateStore.getState().setPages(currentGeneratedPages)
  }, [currentGeneratedPages])

  useEffect(() => {
    if (!id || !currentSession) return
    // Don't redirect during addPage / retrySinglePage — we're already on the editor page
    if (
      useSessionDetailUiStore.getState().isAddingPage ||
      useSessionDetailUiStore.getState().isRetryingSinglePage
    )
      return
    if (!canEditInSessionDetail) {
      const metadata = parseSessionMetadata(currentSession.metadata)
      navigate(
        metadata.source === 'template'
          ? `/sessions/${id}/template-generating`
          : `/sessions/${id}/generating`,
        { replace: true }
      )
    }
  }, [canEditInSessionDetail, currentSession, id, navigate])

  useEffect(() => {
    if (!id) return
    const saved = window.localStorage.getItem(`workbench:selected-page-id:${id}`)
    if (!saved) return
    useSessionDetailUiStore.getState().setSelectedPageId(saved)
  }, [id])

  useEffect(() => {
    // Skip auto-select during addPage / retrySinglePage — selection managed explicitly
    if (
      useSessionDetailUiStore.getState().isAddingPage ||
      useSessionDetailUiStore.getState().isRetryingSinglePage
    )
      return

    if (normalizedOrderedPages.length === 0) {
      useSessionDetailUiStore.getState().setSelectedPageId(null)
      return
    }

    if (selectedPageId && normalizedOrderedPages.some((page) => page.id === selectedPageId)) {
      return
    }

    useSessionDetailUiStore.getState().setSelectedPageId(normalizedOrderedPages[0].id)
  }, [normalizedOrderedPages, selectedPageId])

  useEffect(() => {
    if (!id || !selectedPageId) return
    window.localStorage.setItem(`workbench:selected-page-id:${id}`, String(selectedPageId))
  }, [id, selectedPageId])

  useEffect(() => {
    setChatType('page')
  }, [id, setChatType])

  useEffect(() => {
    const pageId = chatType === 'page' ? selectedPage?.id : undefined
    activeChatRef.current = { chatType, pageId }
  }, [chatType, selectedPage?.id])

  useEffect(() => {
    if (!id) return
    if (chatType === 'page' && !selectedPage?.id) {
      void loadMessages({
        sessionId: id,
        chatType: 'page',
        pageId: undefined
      })
      return
    }
    void loadMessages({
      sessionId: id,
      chatType,
      pageId: chatType === 'page' ? selectedPage?.id : undefined
    })
  }, [id, chatType, selectedPage?.id, loadMessages, setMessages])

  useEffect(() => {
    const pageId = selectedPage?.id
    if (!id || !pageId) {
      useSessionDetailUiStore.getState().setImageMessages([])
      return
    }

    const cacheKey = buildImageMessageCacheKey(id, pageId)
    const detailState = useSessionDetailUiStore.getState()
    if (detailState.loadedImageMessageKeys[cacheKey]) {
      detailState.setImageMessages(detailState.imageMessageCache[cacheKey] || [])
      return
    }

    detailState.setImageMessages(detailState.imageMessageCache[cacheKey] || [])
    let cancelled = false
    void ipc
      .listImageGenerationHistory({ sessionId: id, pageId })
      .then((histories) => {
        if (cancelled) return
        const historyMessages = imageHistoryToMessages(histories)
        const latestState = useSessionDetailUiStore.getState()
        const mergedMessages = mergeImageMessages(
          historyMessages,
          latestState.imageMessageCache[cacheKey] || []
        )
        latestState.setLoadedImageMessages(cacheKey, mergedMessages)
        latestState.setImageMessages(mergedMessages)
      })
      .catch((err) => {
        if (!cancelled) {
          toastError(err instanceof Error ? err.message : t('sessionDetail.imageHistoryLoadFailed'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, selectedPage?.id, t, toastError])

  useEffect(() => {
    if (!id) return
    const handler = (event: GenerateChunkEvent): void => {
      const { type, payload } = event
      if (payload.sessionId && payload.sessionId !== id) return
      if (
        type === 'stage_started' ||
        type === 'stage_progress' ||
        type === 'page_generated' ||
        type === 'llm_status'
      ) {
        // 不清空 currentPages，保持预览可见
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        updateProgress({
          stage: payload.stage,
          label: payload.label,
          progress: payload.progress ?? 0,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages
        })
        if (type === 'page_generated') {
          // Skip page_generated during addPage — pages will be reloaded on run_completed
          if (useSessionDetailUiStore.getState().isAddingPage) {
            updateProgress({
              stage: payload.stage,
              label: payload.label,
              progress: payload.progress ?? 0,
              currentPage: payload.currentPage,
              totalPages: payload.totalPages
            })
            return
          }
          const store = useGenerateStore.getState()
          const existingPage = store.currentPages.find((page) =>
            payload.id
              ? page.id === payload.id
              : payload.pageId
                ? page.pageId === payload.pageId
                : page.pageNumber === payload.pageNumber
          )
          const entityId =
            payload.id || existingPage?.id || payload.pageId || `page-${payload.pageNumber}`
          // 全新生成：第 1 页到来时清掉旧页面，避免新旧混合
          if (payload.pageNumber === 1 && store.currentPages.length > 0) {
            store.setPages([])
          }
          store.addPage({
            id: entityId,
            pageNumber: payload.pageNumber,
            title: payload.title,
            contentOutline: payload.contentOutline,
            html: payload.html,
            htmlPath: payload.htmlPath,
            pageId: payload.pageId || `page-${payload.pageNumber}`,
            sourceUrl: payload.sourceUrl,
            status: 'completed',
            error: null
          })
          useSessionDetailUiStore.getState().setSelectedPageId(entityId)
          useSessionDetailUiStore.getState().bumpPreviewKey()
        }
      } else if (type === 'page_updated') {
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        const store = useGenerateStore.getState()
        const existingPage = store.currentPages.find((page) =>
          payload.id
            ? page.id === payload.id
            : payload.pageId
              ? page.pageId === payload.pageId
              : page.pageNumber === payload.pageNumber
        )
        const entityId =
          payload.id || existingPage?.id || payload.pageId || `page-${payload.pageNumber}`
        useGenerateStore.getState().addPage({
          id: entityId,
          pageNumber: payload.pageNumber,
          title: payload.title,
          contentOutline: payload.contentOutline,
          html: payload.html,
          htmlPath: payload.htmlPath,
          pageId: payload.pageId || `page-${payload.pageNumber}`,
          sourceUrl: payload.sourceUrl,
          status: 'completed',
          error: null
        })
        useSessionDetailUiStore.getState().setSelectedPageId(entityId)
        useSessionDetailUiStore.getState().bumpPreviewKey()
      } else if (type === 'assistant_message') {
        const incomingType = payload.chatType === 'page' && payload.pageId ? 'page' : 'main'
        const incomingPageId = incomingType === 'page' ? payload.pageId : undefined
        const active = activeChatRef.current
        const matchesCurrentChat =
          incomingType === active.chatType &&
          (incomingType !== 'page' || incomingPageId === active.pageId)
        if (!matchesCurrentChat) return
        const createdAt = payload.timestamp
          ? Math.floor(new Date(payload.timestamp).getTime() / 1000)
          : Math.floor(Date.now() / 1000)
        addMessage({
          id: payload.id || crypto.randomUUID(),
          session_id: id,
          chat_scope: incomingType,
          page_id: incomingPageId || null,
          role: 'assistant',
          content: payload.content,
          type: 'text',
          tool_name: null,
          tool_call_id: null,
          token_count: null,
          created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000)
        })
      } else if (type === 'run_completed') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          useGenerateStore.getState().finishGeneration()
        }
      } else if (type === 'run_error') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          useGenerateStore.getState().setError(payload.message)
          void loadSession(id)
        }
      }
    }
    const unsubscribe = ipc.onGenerateChunk(handler)
    return () => {
      unsubscribe?.()
    }
  }, [addMessage, id, updateProgress])

  useEffect(() => {
    if (!id) return
    const unsubscribe = ipc.onSpeechProgress((payload) => {
      if (payload.sessionId !== id) return
      useSessionDetailUiStore
        .getState()
        .setSpeechProgress({ current: payload.current, total: payload.total })
    })
    return () => unsubscribe()
  }, [id])

  const isSupportedImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)
  }
  const isSupportedVideoFile = (file: File): boolean => {
    if (/^video\/(mp4|webm|ogg)$/i.test(file.type)) return true
    return /\.(mp4|webm|ogg)$/i.test(file.name)
  }
  const isSupportedMediaFile = (file: File): boolean => {
    return isSupportedImageFile(file) || isSupportedVideoFile(file)
  }

  const uploadFiles = async (files: File[]): Promise<void> => {
    if (!id || files.length === 0) return
    const mediaFiles = files.filter((file) => isSupportedMediaFile(file)).slice(0, 10)
    if (mediaFiles.length === 0) {
      toastWarning(t('sessionDetail.mediaOnly'))
      return
    }
    const payloadFiles = mediaFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)
    if (payloadFiles.length === 0) {
      toastError(t('sessionDetail.mediaPathFailed'))
      return
    }
    useSessionDetailUiStore.getState().setIsUploadingAssets(true)
    try {
      const result = await ipc.uploadAssets({ sessionId: id, files: payloadFiles })
      if (result.assets.length > 0) {
        useSessionDetailUiStore.getState().addPendingAssets(result.assets)
        toastSuccess(t('sessionDetail.assetsAdded', { count: result.assets.length }))
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.assetUploadFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsUploadingAssets(false)
      useSessionDetailUiStore.getState().setAssetDragActive(false)
    }
  }

  const handleChooseAssets = async (assetType: 'image' | 'video'): Promise<void> => {
    if (!id || useSessionDetailUiStore.getState().isUploadingAssets) return
    useSessionDetailUiStore.getState().setIsUploadingAssets(true)
    try {
      const result = await ipc.chooseAndUploadAssets(id, assetType)
      if (result.cancelled) return
      if (result.assets.length > 0) {
        useSessionDetailUiStore.getState().addPendingAssets(result.assets)
        toastSuccess(t('sessionDetail.assetsAdded', { count: result.assets.length }))
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.assetUploadFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsUploadingAssets(false)
    }
  }

  const handleSend = async (modelConfigId?: string): Promise<void> => {
    if (!id) return
    if (sendingMessageRef.current || isGenerating) return
    const detailState = useSessionDetailUiStore.getState()
    if (!detailState.input.trim() && detailState.pendingAssets.length === 0) return
    const content = detailState.input.trim() || t('sessionDetail.useUploadedAssets')
    const assetsForMessage = detailState.pendingAssets
    const imagePaths = assetsForMessage
      .map((asset) => asset.relativePath)
      .filter((item) => item.startsWith('./images/'))
    const videoPaths = assetsForMessage
      .map((asset) => asset.relativePath)
      .filter((item) => item.startsWith('./videos/'))
    const hasSelector = Boolean(detailState.selectedSelector?.trim())
    const selectorForMessage = hasSelector ? detailState.selectedSelector!.trim() : null
    const effectiveChatType: 'main' | 'page' = hasSelector ? 'page' : detailState.chatType
    const effectivePage = selectedPage ?? normalizedOrderedPages[0] ?? null
    const targetPageId = effectiveChatType === 'page' ? effectivePage?.id : undefined
    const targetPagePath =
      effectiveChatType === 'page'
        ? effectivePage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
        : undefined
    if (effectiveChatType === 'page' && !targetPageId) {
      toastError(t('sessionDetail.selectPageFirst'))
      return
    }
    if (hasSelector && detailState.chatType !== 'page') {
      detailState.setChatType('page')
    }
    sendingMessageRef.current = true
    try {
      useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
      addMessage({
        id: crypto.randomUUID(),
        session_id: id,
        chat_scope: effectiveChatType,
        page_id: effectiveChatType === 'page' ? (targetPageId as string) : null,
        selector: effectiveChatType === 'page' ? selectorForMessage : null,
        image_paths: imagePaths,
        video_paths: videoPaths,
        role: 'user',
        content,
        type: 'text',
        tool_name: null,
        tool_call_id: null,
        token_count: null,
        created_at: Math.floor(Date.now() / 1000)
      })
      detailState.setInput('')
      detailState.clearPendingAssets()
      detailState.clearSelectedElement()
      const hasExistingPages = normalizedOrderedPages.length > 0
      await ipc.startGenerate({
        sessionId: id,
        modelConfigId,
        userMessage: content,
        type: hasExistingPages ? 'page' : 'deck',
        chatType: effectiveChatType,
        chatPageId: effectiveChatType === 'page' ? targetPageId : undefined,
        selectedPageId: hasExistingPages && effectiveChatType === 'page' ? targetPageId : undefined,
        htmlPath: hasExistingPages && effectiveChatType === 'page' ? targetPagePath : undefined,
        selector: selectorForMessage || undefined,
        elementTag: hasSelector ? detailState.elementTag || undefined : undefined,
        elementText: hasSelector ? detailState.elementText || undefined : undefined,
        imagePaths,
        videoPaths
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('generating.failed')
      useGenerateStore.getState().setError(message)
      toastError(message)
    } finally {
      sendingMessageRef.current = false
    }
  }

  const handleGenerateImage = async (): Promise<void> => {
    if (!id || !selectedPage?.id) {
      toastError(t('sessionDetail.selectPageFirst'))
      return
    }
    const detailState = useSessionDetailUiStore.getState()
    const prompt = detailState.imagePrompt.trim()
    if (!prompt) {
      toastWarning(t('sessionDetail.imagePromptRequired'))
      return
    }
    if (detailState.isGeneratingImage) return

    const pageId = selectedPage.id
    const selectedPageKey = selectedPage.id
    const cacheKey = buildImageMessageCacheKey(id, pageId)
    const pendingUserMessage: ImageGenerationMessage = {
      id: `pending-image:${nanoid(8)}`,
      role: 'user',
      content: prompt,
      createdAt: Math.floor(Date.now() / 1000)
    }
    detailState.setIsGeneratingImage(true)
    detailState.setImageProgress({ progress: 8, label: t('sessionDetail.imageGenerating') })
    detailState.setImagePrompt('')
    detailState.addImageMessage(pendingUserMessage)
    detailState.addCachedImageMessage(cacheKey, pendingUserMessage)
    try {
      const result = await ipc.generateImage({
        sessionId: id,
        pageId,
        prompt,
        imageModelConfigId: detailState.selectedImageModelConfigId || undefined,
        size: detailState.imageSize,
        count: 1
      })
      const latestState = useSessionDetailUiStore.getState()
      const persistedMessages = imageHistoryToMessages([result.history])
      const visibleMessages =
        latestState.selectedPageId === selectedPageKey ? latestState.imageMessages : []
      const cachedWithoutPending = mergeImageMessages(
        latestState.imageMessageCache[cacheKey] || [],
        visibleMessages
      ).filter((message) => message.id !== pendingUserMessage.id)
      const nextMessages = mergeImageMessages(cachedWithoutPending, persistedMessages)
      latestState.cacheImageMessages(cacheKey, nextMessages)
      if (useSessionDetailUiStore.getState().selectedPageId === selectedPageKey) {
        latestState.setImageMessages(nextMessages)
      }
      detailState.setImageProgress({ progress: 100, label: t('sessionDetail.imageGenerated') })
      toastSuccess(t('sessionDetail.imageGenerated'), {
        description: t('sessionDetail.imageGeneratedDescription', {
          count: result.history.assets.length
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.imageGenerateFailed')
      toastError(t('sessionDetail.imageGenerateFailed'), { description: message })
    } finally {
      useSessionDetailUiStore.getState().setIsGeneratingImage(false)
    }
  }

  const handleCancelImageGeneration = async (): Promise<void> => {
    if (!id) return
    try {
      await ipc.cancelImageGeneration(id)
    } finally {
      useSessionDetailUiStore.getState().setIsGeneratingImage(false)
      useSessionDetailUiStore.getState().setImageProgress(null)
    }
  }

  const handleRevealImageFile = async (filePath: string): Promise<void> => {
    if (!id || !filePath) return
    try {
      await ipc.revealFile(filePath, id)
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('common.retryLater'))
    }
  }

  const handleCancel = async (): Promise<void> => {
    await ipc.cancelGenerate(id!)
    cancelGeneration()
  }

  const handleOpenSpeechDialog = (): void => {
    useSessionDetailUiStore.getState().setSpeechScriptDialogOpen(true)
  }

  const handleElementMoved = (payload: EditModeMovePayload): void => {
    if (!id || !selectedPage?.htmlPath || !selectedPage.pageId) return

    // Sync inspector panel layout fields when the selected element is dragged
    // payload.x/y are translate offsets (--ppt-drag-x/y), convert to visual position for display
    if (textSelection && payload.selector === textSelection.selector) {
      const visualX =
        payload.visualX ??
        (textSelection.pageBounds?.x ?? textSelection.bounds?.x ?? 0) +
          (payload.layoutMode === 'translate' ? payload.x : payload.deltaX)
      const visualY =
        payload.visualY ??
        (textSelection.pageBounds?.y ?? textSelection.bounds?.y ?? 0) +
          (payload.layoutMode === 'translate' ? payload.y : payload.deltaY)
      setTextDraft((prev) => ({
        ...prev,
        layoutX: String(Math.round(visualX)),
        layoutY: String(Math.round(visualY)),
        ...(payload.width !== undefined ? { layoutWidth: String(Math.round(payload.width)) } : {}),
        ...(payload.height !== undefined
          ? { layoutHeight: String(Math.round(payload.height)) }
          : {})
      }))
    }

    const draftZIndex = parseInt(textDraft.layoutZIndex, 10)
    const nextEdit = {
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      selector: payload.selector,
      x: payload.x,
      y: payload.y,
      width: payload.width ?? null,
      height: payload.height ?? null,
      childUpdates: payload.childUpdates ?? [],
      isAbsoluteMode: payload.layoutMode === 'absolute',
      zIndex: Number.isFinite(draftZIndex) ? draftZIndex : undefined
    }
    editHistory.upsertDragEdit(nextEdit)
  }

  // Unified save: persist both drag edits and text edits for the current page
  const handleSaveAllEdits = async (): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    commitCurrentElementEdit()
    const snapshot = editHistory.getSnapshotForPage(selectedPage.pageId)
    const hasEdits =
      snapshot.dragEdits.length > 0 ||
      snapshot.textEdits.length > 0 ||
      snapshot.propertyEdits.length > 0 ||
      snapshot.deletes.length > 0 ||
      snapshot.addElements.length > 0
    if (!hasEdits) {
      previewIframeRef.current?.clearEditModeSelection()
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
      setPreviewRefreshKey((key) => key + 1)
      return
    }
    setIsSavingEdits(true)
    try {
      // Fill htmlFragment for copied elements (empty at copy time, read from webview now)
      const filledAddElements = await Promise.all(
        snapshot.addElements.map(async (el) => {
          if (el.htmlFragment) return el
          const selector = el.assignedBlockId
            ? `body[data-page-id="${el.pageId}"] [data-block-id="${el.assignedBlockId}"]`
            : ''
          if (!selector || !previewIframeRef.current) return el
          try {
            const html = await (previewIframeRef.current as any).readElementHtml?.(selector)
            return html ? { ...el, htmlFragment: html } : el
          } catch {
            return el
          }
        })
      )
      // Filter out edits for elements that are also pending deletion.
      const isDeletedTarget = (selector: string, blockId?: string): boolean =>
        snapshot.deletes.some((d) =>
          editTargetMatchesDeletedSelector(selector, d.selector, blockId)
        )
      const safeDragEdits = snapshot.dragEdits.filter((e) => !isDeletedTarget(e.selector))
      const safeTextEdits = snapshot.textEdits.filter((e) => !isDeletedTarget(e.selector))
      const safePropertyEdits = snapshot.propertyEdits.filter(
        (e) => !isDeletedTarget(e.selector, e.blockId)
      )
      // Build descriptive prompt for history
      const parts: string[] = []
      const ac = snapshot.addElements.length
      const dc = snapshot.deletes.length
      const rc = safeDragEdits.length
      const tc = safeTextEdits.length
      const pc = safePropertyEdits.length
      if (ac > 0) parts.push(`添加 ${ac} 个元素`)
      if (dc > 0) parts.push(`删除 ${dc} 个元素`)
      if (rc > 0) parts.push(`调整 ${rc} 个元素位置`)
      if (tc > 0) parts.push(`编辑 ${tc} 个元素文字`)
      if (pc > 0) parts.push(`编辑 ${pc} 个元素属性`)
      const prompt = parts.join('、') || '手动调整'
      const result = await ipc.saveEditBatch({
        sessionId: id,
        htmlPath: selectedPage.htmlPath,
        pageId: selectedPage.pageId,
        dragEdits: safeDragEdits,
        textEdits: safeTextEdits,
        propertyEdits: safePropertyEdits,
        deletes: snapshot.deletes,
        addElements: filledAddElements,
        prompt
      })
      if (!result.success) throw new Error(t('sessionDetail.layoutSaveFailed'))
      editHistory.markPageSaved(selectedPage.pageId)
      previewIframeRef.current?.clearEditModeSelection()
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
      useSessionDetailUiStore.getState().bumpThumbnailVersion(selectedPage.pageId)
      setPreviewRefreshKey((key) => key + 1)
      const totalCount =
        result.dragCount +
        result.textCount +
        (result.propertyCount || 0) +
        result.deleteCount +
        result.addCount
      toastSuccess(t('sessionDetail.adjustmentsSaved', { count: totalCount }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.layoutSaveFailed'))
    } finally {
      setIsSavingEdits(false)
    }
  }

  const handleDiscardAllEdits = (): void => {
    if (!selectedPage?.pageId) return
    const snapshot = editHistory.getSnapshotForPage(selectedPage.pageId)
    const hadPending =
      snapshot.dragEdits.length > 0 ||
      snapshot.textEdits.length > 0 ||
      snapshot.propertyEdits.length > 0 ||
      snapshot.deletes.length > 0 ||
      snapshot.addElements.length > 0
    editHistory.clearPage(selectedPage.pageId)
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
    useSessionDetailUiStore.getState().setInteractionMode('preview')
    useSessionDetailUiStore.getState().setWorkspaceTab('preview')
    if (hadPending) {
      setPreviewRefreshKey((key) => key + 1)
    }
    if (hadPending) toastInfo(t('sessionDetail.discardedAdjustments'))
  }

  const handleDeleteElement = (): void => {
    if (!selectedPage?.htmlPath || !selectedPage.pageId || !textSelection) return
    const selector = textSelection.selector
    editHistory.addDelete({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      selector
    })
    previewIframeRef.current?.hideElement(selector)
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
  }

  const handleDeleteBySelector = (selector: string): void => {
    if (!selectedPage?.htmlPath || !selectedPage.pageId || !selector) return
    // Commit any pending inspector edit for the element being deleted.
    if (textSelection && textSelection.selector === selector) {
      commitCurrentElementEdit()
    }
    editHistory.addDelete({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      selector
    })
    previewIframeRef.current?.hideElement(selector)
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
  }

  const handleElementSelected = (payload: EditSelectionPayload): void => {
    // Commit previous edit before switching to new element.
    commitCurrentElementEdit()
    if (!payload.snapshot) {
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
      return
    }
    setTextSelection(payload)
    const zValue = payload.zIndex !== undefined ? String(payload.zIndex) : '10'
    const bounds = payload.snapshot.metrics.page
    const computed = payload.snapshot.computed
    const attrs = payload.snapshot.attrs
    if (payload.isText) {
      setTextDraft({
        text: payload.textTarget?.text ?? payload.text,
        html: payload.html || payload.snapshot.text?.html || '',
        color: rgbToHex(computed.color),
        fontSize: fontSizeToNumber(computed.fontSize),
        fontWeight: normalizeFontWeight(computed.fontWeight),
        textAlign: normalizeTextAlign(computed.textAlign),
        layoutX: String(Math.round(bounds.x)),
        layoutY: String(Math.round(bounds.y)),
        layoutWidth: String(Math.round(bounds.width)),
        layoutHeight: String(Math.round(bounds.height)),
        layoutZIndex: zValue,
        opacity: opacityToInput(computed.opacity),
        backgroundColor: rgbToHex(computed.backgroundColor),
        objectFit: computed.objectFit || 'contain',
        alt: attrs.alt || '',
        poster: attrs.poster || '',
        controls: Boolean(attrs.controls),
        muted: Boolean(attrs.muted),
        loop: Boolean(attrs.loop),
        autoplay: Boolean(attrs.autoplay),
        playsInline: attrs.playsInline !== false,
        preload: attrs.preload || 'metadata',
        artTextTemplateId: attrs.artTextTemplate || ''
      })
    } else {
      setTextDraft({
        ...EMPTY_ELEMENT_DRAFT,
        layoutX: String(Math.round(bounds.x)),
        layoutY: String(Math.round(bounds.y)),
        layoutWidth: String(Math.round(bounds.width)),
        layoutHeight: String(Math.round(bounds.height)),
        layoutZIndex: zValue,
        opacity: opacityToInput(computed.opacity),
        backgroundColor: rgbToHex(computed.backgroundColor),
        objectFit: computed.objectFit || 'contain',
        alt: attrs.alt || '',
        poster: attrs.poster || '',
        controls: Boolean(attrs.controls),
        muted: Boolean(attrs.muted),
        loop: Boolean(attrs.loop),
        autoplay: Boolean(attrs.autoplay),
        playsInline: attrs.playsInline !== false,
        preload: attrs.preload || 'metadata',
        artTextTemplateId: attrs.artTextTemplate || ''
      })
    }
  }

  const getCommitFieldsForSelection = (
    selection: EditSelectionPayload
  ): Set<keyof ElementEditDraft> => {
    const fields = new Set<keyof ElementEditDraft>()
    const capabilities = selection.capabilities || []
    if (capabilities.includes('layer')) fields.add('layoutZIndex')
    if (capabilities.includes('appearance')) {
      fields.add('opacity')
      fields.add('backgroundColor')
    }
    if (capabilities.includes('media')) {
      fields.add('objectFit')
      fields.add('alt')
      fields.add('poster')
      fields.add('controls')
      fields.add('muted')
      fields.add('loop')
      fields.add('autoplay')
      fields.add('playsInline')
      fields.add('preload')
    }
    if (capabilities.includes('text')) {
      fields.add('html')
      fields.add('text')
      fields.add('color')
      fields.add('fontSize')
      fields.add('fontWeight')
      fields.add('textAlign')
    }
    return fields
  }

  const buildElementPropertyPatch = (
    draft: ElementEditDraft,
    fields?: Array<keyof ElementEditDraft>
  ): ElementPropertyPatch | null => {
    if (!textSelection?.snapshot) return null

    const commitFields =
      fields && fields.length > 0 ? new Set(fields) : getCommitFieldsForSelection(textSelection)
    const initial = textSelection.snapshot
    const style: ElementPropertyStylePatch = {}
    const attrs: ElementPropertyAttrsPatch = {}
    let text: string | undefined
    let html: string | undefined

    if (commitFields.has('layoutZIndex')) {
      const value = parseInt(draft.layoutZIndex, 10)
      const initialValue = textSelection.zIndex ?? 10
      if (Number.isFinite(value) && value !== initialValue) style.zIndex = value
    }
    if (commitFields.has('opacity')) {
      const value = Number(draft.opacity)
      const initialValue = Number(opacityToInput(initial.computed.opacity))
      if (Number.isFinite(value) && value !== initialValue) style.opacity = value
    }
    if (
      commitFields.has('backgroundColor') &&
      draft.backgroundColor !== rgbToHex(initial.computed.backgroundColor)
    ) {
      style.backgroundColor = draft.backgroundColor
    }
    if (
      commitFields.has('objectFit') &&
      draft.objectFit !== (initial.computed.objectFit || 'contain')
    ) {
      style.objectFit = draft.objectFit
    }
    const initialHtml = initial.text?.html || ''
    if (commitFields.has('html') && draft.html.trim() && draft.html.trim() !== initialHtml.trim()) {
      html = draft.html.trim()
    }
    const initialText = textSelection.textTarget?.text ?? initial.text?.value ?? ''
    if (
      !html &&
      commitFields.has('text') &&
      draft.text.trim() &&
      draft.text.trim() !== initialText
    ) {
      text = draft.text.trim()
    }
    if (commitFields.has('color') && draft.color !== rgbToHex(initial.computed.color)) {
      style.color = draft.color
    }
    if (
      commitFields.has('fontSize') &&
      draft.fontSize !== fontSizeToNumber(initial.computed.fontSize)
    ) {
      style.fontSize = draft.fontSize ? `${draft.fontSize}px` : undefined
    }
    if (
      commitFields.has('fontWeight') &&
      draft.fontWeight !== normalizeFontWeight(initial.computed.fontWeight)
    ) {
      style.fontWeight = draft.fontWeight
    }
    if (
      commitFields.has('textAlign') &&
      draft.textAlign !== normalizeTextAlign(initial.computed.textAlign)
    ) {
      style.textAlign = draft.textAlign
    }
    if (commitFields.has('alt') && draft.alt !== (initial.attrs.alt || '')) attrs.alt = draft.alt
    if (commitFields.has('poster') && draft.poster !== (initial.attrs.poster || '')) {
      attrs.poster = draft.poster
    }
    if (commitFields.has('controls') && draft.controls !== Boolean(initial.attrs.controls)) {
      attrs.controls = draft.controls
    }
    if (commitFields.has('muted') && draft.muted !== Boolean(initial.attrs.muted)) {
      attrs.muted = draft.muted
    }
    if (commitFields.has('loop') && draft.loop !== Boolean(initial.attrs.loop)) {
      attrs.loop = draft.loop
    }
    if (commitFields.has('autoplay') && draft.autoplay !== Boolean(initial.attrs.autoplay)) {
      attrs.autoplay = draft.autoplay
    }
    if (
      commitFields.has('playsInline') &&
      draft.playsInline !== (initial.attrs.playsInline !== false)
    ) {
      attrs.playsInline = draft.playsInline
    }
    if (commitFields.has('preload') && draft.preload !== (initial.attrs.preload || 'metadata')) {
      attrs.preload = draft.preload
    }

    if (
      html === undefined &&
      text === undefined &&
      Object.keys(style).length === 0 &&
      Object.keys(attrs).length === 0
    ) {
      return null
    }
    return {
      html,
      text,
      textTarget: text !== undefined ? textSelection.textTarget : undefined,
      style: Object.keys(style).length > 0 ? style : undefined,
      attrs: Object.keys(attrs).length > 0 ? attrs : undefined
    }
  }

  const commitElementDraft = (
    draft: ElementEditDraft,
    fields?: Array<keyof ElementEditDraft>
  ): boolean => {
    if (!textSelection || !selectedPage?.pageId || !selectedPage.htmlPath) return false
    const patch = buildElementPropertyPatch(draft, fields)
    if (!patch) return false
    editHistory.upsertPropertyEdit({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      selector: textSelection.selector,
      blockId: textSelection.blockId,
      patch
    })
    return true
  }

  const commitCurrentElementEdit = (): boolean => commitElementDraft(textDraft)

  const handleTextDraftChange = (
    draft: ElementEditDraft,
    options?: { commit?: boolean; fields?: Array<keyof ElementEditDraft> }
  ): void => {
    const liveStyle: {
      zIndex?: number
      opacity?: number
      backgroundColor?: string
      objectFit?: string
      textAlign?: string
    } = {}
    const liveAttrs: {
      alt?: string
      poster?: string
      controls?: boolean
      muted?: boolean
      loop?: boolean
      autoplay?: boolean
      playsInline?: boolean
      preload?: string
    } = {}

    if (
      textSelection &&
      selectedPage?.htmlPath &&
      selectedPage?.pageId &&
      draft.layoutZIndex !== textDraft.layoutZIndex
    ) {
      const zNum = parseInt(draft.layoutZIndex, 10)
      if (Number.isFinite(zNum)) liveStyle.zIndex = zNum
    }
    if (draft.opacity !== textDraft.opacity) {
      const opacity = Number(draft.opacity)
      if (Number.isFinite(opacity)) liveStyle.opacity = opacity
    }
    if (draft.backgroundColor !== textDraft.backgroundColor) {
      liveStyle.backgroundColor = draft.backgroundColor
    }
    if (draft.objectFit !== textDraft.objectFit) {
      liveStyle.objectFit = draft.objectFit
    }
    if (draft.textAlign !== textDraft.textAlign) {
      liveStyle.textAlign = draft.textAlign
    }
    if (draft.alt !== textDraft.alt) liveAttrs.alt = draft.alt
    if (draft.poster !== textDraft.poster) liveAttrs.poster = draft.poster
    if (draft.controls !== textDraft.controls) liveAttrs.controls = draft.controls
    if (draft.muted !== textDraft.muted) liveAttrs.muted = draft.muted
    if (draft.loop !== textDraft.loop) liveAttrs.loop = draft.loop
    if (draft.autoplay !== textDraft.autoplay) liveAttrs.autoplay = draft.autoplay
    if (draft.playsInline !== textDraft.playsInline) liveAttrs.playsInline = draft.playsInline
    if (draft.preload !== textDraft.preload) liveAttrs.preload = draft.preload

    setTextDraft(draft)
    // Live preview in iframe
    if (textSelection && selectedPage?.pageId) {
      // Z-index: use dedicated function to avoid clearing element content
      const zNum = parseInt(draft.layoutZIndex, 10)
      if (Number.isFinite(zNum) && draft.layoutZIndex !== textDraft.layoutZIndex) {
        previewIframeRef.current?.applyZIndex(textSelection.selector, zNum)
      }
      if (Object.keys(liveStyle).length > 0 || Object.keys(liveAttrs).length > 0) {
        previewIframeRef.current?.applyElementProperties(textSelection.selector, {
          style: liveStyle,
          attrs: liveAttrs
        })
      }
      // Text & style: only for text elements
      if (textSelection.isText) {
        previewIframeRef.current?.liveUpdateElement(textSelection.selector, {
          html: draft.html,
          text: draft.text,
          textTarget: textSelection.textTarget,
          style: {
            color: draft.color,
            fontSize: draft.fontSize ? `${draft.fontSize}px` : undefined,
            fontWeight: draft.fontWeight
          }
        })
      }

      if (options?.commit) {
        commitElementDraft(draft, options.fields)
      }
    }
  }

  const replayPendingEdits = (): void => {
    if (!selectedPage?.pageId) return
    const snapshot = editHistory.getSnapshotForPage(selectedPage.pageId)
    const iframe = previewIframeRef.current
    if (!iframe) return
    for (const d of snapshot.deletes) {
      iframe.hideElement(d.selector)
    }
    for (const a of snapshot.addElements) {
      iframe.injectElement(a.parentSelector, a.htmlFragment, a.insertIndex)
    }
    for (const d of snapshot.dragEdits) {
      iframe.applyDragStyle(d.selector, {
        x: d.x,
        y: d.y,
        width: d.width ?? undefined,
        height: d.height ?? undefined,
        isAbsoluteMode: d.isAbsoluteMode
      })
      if (d.zIndex !== undefined) {
        iframe.applyZIndex(d.selector, d.zIndex)
      }
      if (d.childUpdates.length > 0) {
        iframe.applyChildUpdates(d.selector, d.childUpdates)
      }
    }
    for (const t of snapshot.textEdits) {
      iframe.liveUpdateElement(t.selector, {
        text: t.patch.text,
        textTarget: undefined,
        style: t.patch.style
      })
    }
    for (const p of snapshot.propertyEdits) {
      iframe.applyElementProperties(p.selector, {
        style: p.patch.style,
        attrs: p.patch.attrs
      })
      if (
        p.patch.html ||
        p.patch.text ||
        p.patch.style?.color ||
        p.patch.style?.fontSize ||
        p.patch.style?.fontWeight
      ) {
        iframe.liveUpdateElement(p.selector, {
          text: p.patch.text,
          html: p.patch.html,
          textTarget: p.patch.textTarget,
          style: {
            color: p.patch.style?.color,
            fontSize: p.patch.style?.fontSize,
            fontWeight: p.patch.style?.fontWeight
          }
        })
      }
    }
  }

  const handleUndo = (): void => {
    if (!selectedPage?.pageId) return
    commitCurrentElementEdit()
    if (!editHistory.undo(selectedPage.pageId)) return
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
    setPreviewRefreshKey((key) => key + 1)
  }

  const handleRedo = (): void => {
    if (!selectedPage?.pageId) return
    if (!editHistory.redo(selectedPage.pageId)) return
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
    setPreviewRefreshKey((key) => key + 1)
  }

  const handleCancelTextEdit = (): void => {
    // Commit current inspector edit before closing panel.
    commitCurrentElementEdit()
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
  }

  const handleCopyElement = async (): Promise<void> => {
    if (!textSelection || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    let copyResult: { selector: string; htmlFragment: string } | null | undefined
    try {
      copyResult = await previewIframeRef.current?.copyElement(textSelection.selector, blockId)
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.copyElementFailed'))
      return
    }
    if (!copyResult) {
      toastError(t('sessionDetail.copyElementFailed'))
      return
    }
    const newSelector = copyResult.selector
    const bounds = textSelection.pageBounds || textSelection.bounds
    const zValue = textSelection.zIndex !== undefined ? String(textSelection.zIndex + 1) : '10'
    const nextSnapshot = textSelection.snapshot
      ? {
          ...textSelection.snapshot,
          selector: newSelector,
          blockId,
          label: newSelector,
          metrics: {
            ...textSelection.snapshot.metrics,
            page: bounds
              ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
              : textSelection.snapshot.metrics.page,
            viewport: bounds
              ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
              : textSelection.snapshot.metrics.viewport,
            translateX: 0,
            translateY: 0
          }
        }
      : null
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector: `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`,
      htmlFragment: copyResult.htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    handleElementSelected({
      selector: newSelector,
      blockId,
      label: newSelector,
      elementTag: textSelection.elementTag,
      elementText: '',
      kind: textSelection.kind,
      capabilities: textSelection.capabilities,
      snapshot: nextSnapshot,
      isText: false,
      text: '',
      style: {},
      bounds: bounds
        ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
        : undefined,
      pageBounds: bounds
        ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
        : undefined,
      translateX: 0,
      translateY: 0,
      zIndex: parseInt(zValue, 10),
      editability: { x: true, y: true, width: true, height: true }
    })
  }

  const readElementSnapshotWithRetry = async (
    selector: string
  ): Promise<EditableElementSnapshot | null> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
      }
      const snapshot = await previewIframeRef.current?.readElementSnapshot(selector)
      if (snapshot) return snapshot
    }
    return null
  }

  const handleAddTextElement = async (): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_TEXT_WIDTH
    const h = ADDED_TEXT_MIN_HEIGHT
    const left = Math.min(
      ADDED_TEXT_BASE_LEFT + offset,
      PPT_PAGE_WIDTH - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      ADDED_TEXT_BASE_TOP + offset,
      PPT_PAGE_HEIGHT - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const defaultText = t('editMode.defaultText')
    const textStyle = [
      'position:absolute',
      `left:${left}px`,
      `top:${top}px`,
      `width:${w}px`,
      `min-height:${h}px`,
      'margin:0',
      'padding:0',
      `z-index:${zIdx}`,
      'color:#34402c',
      'font-size:40px',
      'font-weight:700',
      'line-height:1.18',
      'letter-spacing:0',
      'white-space:pre-wrap',
      'overflow-wrap:anywhere',
      'font-family:inherit'
    ].join('; ')
    const htmlFragment = `<p data-block-id="${blockId}" style="${textStyle};">${escapeHtmlText(defaultText)}</p>`

    commitCurrentElementEdit()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    handleElementSelected(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddArtTextElement = async (templateId: ArtTextTemplateId): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_ART_TEXT_WIDTH
    const h = ADDED_ART_TEXT_MIN_HEIGHT
    const left = Math.min(
      ADDED_TEXT_BASE_LEFT + offset,
      PPT_PAGE_WIDTH - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      ADDED_TEXT_BASE_TOP + offset,
      PPT_PAGE_HEIGHT - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const htmlFragment = buildArtTextHtmlFragment(templateId, {
      blockId,
      left,
      top,
      width: w,
      minHeight: h,
      zIndex: zIdx
    })

    commitCurrentElementEdit()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    handleElementSelected(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddElement = async (
    relativePath: string,
    _fileName: string,
    options: { persistImmediately?: boolean; prompt?: string; asBackground?: boolean } = {}
  ): Promise<boolean> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return false
    const selectedHtmlPath = selectedPage.htmlPath
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const isVideo = /^\.\/videos\//i.test(relativePath)
    const isBackground = Boolean(options.asBackground && !isVideo)
    const safeRelativePath = escapeHtmlText(relativePath)
    // Offset each added element so they don't overlap
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_MEDIA_OFFSET_STEP
    const w = isBackground ? PPT_PAGE_WIDTH : isVideo ? 640 : 400
    const h = isBackground ? PPT_PAGE_HEIGHT : isVideo ? 360 : 300
    const left = isBackground
      ? 0
      : Math.min(400 + offset, PPT_PAGE_WIDTH - w - ADDED_ELEMENT_EDGE_PADDING)
    const top = isBackground
      ? 0
      : Math.min(200 + offset, PPT_PAGE_HEIGHT - h - ADDED_ELEMENT_EDGE_PADDING)
    const zIdx = isBackground ? 0 : 10 + existingCount
    const insertIndex = -1
    const objectFit = isBackground ? 'cover' : 'contain'
    const htmlFragment = isBackground
      ? `<style data-ppt-generated-background-style="1">body[data-page-id="${escapeCssString(selectedPage.pageId)}"] .ppt-page-root[data-ppt-guard-root="1"]{background:transparent !important;background-color:transparent !important;}</style><img src="${safeRelativePath}" alt="" data-block-id="${blockId}" data-ppt-generated-background="1" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit}; opacity:0.5;" />`
      : isVideo
        ? `<video src="${safeRelativePath}" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit};" controls playsinline preload="metadata"></video>`
        : `<img src="${safeRelativePath}" alt="" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit};" />`
    commitCurrentElementEdit()
    const addElementItem = {
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex
    }
    const backgroundSelectors: string[] = [
      '[data-ppt-generated-background="1"]',
      '[data-ppt-generated-background-style="1"]'
    ]
    if (options.persistImmediately) {
      const result = await ipc.saveEditBatch({
        sessionId: id,
        htmlPath: selectedPage.htmlPath,
        pageId: selectedPage.pageId,
        dragEdits: [],
        textEdits: [],
        propertyEdits: [],
        deletes: isBackground
          ? backgroundSelectors.map((selector) => ({
              pageId: selectedPage.pageId,
              htmlPath: selectedPage.htmlPath,
              selector
            }))
          : [],
        addElements: [addElementItem],
        prompt: options.prompt || (isVideo ? '添加视频元素' : '添加图片元素')
      })
      if (!result.success) throw new Error(t('sessionDetail.layoutSaveFailed'))
      useSessionDetailUiStore.getState().bumpThumbnailVersion(selectedPage.pageId)
    } else {
      if (isBackground) {
        const deletes = backgroundSelectors.map((selector) => ({
          pageId: selectedPage.pageId,
          htmlPath: selectedHtmlPath,
          selector
        }))
        editHistory.addElementWithDeletes(addElementItem, deletes)
      } else {
        editHistory.addElement(addElementItem)
      }
    }
    if (isBackground) {
      backgroundSelectors.forEach((selector) => previewIframeRef.current?.hideElement(selector))
    }
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment, insertIndex, true)
    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return true
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (snapshot) {
      handleElementSelected(
        buildSelectedElementFromSnapshot({
          selector,
          blockId,
          snapshot
        })
      )
    }
    return true
  }

  const handleAddGeneratedImageToCanvas = async (asset: GeneratedImageAsset): Promise<void> => {
    if (!selectedPage?.pageId) {
      toastError(t('sessionDetail.selectPageFirst'))
      return
    }
    useSessionDetailUiStore.getState().setInteractionMode('edit')
    try {
      const added = await handleAddElement(asset.relativePath, asset.fileName, {
        persistImmediately: true,
        prompt: '从生图结果添加图片到画布'
      })
      if (added) {
        useSessionDetailUiStore.getState().setWorkspaceTab('edit')
        toastSuccess(t('sessionDetail.imageAddedToCanvas'))
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('sessionDetail.layoutSaveFailed'))
    }
  }

  const handleSetGeneratedImageAsBackground = async (asset: GeneratedImageAsset): Promise<void> => {
    if (!selectedPage?.pageId) {
      toastError(t('sessionDetail.selectPageFirst'))
      return
    }
    useSessionDetailUiStore.getState().setInteractionMode('edit')
    useSessionDetailUiStore.getState().setWorkspaceTab('ai')
    previewIframeRef.current?.clearEditModeSelection()
    try {
      const added = await handleAddElement(asset.relativePath, asset.fileName, {
        persistImmediately: true,
        asBackground: true,
        prompt: '从生图结果设置页面背景'
      })
      if (added) {
        toastSuccess(t('sessionDetail.imageSetAsBackground'))
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('sessionDetail.layoutSaveFailed'))
    }
  }

  const handleUploadAndAdd = async (assetType: 'image' | 'video'): Promise<void> => {
    if (!id) return
    const result = await ipc.chooseAndUploadAssets(id, assetType)
    if (result.cancelled || !result.assets?.length) return
    const asset = result.assets[0]
    await handleAddElement(asset.relativePath, asset.originalName || asset.fileName)
  }

  const handleBackToSessions = (): void => {
    useGenerateStore.getState().reset()
    useSessionDetailUiStore.getState().resetForSessionChange()
    resetRuntimeState()
    navigate('/sessions')
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full min-h-0 flex-col bg-[#f5f1e8] text-foreground outline-none">
        <header className="app-drag-region app-titlebar relative shrink-0 bg-[#f5f1e8]/95 shadow-[0_10px_26px_rgba(93,107,77,0.055)] backdrop-blur-xl">
          <div className="absolute left-0 top-0 h-full w-[220px] bg-[#f5f1e8]" />
          <div
            className={`relative flex h-full items-center justify-end pl-[244px] ${
              isMac ? 'px-3' : 'pr-[calc(var(--app-titlebar-control-safe-area)+16px)]'
            }`}
          >
            <div className="app-no-drag flex items-center gap-1.5">
              <SessionToolbar sessionId={id || ''} />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-[#f5f1e8]">
          <WorkspaceRibbon
            selectedPageKey={
              selectedPage?.htmlPath ? `${selectedPage.pageId}:${selectedPage.htmlPath}` : null
            }
            isGenerating={isGenerating}
            isSavingEdits={isSavingEdits}
            canUndo={editHistory.canUndo(selectedPage?.pageId)}
            canRedo={editHistory.canRedo(selectedPage?.pageId)}
            hasPendingEdits={
              selectedPage
                ? (() => {
                    const s = editHistory.getSnapshotForPage(selectedPage.pageId)
                    return (
                      s.dragEdits.length > 0 ||
                      s.textEdits.length > 0 ||
                      s.propertyEdits.length > 0 ||
                      s.deletes.length > 0 ||
                      s.addElements.length > 0
                    )
                  })()
                : false
            }
            actions={{
              onUndo: handleUndo,
              onRedo: handleRedo,
              onSaveCurrentPage: () => void handleSaveAllEdits(),
              onBackToSessions: handleBackToSessions,
              onAddText: () => void handleAddTextElement(),
              onAddArtText: (templateId) => void handleAddArtTextElement(templateId),
              onAddFromLibrary: (type) => setAssetPickerOpen(true, type),
              onAddFromLocal: (type) => void handleUploadAndAdd(type),
              onOpenSpeechScript: handleOpenSpeechDialog
            }}
          />

          <div className="flex min-h-0 flex-1">
            <PageSidebar sessionId={id || ''} />

            <div className="flex min-h-0 flex-1">
              <PreviewStage
                ref={previewIframeRef}
                selectedPage={selectedPage}
                sessionTitle={currentSession?.title}
                isGenerating={isGenerating}
                progressLabel={progress?.label}
                previewRefreshKey={previewRefreshKey}
                onElementMoved={handleElementMoved}
                onElementSelected={handleElementSelected}
                onCancelTextEdit={handleCancelTextEdit}
                onDiscardAllEdits={handleDiscardAllEdits}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onReplayPendingEdits={replayPendingEdits}
                onDeleteRequest={(selector) => {
                  setPendingDeleteSelector(selector)
                  setDeleteConfirmOpen(true)
                }}
              />
              {speechScriptDialogOpen && id ? (
                <SpeechScriptDrawer sessionId={id} />
              ) : workspaceTab === 'ai' ? (
                <MessagePanel
                  sessionId={id}
                  selectedPageExists={Boolean(selectedPage?.pageId)}
                  selectedPageHtmlPath={selectedPage?.htmlPath}
                  selectedPageNumber={selectedPage?.pageNumber}
                  selectedPageTitle={selectedPage?.title}
                  selectedPageOutline={selectedPage?.contentOutline}
                  isGenerating={isGenerating}
                  progress={progress}
                  error={error}
                  onDropFiles={(files) => void uploadFiles(files)}
                  onChooseAssets={(assetType) => void handleChooseAssets(assetType)}
                  onSend={(modelConfigId) => void handleSend(modelConfigId)}
                  onCancel={() => void handleCancel()}
                  onGenerateImage={() => void handleGenerateImage()}
                  onCancelImageGeneration={() => void handleCancelImageGeneration()}
                  onAddGeneratedImageToCanvas={(asset) =>
                    void handleAddGeneratedImageToCanvas(asset)
                  }
                  onSetGeneratedImageAsBackground={(asset) =>
                    void handleSetGeneratedImageAsBackground(asset)
                  }
                  onRevealImageFile={(filePath) => void handleRevealImageFile(filePath)}
                />
              ) : workspaceTab === 'edit' && textSelection ? (
                <ElementInspectorPanel
                  selection={textSelection}
                  draft={textDraft}
                  onDraftChange={handleTextDraftChange}
                  onClose={handleCancelTextEdit}
                  onCopy={handleCopyElement}
                  onDelete={handleDeleteElement}
                />
              ) : workspaceTab === 'edit' ? (
                <EmptyEditWorkbenchPanel />
              ) : null}
            </div>
          </div>
        </div>

        <HistoryDialog sessionId={id || ''} />
        <AddBlankPageDialog sessionId={id || ''} />
        <AddPageDialog sessionId={id || ''} />
        <PageProgressOverlay />
        <PageTitleEditDialog sessionId={id || ''} />
        <DeletePageDialog sessionId={id || ''} />
        <AssetPickerDialog
          sessionId={id || ''}
          assetType={assetPickerType}
          open={assetPickerOpen}
          onClose={() => setAssetPickerOpen(false)}
          onConfirm={handleAddElement}
        />
        <DeleteElementDialog
          open={deleteConfirmOpen}
          onOpenChange={(open) => {
            setDeleteConfirmOpen(open)
            if (!open) setPendingDeleteSelector(null)
          }}
          onConfirm={() => {
            if (pendingDeleteSelector) {
              handleDeleteBySelector(pendingDeleteSelector)
            } else {
              handleDeleteElement()
            }
            setPendingDeleteSelector(null)
            setDeleteConfirmOpen(false)
          }}
        />
      </div>
    </TooltipProvider>
  )
}
