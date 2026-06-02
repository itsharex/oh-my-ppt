import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  FilePlus2,
  Home,
  Move,
  PanelLeft,
  PanelRight,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useGenerateStore, useSessionStore } from '@renderer/store'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ScrollArea } from '../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { PageThumbnail } from './PageThumbnail'
import type { SessionPreviewPage } from './types'
import { useT } from '@renderer/i18n'

function SortablePageItem({
  id,
  disabled,
  children
}: {
  id: string
  disabled: boolean
  children: (bindings: {
    attributes: ReturnType<typeof useSortable>['attributes']
    listeners: ReturnType<typeof useSortable>['listeners']
    setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
    isDragging: boolean
  }) => React.ReactNode
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id,
    disabled
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  )
}

const getPageOutlineText = (page: SessionPreviewPage): string => {
  return page.contentOutline?.trim() || ''
}

const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

export const PageSidebar = memo(function PageSidebar({
  pages,
  disabled = false,
  onAddBlankPage,
  onAddPage,
  onRetryFailedPage,
  onReorderPages,
  onDeletePage,
  onRenamePage,
  onUpdatePageOutline,
  pageManagementDisabled = false,
  collapsed = false,
  onToggleCollapsed
}: {
  pages: SessionPreviewPage[]
  disabled?: boolean
  onAddBlankPage?: () => void
  onAddPage?: () => void
  onRetryFailedPage?: (page: SessionPreviewPage) => void
  onReorderPages?: (orderedPageIds: string[], selectedPageId?: string) => Promise<void> | void
  onDeletePage?: (page: SessionPreviewPage) => void
  onRenamePage?: (page: SessionPreviewPage) => void
  onUpdatePageOutline?: (page: SessionPreviewPage, contentOutline: string) => Promise<void> | void
  pageManagementDisabled?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const t = useT()
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const thumbnailVersions = useSessionDetailUiStore((state) => state.thumbnailVersions)
  const setSelectedPageId = useSessionDetailUiStore((state) => state.setSelectedPageId)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const [activeView, setActiveView] = useState<'pages' | 'outline'>('pages')
  const [copiedOutlinePageId, setCopiedOutlinePageId] = useState<string | null>(null)
  const [editingOutlinePageId, setEditingOutlinePageId] = useState<string | null>(null)
  const [outlineDraft, setOutlineDraft] = useState('')
  const [savingOutlinePageId, setSavingOutlinePageId] = useState<string | null>(null)
  const wasAddingRef = useRef(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const resetSessionRuntimeState = useSessionStore((state) => state.resetRuntimeState)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const sortableIds = useMemo(() => pages.map((p) => p.id), [pages])

  // Keep selected thumbnail in view when add-page completes (isAddingPage: true -> false).
  // Fallback to bottom if selected thumbnail is not found yet.
  useEffect(() => {
    if (wasAddingRef.current && !isAddingPage && viewportRef.current) {
      const viewport = viewportRef.current
      const selectedNode =
        selectedPageId
          ? viewport.querySelector<HTMLElement>(`[data-page-id="${selectedPageId}"]`)
          : null

      if (selectedNode) {
        selectedNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
    wasAddingRef.current = isAddingPage
  }, [isAddingPage, selectedPageId, pages.length])

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    }
  }, [])

  const handleBackToSessions = (): void => {
    useGenerateStore.getState().reset()
    useSessionDetailUiStore.getState().resetForSessionChange()
    resetSessionRuntimeState()
    navigate('/sessions')
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (!onReorderPages || pageManagementDisabled || disabled) return
    const oldIndex = pages.findIndex((p) => p.id === String(active.id))
    const newIndex = pages.findIndex((p) => p.id === String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const next = arrayMove(pages, oldIndex, newIndex)
    void onReorderPages(
      next.map((p) => p.id),
      String(active.id)
    )
  }

  const handleCopyOutline = async (page: SessionPreviewPage, outlineText: string): Promise<void> => {
    const title = (page.title || t('sessionDetail.untitledPage')).trim()
    const content = outlineText.trim()
    const text = [title, content].filter(Boolean).join('\n')
    if (!text) return
    await copyTextToClipboard(text)
    setCopiedOutlinePageId(page.id)
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedOutlinePageId((current) => (current === page.id ? null : current))
      copyResetTimerRef.current = null
    }, 1600)
  }

  const handleStartEditOutline = (page: SessionPreviewPage, outlineText: string): void => {
    setSelectedPageId(page.id)
    setEditingOutlinePageId(page.id)
    setOutlineDraft(outlineText)
  }

  const handleCancelEditOutline = (): void => {
    setEditingOutlinePageId(null)
    setOutlineDraft('')
  }

  const handleSaveOutline = async (page: SessionPreviewPage): Promise<void> => {
    if (!onUpdatePageOutline || savingOutlinePageId) return
    const normalizedDraft = outlineDraft.replace(/\s+/g, ' ').trim()
    if (normalizedDraft === getPageOutlineText(page)) {
      handleCancelEditOutline()
      return
    }
    setSavingOutlinePageId(page.id)
    try {
      await onUpdatePageOutline(page, normalizedDraft)
      handleCancelEditOutline()
    } finally {
      setSavingOutlinePageId(null)
    }
  }

  return (
    <aside
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-[#f5f1e8] pb-3 pt-3 shadow-[inset_-16px_0_30px_rgba(93,107,77,0.045)] transition-[width] duration-300 ${
        collapsed ? 'w-[48px] min-w-[48px] max-w-[48px]' : 'w-[220px] min-w-[220px] max-w-[220px]'
      }`}
    >
      <div className={`flex min-h-0 flex-1 flex-col ${collapsed ? 'px-1' : 'px-2.5'}`}>
      {collapsed ? (
        // Collapsed: compact icons
        <>
          {/* Top: back + page count */}
          <div className="mb-2 space-y-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleBackToSessions}
                  className="flex h-8 w-full items-center justify-center rounded-xl bg-[#e8e0d0]/72 text-[#5d6b4d] shadow-[0_4px_10px_rgba(93,107,77,0.08)] transition-colors hover:bg-[#d4e4c1]/78 hover:text-[#3e4a32] cursor-pointer"
                  aria-label={t('sessionDetail.backToSessions')}
                >
                  <Home className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('sessionDetail.backToSessions')}</TooltipContent>
            </Tooltip>
            <div className="text-center text-[10px] font-semibold text-[#5c6c47]">
              {pages.length}
            </div>
          </div>

          {/* Middle: page list */}
          <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="overflow-x-hidden pb-2" viewportRef={viewportRef}>
            <div className="space-y-1.5">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  data-page-id={page.id}
                  onClick={() => !disabled && setSelectedPageId(page.id)}
                  className={`flex h-8 w-full items-center justify-center rounded-xl text-xs font-semibold transition-all ${selectedPageId === page.id ? 'bg-[#d4e4c1]/86 text-[#3e4a32] shadow-[0_4px_12px_rgba(93,107,77,0.15)]' : 'text-[#5c6c47] hover:bg-[#e8e0d0]/50'}`}
                >
                  P{page.pageNumber}
                </button>
              ))}
            </div>
          </ScrollArea>

          {/* Bottom: add page + expand */}
          <div className="mt-2 space-y-1.5">
            {(onAddBlankPage || onAddPage) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    title={t('sessionDetail.addPage')}
                    aria-label={t('sessionDetail.addPage')}
                    className="flex h-8 w-full items-center justify-center rounded-xl bg-[#d4e4c1]/30 text-[#5d6b4d] transition-colors hover:bg-[#d4e4c1]/50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-max min-w-[9rem]">
                  {onAddBlankPage ? (
                    <DropdownMenuItem onSelect={onAddBlankPage}>
                      <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-[#5f6b50]" />
                      <span className="whitespace-nowrap">{t('sessionDetail.addBlankPage')}</span>
                    </DropdownMenuItem>
                  ) : null}
                  {onAddPage ? (
                    <DropdownMenuItem onSelect={onAddPage}>
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                      <span className="whitespace-nowrap">{t('sessionDetail.addGeneratedPage')}</span>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onToggleCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="flex h-8 w-full items-center justify-center rounded-xl text-[#7a875f] transition-colors hover:bg-[#e8e0d0]/50 hover:text-[#3e4a32] cursor-pointer"
                    aria-label={t('sessionDetail.expandSidebar')}
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sessionDetail.expandSidebar')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </>
      ) : (
        // Expanded: full sidebar
        <>
          {/* Top: back + page count */}
          <div className="relative mb-3 flex items-center justify-between overflow-hidden rounded-[1.35rem] bg-[#e8e0d0]/72 px-2 py-1.5 shadow-[0_10px_24px_rgba(93,107,77,0.08)]">
            <div className="pointer-events-none absolute -right-6 -top-7 h-20 w-20 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#d4e4c1]/62" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleBackToSessions}
                  className="relative inline-flex h-8 w-8 items-center justify-center rounded-[38%_62%_44%_56%/55%_45%_55%_45%] bg-[#f5f1e8]/72 text-[#5d6b4d] shadow-[0_4px_10px_rgba(93,107,77,0.08)] transition-colors hover:bg-[#d4e4c1]/78 hover:text-[#3e4a32] cursor-pointer"
                  aria-label={t('sessionDetail.backToSessions')}
                >
                  <Home className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('sessionDetail.backToSessions')}</TooltipContent>
            </Tooltip>
            <div className="relative rounded-full bg-[#d4e4c1]/74 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3e4a32] shadow-[0_3px_8px_rgba(93,107,77,0.08)]">
              {t('sessionDetail.pagesCount', { count: pages.length })}
            </div>
          </div>

          <div className="mb-2 grid grid-cols-2 rounded-full border border-[#ded2bd]/60 bg-[#e8e0d0]/46 p-0.5 text-[11px] font-medium text-[#6a705d]">
            <button
              type="button"
              onClick={() => setActiveView('pages')}
              className={`h-7 rounded-full transition-all ${
                activeView === 'pages'
                  ? 'bg-[#fffaf1]/90 text-[#3e4a32] shadow-[0_4px_10px_rgba(93,107,77,0.1)]'
                  : 'hover:bg-[#fffaf1]/42 hover:text-[#4f6340]'
              }`}
            >
              {t('sessionDetail.pageTab')}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('outline')}
              className={`h-7 rounded-full transition-all ${
                activeView === 'outline'
                  ? 'bg-[#fffaf1]/90 text-[#3e4a32] shadow-[0_4px_10px_rgba(93,107,77,0.1)]'
                  : 'hover:bg-[#fffaf1]/42 hover:text-[#4f6340]'
              }`}
            >
              {t('sessionDetail.outlineTab')}
            </button>
          </div>

          {/* Middle: page list */}
          <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="overflow-x-hidden px-0.5 pb-2" viewportRef={viewportRef}>
            {pages.length === 0 ? (
              <div className="flex min-h-[96px] items-center justify-center rounded-[1.25rem] bg-[#e8e0d0]/54 text-xs text-[#8a9a7b]">
                {t('sessionDetail.pagesEmpty')}
              </div>
            ) : activeView === 'outline' ? (
              <div className="min-w-0 space-y-1.5 overflow-x-hidden">
                {pages.map((page) => {
                  const outlineText = getPageOutlineText(page)
                  const selected = selectedPageId === page.id
                  const copied = copiedOutlinePageId === page.id
                  const editing = editingOutlinePageId === page.id
                  const savingOutline = savingOutlinePageId === page.id
                  return (
                    <div
                      key={page.id}
                      data-page-id={page.id}
                      title={outlineText || page.title}
                      className={`group relative block w-full min-w-0 max-w-full whitespace-normal rounded-[1.25rem] p-1.5 text-left transition-all ${
                        selected
                          ? 'bg-[#d4e4c1]/86 shadow-[0_14px_26px_rgba(93,107,77,0.18)]'
                          : 'bg-[#e8e0d0]/34 hover:bg-[#e8e0d0]/68 hover:shadow-[0_8px_18px_rgba(93,107,77,0.09)]'
                      } ${disabled ? 'opacity-45' : ''}`}
                    >
                      {editing ? (
                        <div className="block min-w-0 max-w-full overflow-hidden rounded-[1rem] bg-[#fffaf1]/72 px-2.5 py-2 shadow-[0_5px_14px_rgba(93,107,77,0.08)]">
                          <p className="mb-1 whitespace-normal break-words text-[12px] font-semibold leading-5 text-[#33402a] [overflow-wrap:anywhere]">
                            {page.title || t('sessionDetail.untitledPage')}
                          </p>
                          <textarea
                            value={outlineDraft}
                            onChange={(event) => setOutlineDraft(event.target.value)}
                            disabled={savingOutline}
                            className="min-h-[84px] w-full resize-none rounded-lg border border-[#d8cfbc]/80 bg-[#fffdf8]/90 px-2 py-1.5 text-[11px] leading-4 text-[#514736] shadow-inner outline-none focus:border-[#9bb98a] disabled:opacity-60"
                            placeholder={t('pageManagement.pageOutlinePlaceholder')}
                            autoFocus
                          />
                          <div className="mt-1.5 flex justify-end gap-1">
                            <button
                              type="button"
                              disabled={savingOutline}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleCancelEditOutline()
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f1e7d6] text-[#756955] transition-colors hover:bg-[#e8ddca] disabled:opacity-50"
                              aria-label={t('common.cancel')}
                              title={t('common.cancel')}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={savingOutline}
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleSaveOutline(page)
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#5d6b4d] text-white shadow-[0_4px_10px_rgba(62,74,50,0.18)] transition-colors hover:bg-[#4d5a40] disabled:opacity-50"
                              aria-label={t('pageManagement.savePageOutline')}
                              title={t('pageManagement.savePageOutline')}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setSelectedPageId(page.id)}
                          className="block w-full min-w-0 cursor-pointer rounded-[1rem] text-left disabled:cursor-not-allowed"
                        >
                          <span className="block min-w-0 max-w-full overflow-hidden rounded-[1rem] bg-[#fffaf1]/72 px-2.5 py-2 pr-16 shadow-[0_5px_14px_rgba(93,107,77,0.08)]">
                            <span className="block whitespace-normal break-words text-[12px] font-semibold leading-5 text-[#33402a] [overflow-wrap:anywhere]">
                              {page.title || t('sessionDetail.untitledPage')}
                            </span>
                            <span className="mt-1 block whitespace-normal break-words text-[11px] leading-4 text-[#716654] [overflow-wrap:anywhere]">
                              {outlineText || t('sessionDetail.outlineEmpty')}
                            </span>
                          </span>
                        </button>
                      )}
                      {!editing && onUpdatePageOutline ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={pageManagementDisabled || disabled}
                              onClick={(event) => {
                                event.stopPropagation()
                                handleStartEditOutline(page, outlineText)
                              }}
                              className="absolute right-10 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f5f1e8]/88 text-[#697659] opacity-0 shadow-[0_4px_10px_rgba(93,107,77,0.12)] transition-all hover:bg-[#d4e4c1] hover:text-[#3e4a32] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                              aria-label={t('pageManagement.editPageOutline')}
                            >
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {t('pageManagement.editPageOutline')}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={!outlineText || editing}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleCopyOutline(page, outlineText)
                            }}
                            className={`absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                              copied
                                ? 'bg-[#5d6b4d] text-white shadow-[0_5px_12px_rgba(62,74,50,0.2)]'
                                : 'bg-[#f5f1e8]/88 text-[#697659] opacity-0 shadow-[0_4px_10px_rgba(93,107,77,0.12)] hover:bg-[#d4e4c1] hover:text-[#3e4a32] group-hover:opacity-100 focus-visible:opacity-100'
                            } disabled:cursor-not-allowed disabled:opacity-0`}
                            aria-label={
                              copied
                                ? t('sessionDetail.outlineCopied')
                                : t('sessionDetail.copyOutline')
                            }
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {copied ? t('sessionDetail.outlineCopied') : t('sessionDetail.copyOutline')}
                        </TooltipContent>
                      </Tooltip>
                      <span className="relative mt-1.5 flex items-center justify-between gap-1 px-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6c47]">
                          P{page.pageNumber}
                        </span>
                        {selected ? (
                          <span className="rounded-full bg-[#5d6b4d] px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-[0_3px_8px_rgba(62,74,50,0.18)]">
                            {t('sessionDetail.current')}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2.5">
                    {pages.map((page) => (
                      <div key={page.id} data-page-id={page.id}>
                        <SortablePageItem id={page.id} disabled={pageManagementDisabled || disabled}>
                          {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                            <PageThumbnail
                              page={page}
                              isSelected={selectedPageId === page.id}
                              previewVersion={previewKey + (thumbnailVersions[page.pageId] || 0)}
                              onSelect={disabled ? undefined : setSelectedPageId}
                              actions={
                                <div className="absolute inset-x-1 top-1 z-10 flex items-start justify-between opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    type="button"
                                    ref={setActivatorNodeRef}
                                    disabled={pageManagementDisabled || disabled}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                    }}
                                    className="cursor-grab rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label={t('pageManagement.dragHandle')}
                                    title={t('pageManagement.dragHandle')}
                                    {...attributes}
                                    {...listeners}
                                  >
                                    <Move className={`h-4 w-4 ${isDragging ? 'opacity-60' : ''}`} />
                                  </button>
                                  <div className="flex items-center gap-1">
                                    {onRenamePage ? (
                                      <button
                                        type="button"
                                        disabled={pageManagementDisabled || disabled}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onRenamePage(page)
                                        }}
                                        className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label={t('pageManagement.editPageTitle')}
                                        title={t('pageManagement.editPageTitle')}
                                      >
                                        <PencilLine className="h-3.5 w-3.5" />
                                      </button>
                                    ) : null}
                                    {onDeletePage ? (
                                      <button
                                        type="button"
                                        disabled={pageManagementDisabled || disabled || pages.length <= 1}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onDeletePage(page)
                                        }}
                                        className="rounded bg-white/90 p-1 shadow-sm"
                                        aria-label={t('pageManagement.deletePage')}
                                        title={t('pageManagement.deletePage')}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              }
                            />
                          )}
                        </SortablePageItem>
                        {page.status === 'failed' && onRetryFailedPage && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              setSelectedPageId(page.id)
                              onRetryFailedPage(page)
                            }}
                            className="group mt-1 block w-full rounded-[1.1rem] bg-[#f3e4df]/85 p-1.5 text-left shadow-[0_8px_18px_rgba(142,90,83,0.08)] transition-all duration-200 hover:bg-[#f1ddd7] hover:shadow-[0_10px_22px_rgba(142,90,83,0.12)] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <div className="rounded-[0.9rem] border border-[#d7b5ae]/70 bg-[#fbf1ee] px-2.5 py-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#a36a63]">
                                P{page.pageNumber}
                              </div>
                              <div className="mt-1 text-[11px] font-medium leading-4 text-[#93564f]">
                                {t('sessionDetail.retryFailedPage')}
                              </div>
                            </div>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </ScrollArea>

          {/* Bottom: add page + collapse */}
          <div className="mt-2 flex items-center gap-1.5">
            {(onAddBlankPage || onAddPage) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    className="flex flex-1 items-center justify-center gap-1 rounded-[1rem] border border-dashed border-[#b5c4a1]/60 bg-[#d4e4c1]/30 px-2 py-1.5 text-[11px] font-medium text-[#5d6b4d] transition-colors hover:bg-[#d4e4c1]/50 hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    {t('sessionDetail.addPage')}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-max min-w-[9rem]">
                  {onAddBlankPage ? (
                    <DropdownMenuItem onSelect={onAddBlankPage}>
                      <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-[#5f6b50]" />
                      <span className="whitespace-nowrap">{t('sessionDetail.addBlankPage')}</span>
                    </DropdownMenuItem>
                  ) : null}
                  {onAddPage ? (
                    <DropdownMenuItem onSelect={onAddPage}>
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                      <span className="whitespace-nowrap">{t('sessionDetail.addGeneratedPage')}</span>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onToggleCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#7a875f] transition-colors hover:bg-[#e8e0d0]/60 hover:text-[#3e4a32] cursor-pointer"
                    aria-label={t('sessionDetail.collapseSidebar')}
                  >
                    <PanelLeft className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sessionDetail.collapseSidebar')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </>
      )}
    </div>
    </aside>
  )
})
