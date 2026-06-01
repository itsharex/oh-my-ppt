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
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/Dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '../components/ui/AlertDialog'
import { MessagePanel } from '../components/session-detail/MessagePanel'
import { PageSidebar } from '../components/session-detail/PageSidebar'
import { PreviewStage } from '../components/session-detail/PreviewStage'
import { PreviewToolbar } from '../components/session-detail/PreviewToolbar'
import { ElementInspectorPanel } from '../components/session-detail/ElementInspectorPanel'
import { SessionToolbar } from '../components/session-detail/SessionToolbar'
import { AssetPickerDialog } from '../components/session-detail/AssetPickerDialog'
import { SpeechScriptDrawer } from '../components/session-detail/SpeechScriptDrawer'
import { SaveTemplateDialog } from '../components/templates/SaveTemplateDialog'
import type { ElementEditDraft } from '../components/session-detail/ElementInspectorPanel'
import type { ChatType, SessionPreviewPage } from '../components/session-detail/types'
import { useSessionStore, useGenerateStore, useTemplateStore } from '../store'
import { useSessionDetailUiStore } from '../store/sessionDetailStore'
import { useEditHistoryStore } from '../store/editHistoryStore'
import type { GenerateChunkEvent } from '@shared/generation.js'
import type { HistoryVersion } from '@shared/history.js'
import type { SpeechConfig } from '@shared/speech'
import { useToastStore } from '../store'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'
import { escapeHtmlText } from '../lib/utils'
import { useT } from '../i18n'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'

const PPT_PAGE_WIDTH = 1600
const PPT_PAGE_HEIGHT = 900
const ADDED_ELEMENT_EDGE_PADDING = 20
const ADDED_TEXT_WIDTH = 420
const ADDED_TEXT_MIN_HEIGHT = 96
const ADDED_TEXT_BASE_LEFT = 590
const ADDED_TEXT_BASE_TOP = 360
const ADDED_TEXT_OFFSET_STEP = 28
const ADDED_MEDIA_OFFSET_STEP = 30

const EMPTY_ELEMENT_DRAFT: ElementEditDraft = {
  html: '',
  text: '',
  color: '#34402c',
  fontSize: '',
  fontWeight: '400',
  textAlign: 'left',
  layoutX: '',
  layoutY: '',
  layoutWidth: '',
  layoutHeight: '',
  layoutZIndex: '',
  opacity: '1',
  backgroundColor: '#ffffff',
  objectFit: 'contain',
  alt: '',
  poster: '',
  controls: false,
  muted: false,
  loop: false,
  autoplay: false,
  playsInline: true,
  preload: 'metadata'
}

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

function normalizePagesForSelection(
  pages: Array<{
    id: string
    pageNumber: number
    title: string
    contentOutline?: string | null
    html: string
    htmlPath?: string
    pageId?: string
    sourceUrl?: string
    status?: string
    error?: string | null
  }>
): SessionPreviewPage[] {
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => {
      const pageId = page.pageId || `page-${page.pageNumber}`
      return {
        ...page,
        id: page.id || pageId,
        pageId
      } as SessionPreviewPage
    })
}

function rgbToHex(value: string | undefined): string {
  const text = String(value || '').trim()
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text)) return text
  const match = text.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i)
  if (!match) return '#34402c'
  const toHex = (part: string): string =>
    Math.max(0, Math.min(255, Number(part) || 0))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
}

function fontSizeToNumber(value: string | undefined): string {
  const parsed = Number(String(value || '').replace(/px$/i, ''))
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.round(parsed)) : ''
}

function normalizeFontWeight(value: string | undefined): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value === 'bold' ? '700' : '400'
  return String(Math.max(300, Math.min(800, Math.round(parsed / 100) * 100)))
}

// Keep in sync with normalizeTextAlign in src/main/ipc/editor/shared.ts.
function normalizeTextAlign(value: string | undefined): string {
  const text = String(value || '').trim()
  if (text === 'center' || text === 'right' || text === 'justify') return text
  return 'left'
}

function opacityToInput(value: string | undefined): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(Math.max(0, Math.min(1, parsed))) : '1'
}

