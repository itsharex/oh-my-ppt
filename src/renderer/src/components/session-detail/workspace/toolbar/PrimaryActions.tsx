import { Check, Home, Loader2, Redo2, Undo2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useT } from '@renderer/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/Tooltip'

export function PrimaryActions({
  disabled,
  isSavingEdits,
  canUndo,
  canRedo,
  hasPendingEdits,
  onBackToSessions,
  onSaveCurrentPage,
  onUndo,
  onRedo
}: {
  disabled: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
  onBackToSessions: () => void
  onSaveCurrentPage: () => void
  onUndo: () => void
  onRedo: () => void
}): React.JSX.Element {
  const t = useT()

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-[0.95rem] bg-[#e8e0d0]/54 px-1 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center bg-[#d4e4c1]/88 text-[#3e4a32] shadow-[0_4px_9px_rgba(93,107,77,0.11)] transition-colors hover:bg-[#8fbc8f]/42 disabled:opacity-40"
            style={{ borderRadius: '5% 95% 10% 90% / 85% 15% 85% 15%' }}
            onClick={onBackToSessions}
            disabled={disabled}
            aria-label={t('sessionDetail.backToSessions')}
          >
            <Home className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sessionDetail.backToSessions')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 shrink-0 items-center justify-center rounded-full px-2.5 text-[10px] font-bold leading-none transition-colors disabled:pointer-events-none disabled:opacity-45',
              hasPendingEdits
                ? 'bg-[#5d6b4d] text-white shadow-[0_4px_10px_rgba(62,74,50,0.15)] hover:bg-[#3e4a32]'
                : 'bg-[#fffaf1]/72 text-[#8a9a7b] shadow-[inset_0_1px_0_rgba(255,255,255,0.54)]'
            )}
            onClick={onSaveCurrentPage}
            disabled={disabled || !hasPendingEdits}
            aria-label={t('sessionDetail.saveCurrentPageTooltip')}
          >
            {isSavingEdits ? (
              <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin text-current" />
            ) : (
              <Check className="mr-1 h-2.5 w-2.5 text-current" />
            )}
            {t('sessionDetail.saveCurrentPage')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sessionDetail.saveCurrentPageTooltip')}</TooltipContent>
      </Tooltip>
      <div className="ml-0.5 flex items-center gap-0.5 rounded-full bg-[#f5f1e8]/48 p-0.5 shadow-[inset_0_1px_3px_rgba(74,59,42,0.045)]">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[#5d6b4d] transition-colors hover:bg-[#d4e4c1]/64 hover:text-[#3e4a32] disabled:pointer-events-none disabled:text-[#a4aa9a] disabled:opacity-45"
              onClick={onUndo}
              disabled={disabled || !canUndo}
              aria-label={t('sessionDetail.undoCurrentPageTooltip')}
            >
              <Undo2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.undoCurrentPageTooltip')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[#5d6b4d] transition-colors hover:bg-[#d4e4c1]/64 hover:text-[#3e4a32] disabled:pointer-events-none disabled:text-[#a4aa9a] disabled:opacity-45"
              onClick={onRedo}
              disabled={disabled || !canRedo}
              aria-label={t('sessionDetail.redoCurrentPageTooltip')}
            >
              <Redo2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionDetail.redoCurrentPageTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
