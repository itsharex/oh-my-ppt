import { useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  ImagePlus,
  Loader2,
  Pencil,
  Redo2,
  ScrollText,
  Sparkles,
  Type,
  Undo2,
  Video
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { useToastStore } from '@renderer/store/toastStore'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { useT } from '@renderer/i18n'
import type { SessionPreviewPage } from './types'

interface PreviewToolbarProps {
  selectedPage: SessionPreviewPage | null
  isGenerating: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
  onUndo: () => void
  onRedo: () => void
  onSaveAllEdits: () => void
  onDiscardAllEdits: () => void
  onAddText: () => void
  onAddFromLibrary: (type: 'image' | 'video') => void
  onAddFromLocal: (type: 'image' | 'video') => void
  onOpenSpeechScript: () => void
}

export function PreviewToolbar({
  selectedPage,
  isGenerating,
  isSavingEdits,
  canUndo,
  canRedo,
  hasPendingEdits,
  onUndo,
  onRedo,
  onSaveAllEdits,
  onDiscardAllEdits,
  onAddText,
  onAddFromLibrary,
  onAddFromLocal,
  onOpenSpeechScript
}: PreviewToolbarProps) {
  const t = useT()
  const toast = useToastStore()
  const [isPreviewSettling, setIsPreviewSettling] = useState(false)
  const interactionMode = useSessionDetailUiStore((s) => s.interactionMode)
  const setInteractionMode = useSessionDetailUiStore((s) => s.setInteractionMode)
  const clearSelectedElement = useSessionDetailUiStore((s) => s.clearSelectedElement)
  const speechScriptDialogOpen = useSessionDetailUiStore((s) => s.speechScriptDialogOpen)
  const setSpeechScriptDialogOpen = useSessionDetailUiStore((s) => s.setSpeechScriptDialogOpen)
  const selectedPageKey = selectedPage?.htmlPath
    ? `${selectedPage.pageId}:${selectedPage.htmlPath}`
    : ''

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

  if (!selectedPage?.htmlPath) return null

  const isEditing = interactionMode === 'edit'
  const toolbarDisabled = isGenerating || isSavingEdits || isPreviewSettling

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 px-4 pb-1.5 pt-2 transition-opacity duration-200',
        isPreviewSettling && 'pointer-events-none opacity-0'
      )}
    >
      {/* Left: Mode switcher pill */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-[9px] border border-[#d9cfbd]/72 bg-[#fffaf1]/90 p-0.5 shadow-[0_8px_20px_rgba(74,59,42,0.10)] backdrop-blur-xl">
        <button
          type="button"
          className={cn(
            'inline-flex h-7 min-w-[52px] shrink-0 items-center justify-center rounded-[7px] px-2 text-[10px] font-semibold leading-none transition-colors',
            interactionMode === 'preview' && !speechScriptDialogOpen
              ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
              : 'text-[#5d6b4d] hover:bg-[#d4e4c1]/72'
          )}
          onClick={() => {
            if (interactionMode !== 'preview') {
              if (isEditing) onDiscardAllEdits()
              setInteractionMode('preview')
            }
            setSpeechScriptDialogOpen(false)
          }}
          disabled={toolbarDisabled}
        >
          {t('sessionDetail.previewMode')}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 min-w-[52px] shrink-0 items-center justify-center rounded-[7px] px-2 text-[10px] font-semibold leading-none transition-colors',
            speechScriptDialogOpen
              ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
              : 'text-[#5d6b4d] hover:bg-[#d4e4c1]/72'
          )}
          onClick={() => {
            if (isEditing) onDiscardAllEdits()
            clearSelectedElement()
            setInteractionMode('preview')
            onOpenSpeechScript()
          }}
          disabled={toolbarDisabled}
        >
          <ScrollText className="mr-0.5 h-2.5 w-2.5" />
          {t('sessionDetail.speechScript')}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 min-w-[52px] shrink-0 items-center justify-center rounded-[7px] px-2 text-[10px] font-semibold leading-none transition-colors',
            interactionMode === 'edit'
              ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
              : 'text-[#5d6b4d] hover:bg-[#d4e4c1]/72'
          )}
          onClick={() => {
            if (interactionMode !== 'edit') {
              setInteractionMode('edit')
              setSpeechScriptDialogOpen(false)
              toast.info(t('sessionDetail.editModeToast'))
            }
          }}
          disabled={toolbarDisabled}
        >
          <Pencil className="mr-0.5 h-2.5 w-2.5" />
          {t('sessionDetail.editMode')}
        </button>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 min-w-[52px] shrink-0 items-center justify-center rounded-[7px] px-2 text-[10px] font-semibold leading-none transition-colors',
            interactionMode === 'ai-inspect'
              ? 'bg-[#5d6b4d] text-white shadow-[0_7px_16px_rgba(93,107,77,0.2)]'
              : 'text-[#5d6b4d] hover:bg-[#d4e4c1]/72'
          )}
          onClick={() => {
            if (interactionMode !== 'ai-inspect') {
              if (isEditing) onDiscardAllEdits()
              setInteractionMode('ai-inspect')
              setSpeechScriptDialogOpen(false)
              toast.info(t('sessionDetail.inspectActiveToast'))
            }
          }}
          disabled={toolbarDisabled}
        >
          <Sparkles className="mr-0.5 h-2.5 w-2.5" />
          {t('sessionDetail.aiMode')}
        </button>
      </div>

      {/* Right: Context actions */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isEditing && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-[7px] border border-[#d9cfbd]/62 bg-[#fffaf1]/90 px-2 text-[10px] leading-none text-[#5d6b4d] shadow-[0_4px_12px_rgba(74,59,42,0.06)] hover:bg-[#d4e4c1]/72 disabled:opacity-40"
              onClick={onUndo}
              disabled={toolbarDisabled || !canUndo}
            >
              <Undo2 className="mr-0.5 h-2.5 w-2.5" />
              {t('sessionDetail.undo')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-[7px] border border-[#d9cfbd]/62 bg-[#fffaf1]/90 px-2 text-[10px] leading-none text-[#5d6b4d] shadow-[0_4px_12px_rgba(74,59,42,0.06)] hover:bg-[#d4e4c1]/72 disabled:opacity-40"
              onClick={onRedo}
              disabled={toolbarDisabled || !canRedo}
            >
              <Redo2 className="mr-0.5 h-2.5 w-2.5" />
              {t('sessionDetail.redo')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-[7px] border border-[#d9cfbd]/62 bg-[#fffaf1]/90 px-2 text-[10px] leading-none text-[#5d6b4d] shadow-[0_4px_12px_rgba(74,59,42,0.06)] hover:bg-[#d4e4c1]/72 disabled:opacity-40"
              onClick={onAddText}
              disabled={toolbarDisabled}
            >
              <Type className="mr-0.5 h-2.5 w-2.5" />
              {t('editMode.addText')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[7px] border border-[#d9cfbd]/62 bg-[#fffaf1]/90 px-2 text-[10px] font-semibold leading-none text-[#5d6b4d] shadow-[0_4px_12px_rgba(74,59,42,0.06)] hover:bg-[#d4e4c1]/72"
                >
                  <ImagePlus className="mr-0.5 h-2.5 w-2.5" />
                  {t('editMode.addImage')}
                  <ChevronDown className="ml-0.5 h-2.5 w-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem onClick={() => onAddFromLibrary('image')}>
                  {t('editMode.fromLibrary')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAddFromLocal('image')}>
                  {t('editMode.fromLocal')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[7px] border border-[#d9cfbd]/62 bg-[#fffaf1]/90 px-2 text-[10px] font-semibold leading-none text-[#5d6b4d] shadow-[0_4px_12px_rgba(74,59,42,0.06)] hover:bg-[#d4e4c1]/72"
                >
                  <Video className="mr-0.5 h-2.5 w-2.5" />
                  {t('editMode.addVideo')}
                  <ChevronDown className="ml-0.5 h-2.5 w-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem onClick={() => onAddFromLibrary('video')}>
                  {t('editMode.fromLibrary')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAddFromLocal('video')}>
                  {t('editMode.fromLocal')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {isEditing && hasPendingEdits && (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7 shrink-0 rounded-[7px] bg-[#5d6b4d] px-2 text-[10px] leading-none text-white shadow-[0_6px_14px_rgba(93,107,77,0.16)]"
            onClick={onSaveAllEdits}
            disabled={toolbarDisabled}
          >
            {isSavingEdits ? (
              <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" />
            ) : (
              <Check className="mr-0.5 h-2.5 w-2.5" />
            )}
            {t('sessionDetail.exitAndSave')}
          </Button>
        )}
        {isEditing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 rounded-[7px] border border-transparent bg-[#d4e4c1]/82 px-2 text-[10px] leading-none text-[#3e4a32] shadow-[0_4px_12px_rgba(93,107,77,0.10)] hover:bg-[#c8ddb2]"
            onClick={onDiscardAllEdits}
            disabled={toolbarDisabled}
          >
            {t('sessionDetail.exitEditMode')}
          </Button>
        )}
        {interactionMode === 'ai-inspect' && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 rounded-[7px] border border-transparent bg-[#d4e4c1]/82 px-2 text-[10px] leading-none text-[#3e4a32] shadow-[0_4px_12px_rgba(93,107,77,0.10)] hover:bg-[#c8ddb2]"
            onClick={() => {
              clearSelectedElement()
              setInteractionMode('preview')
            }}
            disabled={toolbarDisabled}
          >
            {t('sessionDetail.exitAiMode')}
          </Button>
        )}
      </div>
    </div>
  )
}