function buildSelectedElementFromSnapshot(args: {
  selector: string
  blockId?: string
  snapshot: EditableElementSnapshot
}): EditSelectionPayload {
  const { selector, blockId, snapshot } = args
  const rawZIndex = snapshot.computed.zIndex || ''
  const zIndex = rawZIndex && rawZIndex !== 'auto' ? parseInt(rawZIndex, 10) : undefined
  return {
    selector,
    blockId,
    label: snapshot.label,
    elementTag: snapshot.elementTag,
    elementText: snapshot.elementText,
    kind: snapshot.kind,
    capabilities: snapshot.capabilities,
    snapshot: {
      ...snapshot,
      selector,
      blockId
    },
    isText: Boolean(snapshot.text?.editable),
    text: snapshot.text?.value || '',
    html: snapshot.text?.html || '',
    style: {
      color: snapshot.computed.color || '',
      fontSize: snapshot.computed.fontSize || '',
      fontWeight: snapshot.computed.fontWeight || '',
      textAlign: normalizeTextAlign(snapshot.computed.textAlign),
      lineHeight: snapshot.computed.lineHeight || '',
      backgroundColor: snapshot.computed.backgroundColor || ''
    },
    bounds: snapshot.metrics.viewport,
    viewportBounds: snapshot.metrics.viewport,
    pageBounds: snapshot.metrics.page,
    translateX: snapshot.metrics.translateX,
    translateY: snapshot.metrics.translateY,
    zIndex: Number.isFinite(zIndex) ? zIndex : undefined,
    editability: { x: true, y: true, width: true, height: true }
  }
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
    addMessage
  } = useSessionStore()
  const { createTemplateFromSession } = useTemplateStore()
  const { isGenerating, updateProgress, cancelGeneration, progress, currentPages, error } =
    useGenerateStore()
  const chatType = useSessionDetailUiStore((state) => state.chatType)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const interactionMode = useSessionDetailUiStore((state) => state.interactionMode)
  const setChatType = useSessionDetailUiStore((state) => state.setChatType)
  const resetForPageChange = useSessionDetailUiStore((state) => state.resetForPageChange)
  const resetForSessionChange = useSessionDetailUiStore((state) => state.resetForSessionChange)
  const addPageDialogOpen = useSessionDetailUiStore((state) => state.addPageDialogOpen)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const isManagingPages = useSessionDetailUiStore((state) => state.isManagingPages)
  const sidebarCollapsed = useSessionDetailUiStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useSessionDetailUiStore((state) => state.toggleSidebarCollapsed)
  const assetPickerOpen = useSessionDetailUiStore((state) => state.assetPickerOpen)
  const assetPickerType = useSessionDetailUiStore((state) => state.assetPickerType)
  const setAssetPickerOpen = useSessionDetailUiStore((state) => state.setAssetPickerOpen)
  const speechScriptDialogOpen = useSessionDetailUiStore((state) => state.speechScriptDialogOpen)
  const setSpeechScriptDialogOpen = useSessionDetailUiStore((state) => state.setSpeechScriptDialogOpen)
  const speechConfig = useSessionDetailUiStore((state) => state.speechConfig)
  const setSpeechConfig = useSessionDetailUiStore((state) => state.setSpeechConfig)
  const isGeneratingSpeechScript = useSessionDetailUiStore((state) => state.isGeneratingSpeechScript)
  const speechProgress = useSessionDetailUiStore((state) => state.speechProgress)
  const setAddPageDialogOpen = useSessionDetailUiStore((state) => state.setAddPageDialogOpen)
  const setIsAddingPage = useSessionDetailUiStore((state) => state.setIsAddingPage)
  const activeChatRef = useRef<{ chatType: ChatType; pageId?: string }>({ chatType: 'page' })
  const editHistory = useEditHistoryStore()
  const [isSavingEdits, setIsSavingEdits] = useState(false)
  const [textSelection, setTextSelection] = useState<EditSelectionPayload | null>(null)
  const [textDraft, setTextDraft] = useState<ElementEditDraft>(EMPTY_ELEMENT_DRAFT)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyVersions, setHistoryVersions] = useState<HistoryVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRollbackId, setHistoryRollbackId] = useState<string | null>(null)
  const [rollbackConfirmVersion, setRollbackConfirmVersion] = useState<HistoryVersion | null>(null)
  const [deleteConfirmPage, setDeleteConfirmPage] = useState<SessionPreviewPage | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pendingDeleteSelector, setPendingDeleteSelector] = useState<string | null>(null)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const previewIframeRef = useRef<PreviewIframeHandle | null>(null)
  const sendingMessageRef = useRef(false)
  const [addPageInput, setAddPageInput] = useState('')
  const [blankPageDialogOpen, setBlankPageDialogOpen] = useState(false)
  const [blankPageSourceId, setBlankPageSourceId] = useState<string>('')
  const [titleEditPage, setTitleEditPage] = useState<SessionPreviewPage | null>(null)
  const [titleEditDraft, setTitleEditDraft] = useState('')
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
      useEditHistoryStore.getState().clear()
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
    }, 0)
  }, [resetForPageChange, selectedPage?.pageId])

  const canEditInSessionDetail = useMemo(() => {
    if (!currentSession) return false
    return getEditorGate(currentSession).canEdit
  }, [currentSession])
  const sessionStatus =
    currentSession && typeof (currentSession as { status?: unknown }).status === 'string'
      ? String((currentSession as { status?: unknown }).status)
      : ''
  const historyDisabled =
    isGenerating ||
    isAddingPage ||
    isRetryingSinglePage ||
    historyRollbackId !== null ||
    sessionStatus === 'active'

  const formatHistoryTime = (value: number): string => {
    const timestamp = value > 1e12 ? value : value * 1000
    const parsed = dayjs(timestamp)
    if (!parsed.isValid()) return ''
    return parsed.format('YYYY/MM/DD HH:mm')
  }

  const loadHistoryVersions = async (): Promise<void> => {
    if (!id) return
    setHistoryLoading(true)
    try {
      const versions = await ipc.listHistoryVersions({ sessionId: id, limit: 10 })
      setHistoryVersions(versions)
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('sessionDetail.historyLoadFailed'))
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleOpenHistory = async (): Promise<void> => {
    if (!id || historyDisabled) return
    setHistoryOpen(true)
    await loadHistoryVersions()
  }

  const handleRollbackHistory = async (version: HistoryVersion): Promise<void> => {
    if (!id || version.isCurrent || historyDisabled) return
    setHistoryRollbackId(version.id)
    setRollbackConfirmVersion(null)
    try {
      await ipc.rollbackToHistoryVersion({ sessionId: id, versionId: version.id })
      await loadSession(id)
      useGenerateStore.getState().setPages(useSessionStore.getState().currentGeneratedPages)
      useSessionDetailUiStore.getState().bumpPreviewKey()
      setPreviewRefreshKey((key) => key + 1)
      await loadHistoryVersions()
      toastSuccess(t('sessionDetail.historyRollbackSuccess'))
      setHistoryOpen(false)
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('sessionDetail.historyRollbackFailed'))
    } finally {
      setHistoryRollbackId(null)
    }
  }

  const requestRollbackHistory = (version: HistoryVersion): void => {
    if (version.isCurrent || historyDisabled || historyRollbackId) return
    setRollbackConfirmVersion(version)
  }

  useEffect(() => {
    if (!id) return
    setMessages([])
    useGenerateStore.getState().setPages([])
    resetForSessionChange()
    void loadSession(id)
    // Cleanup on unmount (leaving session-detail)
    return () => {
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
      useSessionDetailUiStore.getState().setSpeechProgress({ current: payload.current, total: payload.total })
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

  const handleSend = async (): Promise<void> => {
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

  const handleCancel = async (): Promise<void> => {
    await ipc.cancelGenerate(id!)
    cancelGeneration()
  }

  const handleOpenAddPageDialog = (): void => {
    setAddPageInput('')
    setAddPageDialogOpen(true)
  }

  const handleOpenBlankPageDialog = (): void => {
    setBlankPageSourceId(selectedPage?.id || normalizedOrderedPages[0]?.id || '')
    setBlankPageDialogOpen(true)
  }

  const handleRetryFailedPage = async (page: SessionPreviewPage): Promise<void> => {
    if (!id || !page.id) return
    useSessionDetailUiStore.getState().setIsRetryingSinglePage(true)
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    try {
      await ipc.retrySinglePage({ sessionId: id, pageId: page.id })
      await loadSession(id)
      useGenerateStore.getState().setPages(useSessionStore.getState().currentGeneratedPages)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.retryPageFailed')
      toastError(message)
    } finally {
      useGenerateStore.getState().finishGeneration()
      useSessionDetailUiStore.getState().setIsRetryingSinglePage(false)
    }
  }

  const handleAddPage = async (): Promise<void> => {
    if (!id || !addPageInput.trim()) return
    const description = addPageInput.trim()
    const beforePageIds = new Set(normalizedOrderedPages.map((page) => page.pageId))
    const beforePageCount = normalizedOrderedPages.length
    setAddPageDialogOpen(false)
    setAddPageInput('')
    setIsAddingPage(true)
    const insertAfter = selectedPage?.pageNumber ?? normalizedOrderedPages.length
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    let targetSelection: string | null | undefined = undefined

    try {
      await ipc.addPage({
        sessionId: id,
        userMessage: description,
        insertAfterPageNumber: insertAfter
      })
      // addPage 返回后，新增页可能尚未写回 session，短轮询确保拿到新页再选中。
      let latestGeneratedPages = useSessionStore.getState().currentGeneratedPages
      let latestPages = normalizePagesForSelection(latestGeneratedPages)
      let addedPage = latestPages.find((page) => !beforePageIds.has(page.pageId))

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await loadSession(id)
        latestGeneratedPages = useSessionStore.getState().currentGeneratedPages
        latestPages = normalizePagesForSelection(latestGeneratedPages)
        addedPage = latestPages.find((page) => !beforePageIds.has(page.pageId))
        if (addedPage || latestPages.length > beforePageCount) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
      }

      useGenerateStore.getState().setPages(latestGeneratedPages)
      const fallbackPage =
        latestPages[Math.min(insertAfter, Math.max(latestPages.length - 1, 0))] ||
        latestPages[latestPages.length - 1]
      targetSelection = (addedPage || fallbackPage)?.id ?? null
      // Only clear script on success — a new page invalidates the existing script
      if (id) void ipc.clearSpeechScript(id).catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.addPageFailed')
      toastError(message)
    } finally {
      useSessionDetailUiStore.getState().finishAddPage(targetSelection)
      useGenerateStore.getState().finishGeneration()
    }
  }

  const handleCreateBlankPage = async (): Promise<void> => {
    if (!id || !blankPageSourceId) return
    const sourcePage = normalizedOrderedPages.find((page) => page.id === blankPageSourceId)
    if (!sourcePage) return
    setBlankPageDialogOpen(false)
    setIsAddingPage(true)
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    let targetSelection: string | null | undefined = undefined

    try {
      const result = await ipc.createBlankSessionPage({
        sessionId: id,
        sourcePageId: sourcePage.id
      })
      useGenerateStore.getState().setPages(result.generatedPages)
      await loadSession(id)
      useGenerateStore.getState().setPages(useSessionStore.getState().currentGeneratedPages)
      targetSelection = result.selectedPageId || null
      useSessionDetailUiStore.getState().bumpPreviewKey()
      void ipc.clearSpeechScript(id).catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.addBlankPageFailed')
      toastError(message)
    } finally {
      useSessionDetailUiStore.getState().finishAddPage(targetSelection)
      useGenerateStore.getState().finishGeneration()
    }
  }

  const handleReorderPages = async (
    orderedPageIds: string[],
    selectedForKeep?: string
  ): Promise<void> => {
    if (!id) return
    useSessionDetailUiStore.getState().setIsManagingPages(true)
    try {
      const result = await ipc.reorderSessionPages({
        sessionId: id,
        orderedPageIds,
        selectedPageId: selectedForKeep
      })
      useGenerateStore.getState().setPages(result.generatedPages)
      useSessionDetailUiStore.getState().setSelectedPageId(result.selectedPageId)
      useSessionDetailUiStore.getState().bumpPreviewKey()
      void ipc.clearSpeechScript(id).catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('pageManagement.reorderFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsManagingPages(false)
    }
  }

  const handleDeletePage = async (page: SessionPreviewPage): Promise<void> => {
    setDeleteConfirmPage(page)
  }

  const handleOpenTitleEditDialog = (page: SessionPreviewPage): void => {
    setTitleEditPage(page)
    setTitleEditDraft(page.title || '')
  }

  const handleSavePageTitle = async (): Promise<void> => {
    if (!id || !titleEditPage) return
    const title = titleEditDraft.replace(/\s+/g, ' ').trim()
    if (!title) {
      toastError(t('pageManagement.pageTitleRequired'))
      return
    }
    if (title === titleEditPage.title) {
      setTitleEditPage(null)
      return
    }
    useSessionDetailUiStore.getState().setIsManagingPages(true)
    try {
      const result = await ipc.updateSessionPageTitle({
        sessionId: id,
        pageId: titleEditPage.id,
        title
      })
      useGenerateStore.getState().setPages(result.generatedPages)
      useSessionDetailUiStore.getState().setSelectedPageId(result.selectedPageId || titleEditPage.id)
      useSessionDetailUiStore.getState().bumpPreviewKey()
      setTitleEditPage(null)
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('pageManagement.updateTitleFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsManagingPages(false)
    }
  }

  const handleConfirmDeletePage = async (): Promise<void> => {
    if (!id) return
    if (!deleteConfirmPage) return
    useSessionDetailUiStore.getState().setIsManagingPages(true)
    try {
      const result = await ipc.deleteSessionPages({
        sessionId: id,
        pageIds: [deleteConfirmPage.id],
        selectedPageId: selectedPageId || undefined
      })
      useGenerateStore.getState().setPages(result.generatedPages)
      useSessionDetailUiStore.getState().setSelectedPageId(result.selectedPageId)
      useSessionDetailUiStore.getState().bumpPreviewKey()
      setDeleteConfirmPage(null)
      void ipc.clearSpeechScript(id).catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('pageManagement.deleteFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsManagingPages(false)
    }
  }

  const cleanMessageContent = (content: string): string =>
    content.replace(
      /[（(](?:目标)?选择器[:：]\s*[^）\n]{8,}[）)]/g,
      t('sessionDetail.selectorLocated')
    )

  const getPptxExportNotice = (warnings?: string[]): string | null => {
    const items = (warnings || []).filter(Boolean)
    if (items.length === 0) return null

    const hasPageLoadDelay = items.some((item) => item.includes('未收到打印就绪信号'))
    if (hasPageLoadDelay) {
      return t('sessionDetail.pageLoadNotice')
    }

    const hasNoEditableText = items.some((item) => item.includes('未提取到可编辑文本'))
    if (hasNoEditableText) {
      return t('sessionDetail.noEditableTextNotice')
    }

    const hasOnlyCapabilityNote = items.every(
      (item) =>
        item.includes('自研') ||
        item.includes('pptxgenjs') ||
        item.includes('HTML 解析器') ||
        item.includes('文本层')
    )
    if (hasOnlyCapabilityNote) return null

    return t('sessionDetail.exportCheckNotice')
  }

  const openProjectPreview = async (): Promise<void> => {
    const basePath = selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath
    if (!basePath) return
    const indexPath = basePath.replace(/[^/\\]+\.html$/i, 'index.html')
    const pageHash = selectedPage?.id || normalizedOrderedPages[0]?.id
    await ipc.openInBrowser(indexPath, pageHash ? `#${pageHash}` : undefined, id || undefined)
  }

  const handleOpenSpeechDialog = (): void => {
    useSessionDetailUiStore.getState().setSpeechScriptDialogOpen(true)
  }

  const handleDoGenerateSpeechScript = async (config: SpeechConfig): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isGeneratingSpeechScript) return
    detailState.setIsGeneratingSpeechScript(true)
    detailState.setSpeechProgress(null)
    const currentPageId = selectedPage?.id
    try {
      const result = await ipc.generateSpeechScript(id, {
        ...config,
        currentPageId: config.scope === 'single' ? currentPageId : undefined
      })
      if (!result.success) {
        toastError(t('sessionDetail.speechScriptError'))
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.speechScriptError'))
    } finally {
      const s = useSessionDetailUiStore.getState()
      s.setIsGeneratingSpeechScript(false)
      s.setSpeechProgress(null)
    }
  }

  const handleExportPdf = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPdf) return
    detailState.setIsExportingPdf(true)
    toastInfo(t('sessionDetail.exportPdfStart'), {
      description: t('sessionDetail.exportPdfDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportPdf(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(t('sessionDetail.exportDonePages', { count: result.pageCount || 0 }), {
          description: result.warnings[0]
        })
        return
      }
      toastSuccess(t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPdf(false)
    }
  }

  const handleExportPng = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPng) return
    detailState.setIsExportingPng(true)
    toastInfo(t('sessionDetail.exportPngStart'), {
      description: t('sessionDetail.exportPngDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportPng(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastWarning(t('sessionDetail.pngExported', { count: result.pageCount || 0 }), {
          description: t('sessionDetail.pageLoadNotice')
        })
        return
      }
      toastSuccess(t('sessionDetail.pngExported', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPng(false)
    }
  }

  const handleExportPptx = async (
    options?: { imageOnly?: boolean; embedFonts?: boolean | 'auto' | 'always' | 'never' }
  ): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingPptx) return
    const imageOnly = options?.imageOnly === true
    detailState.setIsExportingPptx(true)
    toastInfo(
      t(imageOnly ? 'sessionDetail.pptxPreparingImage' : 'sessionDetail.pptxPreparingEditable'),
      {
        description: t(
          imageOnly
            ? 'sessionDetail.pptxPreparingImageDescription'
            : 'sessionDetail.pptxPreparingEditableDescription'
        ),
        duration: 4000
      }
    )
    try {
      const result = await ipc.exportPptx(id, options)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      const exportNotice = getPptxExportNotice(result.warnings)
      if (exportNotice) {
        toastWarning(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
          description: exportNotice
        })
        return
      }
      toastSuccess(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
        description: t(
          imageOnly ? 'sessionDetail.pptxImageDescription' : 'sessionDetail.pptxEditableDescription'
        )
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPptx(false)
    }
  }

  const handleExportSlidePack = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingSlidePack) return
    detailState.setIsExportingSlidePack(true)
    toastInfo(t('sessionDetail.slidePackPreparing'), {
      description: t('sessionDetail.slidePackPreparingDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportSlidePack(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      toastSuccess(t('sessionDetail.slidePackExported'), {
        description: t('sessionDetail.slidePackExportedDescription')
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingSlidePack(false)
    }
  }

  const handleExportSessionZip = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!id || detailState.isExportingSessionZip) return
    detailState.setIsExportingSessionZip(true)
    toastInfo(t('sessionDetail.sessionZipPreparing'), {
      description: t('sessionDetail.sessionZipPreparingDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportSessionZip(id)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      toastSuccess(t('sessionDetail.sessionZipExported'), {
        description: t('sessionDetail.sessionZipExportedDescription')
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingSessionZip(false)
    }
  }

  const handleElementMoved = (payload: EditModeMovePayload): void => {
    if (!id || !selectedPage?.htmlPath || !selectedPage.pageId) return

    // Sync inspector panel layout fields when the selected element is dragged
    // payload.x/y are translate offsets (--ppt-drag-x/y), convert to visual position for display
    if (textSelection && payload.selector === textSelection.selector) {
      const visualX =
        payload.visualX ??
        ((textSelection.pageBounds?.x ?? textSelection.bounds?.x ?? 0) +
          (payload.layoutMode === 'translate' ? payload.x : payload.deltaX))
      const visualY =
        payload.visualY ??
        ((textSelection.pageBounds?.y ?? textSelection.bounds?.y ?? 0) +
          (payload.layoutMode === 'translate' ? payload.y : payload.deltaY))
      setTextDraft((prev) => ({
        ...prev,
        layoutX: String(Math.round(visualX)),
        layoutY: String(Math.round(visualY)),
        ...(payload.width !== undefined ? { layoutWidth: String(Math.round(payload.width)) } : {}),
        ...(payload.height !== undefined ? { layoutHeight: String(Math.round(payload.height)) } : {})
      }))
    }

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
      zIndex: parseInt(textDraft.layoutZIndex, 10) || undefined
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
      useSessionDetailUiStore.getState().setInteractionMode('preview')
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
      // Filter out drag/text edits for elements that are also pending deletion
      const deletedSelectors = new Set(snapshot.deletes.map((d) => d.selector))
      const safeDragEdits = snapshot.dragEdits.filter((e) => !deletedSelectors.has(e.selector))
      const safeTextEdits = snapshot.textEdits.filter((e) => !deletedSelectors.has(e.selector))
      const safePropertyEdits = snapshot.propertyEdits.filter((e) => !deletedSelectors.has(e.selector))
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
      editHistory.clearPage(selectedPage.pageId)
      previewIframeRef.current?.clearEditModeSelection()
      setTextSelection(null)
      setTextDraft(EMPTY_ELEMENT_DRAFT)
      useSessionDetailUiStore.getState().bumpThumbnailVersion(selectedPage.pageId)
      setPreviewRefreshKey((key) => key + 1)
      useSessionDetailUiStore.getState().setInteractionMode('preview')
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
        preload: attrs.preload || 'metadata'
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
        preload: attrs.preload || 'metadata'
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
    if (commitFields.has('objectFit') && draft.objectFit !== (initial.computed.objectFit || 'contain')) {
      style.objectFit = draft.objectFit
    }
    const initialHtml = initial.text?.html || ''
    if (commitFields.has('html') && draft.html.trim() && draft.html.trim() !== initialHtml.trim()) {
      html = draft.html.trim()
    }
    const initialText = textSelection.textTarget?.text ?? initial.text?.value ?? ''
    if (!html && commitFields.has('text') && draft.text.trim() && draft.text.trim() !== initialText) {
      text = draft.text.trim()
    }
    if (commitFields.has('color') && draft.color !== rgbToHex(initial.computed.color)) {
      style.color = draft.color
    }
    if (commitFields.has('fontSize') && draft.fontSize !== fontSizeToNumber(initial.computed.fontSize)) {
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
    if (commitFields.has('playsInline') && draft.playsInline !== (initial.attrs.playsInline !== false)) {
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

    if (textSelection && selectedPage?.htmlPath && selectedPage?.pageId && draft.layoutZIndex !== textDraft.layoutZIndex) {
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
      iframe.injectElement(a.parentSelector, a.htmlFragment)
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
    if (!editHistory.undo()) return
    previewIframeRef.current?.clearEditModeSelection()
    setTextSelection(null)
    setTextDraft(EMPTY_ELEMENT_DRAFT)
    setPreviewRefreshKey((key) => key + 1)
  }

  const handleRedo = (): void => {
    if (!editHistory.redo()) return
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

  const handleCopyElement = (): void => {
    if (!textSelection || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const newSelector = previewIframeRef.current?.copyElement(textSelection.selector, blockId)
    if (!newSelector) return
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
      htmlFragment: '',
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
      bounds: bounds ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height } : undefined,
      pageBounds: bounds ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height } : undefined,
      translateX: 0,
      translateY: 0,
      zIndex: parseInt(zValue, 10),
      editability: { x: true, y: true, width: true, height: true }
    })
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
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await previewIframeRef.current?.readElementSnapshot(selector)
    if (!snapshot) return
    handleElementSelected(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddElement = (relativePath: string, _fileName: string): void => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const isVideo = /^\.\/videos\//i.test(relativePath)
    // Offset each added element so they don't overlap
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_MEDIA_OFFSET_STEP
    const w = isVideo ? 640 : 400
    const h = isVideo ? 360 : 300
    const left = Math.min(400 + offset, PPT_PAGE_WIDTH - w - ADDED_ELEMENT_EDGE_PADDING)
    const top = Math.min(200 + offset, PPT_PAGE_HEIGHT - h - ADDED_ELEMENT_EDGE_PADDING)
    const zIdx = 10 + existingCount
    const htmlFragment = isVideo
      ? `<video src="${relativePath}" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:contain;" controls playsinline preload="metadata"></video>`
      : `<img src="${relativePath}" alt="" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:contain;" />`
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)
    // Auto-select the newly added element and show inspector panel
    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    handleElementSelected({
      selector,
      label: selector,
      elementTag: isVideo ? 'video' : 'img',
      elementText: '',
      isText: false,
      text: '',
      style: {},
      bounds: { x: left, y: top, width: w, height: h },
      translateX: 0,
      translateY: 0,
      zIndex: zIdx,
      editability: { x: true, y: true, width: true, height: true }
    })
  }

  const handleUploadAndAdd = async (assetType: 'image' | 'video'): Promise<void> => {
    if (!id) return
    const result = await ipc.chooseAndUploadAssets(id, assetType)
    if (result.cancelled || !result.assets?.length) return
    const asset = result.assets[0]
    handleAddElement(asset.relativePath, asset.originalName || asset.fileName)
  }

  const handleSaveTemplate = async (payload: {
    name: string
    description: string
    tags: string[]
  }): Promise<void> => {
    if (!id || savingTemplate) return
    setSavingTemplate(true)
    try {
      await createTemplateFromSession({
        sessionId: id,
        ...payload
      })
      toastSuccess('已保存为模板', {
        action: {
          label: '查看模板',
          onClick: () => navigate('/templates')
        }
      })
      setSaveTemplateOpen(false)
    } catch (err) {
      toastError('保存模板失败', {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setSavingTemplate(false)
    }
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div
        className="flex h-full min-h-0 flex-col bg-[#f5f1e8] text-foreground outline-none"
      >
        <header className="app-drag-region app-titlebar relative shrink-0 bg-[#f5f1e8]/95 shadow-[0_10px_26px_rgba(93,107,77,0.055)] backdrop-blur-xl">
          <div className="absolute left-0 top-0 h-full w-[220px] bg-[#f5f1e8]" />
          <div
            className={`relative flex h-full items-center justify-end pl-[244px] ${
              isMac ? 'px-3' : 'pr-[calc(var(--app-titlebar-control-safe-area)+16px)]'
            }`}
          >
            <div className="app-no-drag flex items-center gap-1.5">
              <SessionToolbar
                hasPages={normalizedOrderedPages.length > 0}
                historyDisabled={historyDisabled}
                canPreview={Boolean(selectedPage?.htmlPath || normalizedOrderedPages[0]?.htmlPath)}
                canRevealFile={Boolean(selectedPage?.htmlPath)}
                onExportPdf={() => void handleExportPdf()}
                onExportPng={() => void handleExportPng()}
                onExportPptx={(options) => void handleExportPptx(options)}
                onExportSessionZip={() => void handleExportSessionZip()}
                onExportSlidePack={() => void handleExportSlidePack()}
                onOpenHistory={() => void handleOpenHistory()}
                onOpenPreview={() => void openProjectPreview()}
                onRevealFile={() => {
                  if (selectedPage?.htmlPath) {
                    void ipc.revealFile(selectedPage.htmlPath, id || undefined)
                  }
                }}
                onSaveTemplate={() => setSaveTemplateOpen(true)}
                onPresent={() => {
                  const idx = normalizedOrderedPages.findIndex((p) => p.id === selectedPageId)
                  void ipc.openPresentation({
                    sessionId: id || '',
                    startIndex: idx >= 0 ? idx : 0
                  })
                }}
              />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-[#f5f1e8]">
          <PageSidebar
            pages={normalizedOrderedPages}
            disabled={interactionMode === 'ai-inspect' && isGenerating}
            onAddBlankPage={handleOpenBlankPageDialog}
            onAddPage={handleOpenAddPageDialog}
            onRetryFailedPage={handleRetryFailedPage}
            onReorderPages={handleReorderPages}
            onDeletePage={handleDeletePage}
            onRenamePage={handleOpenTitleEditDialog}
            pageManagementDisabled={isGenerating || isAddingPage || isRetryingSinglePage || isManagingPages}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            <PreviewToolbar
              selectedPage={selectedPage}
              isGenerating={isGenerating}
              isSavingEdits={isSavingEdits}
              canUndo={editHistory.canUndo()}
              canRedo={editHistory.canRedo()}
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
              onUndo={handleUndo}
              onRedo={handleRedo}
              onSaveAllEdits={() => void handleSaveAllEdits()}
              onDiscardAllEdits={handleDiscardAllEdits}
              onAddText={() => void handleAddTextElement()}
              onAddFromLibrary={(type) => setAssetPickerOpen(true, type)}
              onAddFromLocal={(type) => void handleUploadAndAdd(type)}
              onOpenSpeechScript={handleOpenSpeechDialog}
            />
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
                onReplayPendingEdits={replayPendingEdits}
                onDeleteRequest={(selector) => {
                  setPendingDeleteSelector(selector)
                  setDeleteConfirmOpen(true)
                }}
              />
              {speechScriptDialogOpen && id && (
                <SpeechScriptDrawer
                  sessionId={id}
                  isGenerating={isGeneratingSpeechScript}
                  speechProgress={speechProgress}
                  speechConfig={speechConfig}
                  onConfigChange={setSpeechConfig}
                  onGenerate={(config) => void handleDoGenerateSpeechScript(config)}
                  onClose={() => setSpeechScriptDialogOpen(false)}
                  currentPageNumber={selectedPage?.pageNumber}
                  currentPageTitle={selectedPage?.title || undefined}
                />
              )}
              {interactionMode === 'edit' && textSelection && (
                <ElementInspectorPanel
                  selection={textSelection}
                  draft={textDraft}
                  onDraftChange={handleTextDraftChange}
                  onClose={handleCancelTextEdit}
                  onCopy={handleCopyElement}
                  onDelete={handleDeleteElement}
                />
              )}
              {interactionMode === 'ai-inspect' && (
                <MessagePanel
                  selectedPageExists={Boolean(selectedPage?.pageId)}
                  selectedPageNumber={selectedPage?.pageNumber}
                  isGenerating={isGenerating}
                  progress={progress}
                  error={error}
                  onDropFiles={(files) => void uploadFiles(files)}
                  onChooseAssets={(assetType) => void handleChooseAssets(assetType)}
                  onSend={() => void handleSend()}
                  onCancel={() => void handleCancel()}
                  cleanMessageContent={cleanMessageContent}
                />
              )}
            </div>
          </div>

        </div>

        {historyOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="flex max-h-[78vh] w-[560px] flex-col rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#e8e0d0] px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-[#2f3a2a]">
                    {t('sessionDetail.historyTitle')}
                  </h3>
                  <p className="mt-1 text-xs text-[#8a9a7b]">{t('sessionDetail.historyRecent')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-lg px-2 py-1 text-sm text-[#6f7d62] hover:bg-[#f2efe7]"
                  disabled={Boolean(historyRollbackId)}
                >
                  {t('common.cancel')}
                </button>
              </div>
              <div className="min-h-[220px] overflow-y-auto px-5 py-4">
                {historyLoading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-[#8a9a7b]">
                    {t('sessionDetail.historyLoading')}
                  </div>
                ) : historyVersions.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center text-center">
                    <p className="text-sm font-medium text-[#3e4a32]">
                      {t('sessionDetail.historyEmptyTitle')}
                    </p>
                    <p className="mt-2 text-xs text-[#8a9a7b]">
                      {t('sessionDetail.historyEmptyDescription')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyVersions.map((version) => {
                      const rollbackDisabled =
                        version.isCurrent ||
                        !version.isRestorable ||
                        historyDisabled ||
                        Boolean(historyRollbackId)
                      return (
                        <div
                          key={version.id}
                          className="rounded-xl border border-[#e8e0d0] bg-[#faf8f2] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-[#2f3a2a]">
                                  {version.title}
                                </p>
                                {version.isCurrent && (
                                  <span className="rounded-full bg-[#d4e4c1] px-2 py-0.5 text-[10px] font-medium text-[#3e4a32]">
                                    {t('sessionDetail.historyCurrent')}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-[#8a9a7b]">
                                {formatHistoryTime(version.createdAt)}
                              </p>
                              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#5d6b4d]">
                                {version.description}
                              </p>
                              {version.changedPages.length > 0 && (
                                <p className="mt-2 text-[11px] text-[#7b6d55]">
                                  {t('sessionDetail.historyChangedPages', {
                                    pages: version.changedPages.join('、')
                                  })}
                                </p>
                              )}
                            </div>
                            {!version.isCurrent && (
                              <button
                                type="button"
                                disabled={rollbackDisabled}
                                onClick={() => requestRollbackHistory(version)}
                                className="shrink-0 rounded-lg bg-[#3e4a32] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#2f3a2a] disabled:cursor-not-allowed disabled:bg-[#c8c0b3]"
                              >
                                {historyRollbackId === version.id
                                  ? t('sessionDetail.historyRollingBack')
                                  : t('sessionDetail.historyRollback')}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add Blank Page Dialog */}
        {blankPageDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-[520px] rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="mb-2 text-base font-semibold text-[#2f3a2a]">
                {t('sessionDetail.addBlankPage')}
              </h3>
              <p className="mb-4 text-xs leading-5 text-[#8a9a7b]">
                {t('sessionDetail.addBlankPageHint')}
              </p>
              <div className="mb-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {normalizedOrderedPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setBlankPageSourceId(page.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                      blankPageSourceId === page.id
                        ? 'border-[#8eaa70] bg-[#eef6e7] text-[#2f3a2a]'
                        : 'border-[#d4e4c1]/60 bg-[#f8f6f0] text-[#5d6b4d] hover:bg-[#f0ece3]'
                    }`}
                  >
                    <span className="shrink-0 rounded-md bg-[#d4e4c1]/70 px-2 py-1 text-[11px] font-semibold text-[#3e4a32]">
                      P{page.pageNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {page.title || t('sessionDetail.untitledPage')}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBlankPageDialogOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-[#5d6b4d] transition-colors hover:bg-[#f0ece3] cursor-pointer"
                >
                  {t('sessionDetail.addPageCancel')}
                </button>
                <button
                  type="button"
                  disabled={!blankPageSourceId}
                  onClick={() => void handleCreateBlankPage()}
                  className="rounded-xl bg-[#5d6b4d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  {t('sessionDetail.addBlankPageCreate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Page Dialog */}
        {addPageDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-[520px] rounded-2xl bg-white p-6 shadow-2xl">
              <h3 className="mb-3 text-base font-semibold text-[#2f3a2a]">
                {t('sessionDetail.addPage')}
              </h3>
              <p className="mb-3 text-xs text-[#8a9a7b]">{t('sessionDetail.addPageHint')}</p>
              <textarea
                value={addPageInput}
                onChange={(e) => setAddPageInput(e.target.value)}
                placeholder={t('sessionDetail.addPageDescription')}
                className="mb-4 h-40 w-full resize-none rounded-xl border border-[#d4e4c1]/60 bg-[#f8f6f0] px-4 py-3 text-sm leading-relaxed text-[#2f3a2a] placeholder:text-[#8a9a7b] focus:border-[#5d6b4d] focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && addPageInput.trim()) {
                    e.preventDefault()
                    void handleAddPage()
                  }
                  if (e.key === 'Escape') {
                    setAddPageDialogOpen(false)
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddPageDialogOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-[#5d6b4d] transition-colors hover:bg-[#f0ece3] cursor-pointer"
                >
                  {t('sessionDetail.addPageCancel')}
                </button>
                <button
                  type="button"
                  disabled={!addPageInput.trim()}
                  onClick={() => void handleAddPage()}
                  className="rounded-xl bg-[#5d6b4d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3e4a32] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t('sessionDetail.addPageGenerate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Page Progress Overlay */}
        {isAddingPage && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="flex w-[360px] flex-col items-center gap-4 rounded-2xl bg-white/95 px-8 py-6 shadow-2xl">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4e4c1] border-t-[#5d6b4d]" />
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-sm font-medium text-[#3e4a32]">
                  {progress?.label || t('sessionDetail.addPageGenerating')}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8e0d0]">
                  <div
                    className="h-full rounded-full bg-[#5d6b4d] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.progress ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Retry Single Page Progress Overlay */}
        {isRetryingSinglePage && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="flex w-[360px] flex-col items-center gap-4 rounded-2xl bg-white/95 px-8 py-6 shadow-2xl">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#f3e4df] border-t-[#93564f]" />
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-sm font-medium text-[#93564f]">
                  {progress?.label || t('sessionDetail.retryPageGenerating')}
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8e0d0]">
                  <div
                    className="h-full rounded-full bg-[#93564f] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress?.progress ?? 0))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <Dialog
          open={Boolean(titleEditPage)}
          onOpenChange={(open) => {
            if (!open && !isManagingPages) setTitleEditPage(null)
          }}
        >
          <DialogContent showClose={!isManagingPages}>
            <DialogHeader>
              <DialogTitle>{t('pageManagement.editPageTitle')}</DialogTitle>
              <DialogDescription>{t('pageManagement.editPageTitleDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#5d6b4d]" htmlFor="page-title-input">
                {t('pageManagement.pageTitleLabel')}
              </label>
              <Input
                id="page-title-input"
                value={titleEditDraft}
                onChange={(event) => setTitleEditDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSavePageTitle()
                  }
                }}
                placeholder={t('pageManagement.pageTitlePlaceholder')}
                disabled={isManagingPages}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTitleEditPage(null)}
                disabled={isManagingPages}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSavePageTitle()}
                disabled={isManagingPages || !titleEditDraft.trim()}
              >
                {t('pageManagement.savePageTitle')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(deleteConfirmPage)}
          onOpenChange={(open) => {
            if (!open && !isManagingPages) setDeleteConfirmPage(null)
          }}
        >
          <DialogContent showClose={false}>
            <DialogHeader>
              <DialogTitle>{t('pageManagement.deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('pageManagement.deleteConfirmDescription')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmPage(null)}
                disabled={isManagingPages}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => void handleConfirmDeletePage()}
                disabled={isManagingPages}
              >
                {t('pageManagement.deleteConfirmAction')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(rollbackConfirmVersion)}
          onOpenChange={(open) => {
            if (!open && !historyRollbackId) setRollbackConfirmVersion(null)
          }}
        >
          <DialogContent showClose={false}>
            <DialogHeader>
              <DialogTitle>{t('sessionDetail.historyRollback')}</DialogTitle>
              <DialogDescription>{t('sessionDetail.historyRollbackConfirm')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRollbackConfirmVersion(null)}
                disabled={Boolean(historyRollbackId)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  rollbackConfirmVersion && void handleRollbackHistory(rollbackConfirmVersion)
                }
                disabled={Boolean(historyRollbackId)}
              >
                {historyRollbackId
                  ? t('sessionDetail.historyRollingBack')
                  : t('sessionDetail.historyRollback')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AssetPickerDialog
          sessionId={id || ''}
          assetType={assetPickerType}
          open={assetPickerOpen}
          onClose={() => setAssetPickerOpen(false)}
          onConfirm={handleAddElement}
        />
        <SaveTemplateDialog
          open={saveTemplateOpen}
          defaultName={currentSession?.title || '未命名模板'}
          saving={savingTemplate}
          onOpenChange={setSaveTemplateOpen}
          onSubmit={(payload) => void handleSaveTemplate(payload)}
        />
        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={(open) => {
            setDeleteConfirmOpen(open)
            if (!open) setPendingDeleteSelector(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogTitle>{t('sessionDetail.deleteElement')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sessionDetail.deleteElementConfirm')}
            </AlertDialogDescription>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#c0392b] text-white hover:bg-[#a93226]"
                onClick={() => {
                  if (pendingDeleteSelector) {
                    handleDeleteBySelector(pendingDeleteSelector)
                  } else {
                    handleDeleteElement()
                  }
                  setPendingDeleteSelector(null)
                  setDeleteConfirmOpen(false)
                }}
              >
                {t('common.delete')}
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}
