import {
  Archive,
  ChevronDown,
  ExternalLink,
  FileDown,
  FileSearch,
  History,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Package,
  Presentation,
  ScrollText
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store/sessionDetailStore'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/DropdownMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { useT } from '@renderer/i18n'

const toolbarButtonClass =
  'h-7 rounded-[8px] border-transparent bg-[#e8e0d0]/72 px-2.5 text-[11px] text-[#3e4a32] shadow-[0_4px_10px_rgba(86,72,53,0.08)] hover:bg-[#d4e4c1]/78'
const toolbarIconClass = 'mr-1.5 h-3.5 w-3.5'
const dropdownItemIconClass = 'mr-2 h-3.5 w-3.5 text-[#6b7280]'

export function SessionToolbar({
  hasPages,
  historyDisabled = false,
  canPreview,
  canRevealFile,
  onExportPdf,
  onExportPng,
  onExportPptx,
  onExportSessionZip,
  onExportSlidePack,
  onOpenHistory,
  onOpenPreview,
  onRevealFile,
  onPresent,
  onGenerateSpeechScript
}: {
  hasPages: boolean
  historyDisabled?: boolean
  canPreview: boolean
  canRevealFile: boolean
  onExportPdf: () => void
  onExportPng: () => void
  onExportPptx: (options?: {
    imageOnly?: boolean
    embedFonts?: boolean | 'auto' | 'always' | 'never'
  }) => void
  onExportSessionZip: () => void
  onExportSlidePack: () => void
  onOpenHistory: () => void
  onOpenPreview: () => void
  onRevealFile: () => void
  onPresent?: () => void
  onGenerateSpeechScript?: () => void
}): React.JSX.Element {
  const t = useT()

  const isExportingPdf = useSessionDetailUiStore((state) => state.isExportingPdf)
  const isExportingPng = useSessionDetailUiStore((state) => state.isExportingPng)
  const isExportingPptx = useSessionDetailUiStore((state) => state.isExportingPptx)
  const isExportingSlidePack = useSessionDetailUiStore((state) => state.isExportingSlidePack)
  const isExportingSessionZip = useSessionDetailUiStore((state) => state.isExportingSessionZip)
  const isGeneratingSpeechScript = useSessionDetailUiStore((state) => state.isGeneratingSpeechScript)
  const isExportingPackage = isExportingSlidePack || isExportingSessionZip
  const isExporting =
    isExportingPdf ||
    isExportingPng ||
    isExportingPptx ||
    isExportingSlidePack ||
    isExportingSessionZip

  return (
    <>
      {hasPages && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              onClick={onOpenHistory}
              disabled={historyDisabled || isExporting}
            >
              <History className={toolbarIconClass} />
              {t('sessionDetail.history')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {t('sessionDetail.historyTooltip')}
          </TooltipContent>
        </Tooltip>
      )}
      {hasPages && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(toolbarButtonClass, 'gap-1')}
              disabled={isExportingPptx || isExportingPackage}
            >
              {isExportingPptx ? (
                <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
              ) : (
                <Presentation className={toolbarIconClass} />
              )}
              {t('sessionDetail.exportPptx')}
              {!isExportingPptx && <ChevronDown className="h-3 w-3" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[14rem]">
            <DropdownMenuItem onClick={() => onExportPptx()}>
              <Presentation className={dropdownItemIconClass} />
              {t('sessionDetail.exportPptxEditable')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExportPptx({ imageOnly: true })}>
              <ImageIcon className={dropdownItemIconClass} />
              {t('sessionDetail.exportPptxImageOnly')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasPages && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(toolbarButtonClass, 'gap-1')}
                  disabled={isExportingPackage}
                >
                  {isExportingPackage ? (
                    <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
                  ) : (
                    <Package className={toolbarIconClass} />
                  )}
                  {t('sessionDetail.exportPackage')}
                  {!isExportingPackage && <ChevronDown className="h-3 w-3" />}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('sessionDetail.exportPackageTooltip')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem className="items-start" onClick={onExportSlidePack}>
              <Package className={cn(dropdownItemIconClass, 'mt-0.5')} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 whitespace-normal">
                <span>{t('sessionDetail.exportSlidePack')}</span>
                <span className="text-[11px] leading-snug text-[#9a8f80]">
                  {t('sessionDetail.exportSlidePackDescription')}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="items-start" onClick={onExportSessionZip}>
              <Archive className={cn(dropdownItemIconClass, 'mt-0.5')} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 whitespace-normal">
                <span>{t('sessionDetail.exportSessionZip')}</span>
                <span className="text-[11px] leading-snug text-[#9a8f80]">
                  {t('sessionDetail.exportSessionZipDescription')}
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onExportPng}
          disabled={isExportingPng}
        >
          {isExportingPng ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <ImageIcon className={toolbarIconClass} />
          )}
          {t('sessionDetail.exportPng')}
        </Button>
      )}
      {hasPages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onExportPdf}
          disabled={isExportingPdf}
        >
          {isExportingPdf ? (
            <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
          ) : (
            <FileDown className={toolbarIconClass} />
          )}
          {t('sessionDetail.exportPdf')}
        </Button>
      )}
      {hasPages && onGenerateSpeechScript && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              onClick={onGenerateSpeechScript}
              disabled={isGeneratingSpeechScript}
            >
              {isGeneratingSpeechScript ? (
                <Loader2 className={cn(toolbarIconClass, 'animate-spin')} />
              ) : (
                <ScrollText className={toolbarIconClass} />
              )}
              {t('sessionDetail.speechScript')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sessionDetail.speechScriptTooltip')}</TooltipContent>
        </Tooltip>
      )}
      {canPreview && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              onClick={onOpenPreview}
            >
              <ExternalLink className={toolbarIconClass} />
              {t('sessionDetail.preview')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sessionDetail.previewTooltip')}</TooltipContent>
        </Tooltip>
      )}
      {hasPages && onPresent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarButtonClass}
              onClick={onPresent}
            >
              <Monitor className={toolbarIconClass} />
              {t('sessionDetail.present')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sessionDetail.presentTooltip')}</TooltipContent>
        </Tooltip>
      )}
      {canRevealFile && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={toolbarButtonClass}
          onClick={onRevealFile}
        >
          <FileSearch className={toolbarIconClass} />
          {t('sessionDetail.revealFile')}
        </Button>
      )}
    </>
  )
}
