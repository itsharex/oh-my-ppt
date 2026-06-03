import { ChartColumn, ChevronDown, ImagePlus, Sigma, Sparkles, Type, Video } from 'lucide-react'
import { useT } from '@renderer/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../ui/DropdownMenu'
import type { InsertAssetType } from '../types'
import { ToolRowShell } from './ToolRowShell'
import type { ToolRowProps } from './types'

const toolButtonClass =
  'group inline-flex h-7 min-w-[78px] shrink-0 items-center justify-center gap-1 rounded-full bg-[#fffaf1]/92 px-2.5 text-[10px] font-bold leading-none text-[#2f3b28] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_10px_rgba(47,59,40,0.09)] transition-colors hover:bg-white hover:text-[#1f2a1b] disabled:pointer-events-none disabled:opacity-40'
const primaryToolButtonClass =
  'group inline-flex h-7 min-w-[78px] shrink-0 items-center justify-center gap-1 rounded-full bg-[#3e4a32] px-2.5 text-[10px] font-bold leading-none text-white shadow-[0_4px_10px_rgba(47,59,40,0.18)] transition-colors hover:bg-[#2f3b28] disabled:pointer-events-none disabled:opacity-40'
const unavailableToolButtonClass =
  'group inline-flex h-7 min-w-[72px] shrink-0 items-center justify-center gap-1 rounded-full bg-[#f5f1e8]/58 px-2.5 text-[10px] font-bold leading-none text-[#5d6b4d]/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.48)] disabled:opacity-75'
const iconWrapClass =
  'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#d4e4c1]/78 text-[#3e4a32] group-hover:bg-[#8fbc8f]/42'
const primaryIconWrapClass =
  'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white/16 text-white'
const iconClass = 'h-2.5 w-2.5'

export function InsertToolRow({ disabled, actions }: ToolRowProps): React.JSX.Element {
  const t = useT()

  const renderUnavailableTool = (
    label: string,
    Icon: typeof Sparkles
  ): React.JSX.Element => (
    <button type="button" className={unavailableToolButtonClass} disabled>
      <span className={iconWrapClass}>
        <Icon className={iconClass} />
      </span>
      {label}
    </button>
  )

  const renderMediaDropdown = (type: InsertAssetType): React.JSX.Element => {
    const Icon = type === 'image' ? ImagePlus : Video
    const label = type === 'image' ? t('editMode.addImage') : t('editMode.addVideo')
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={toolButtonClass}
            disabled={disabled}
          >
            <span className={iconWrapClass}>
              <Icon className={iconClass} />
            </span>
            {label}
            <ChevronDown className="h-2.5 w-2.5 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuItem onClick={() => actions.onAddFromLibrary(type)}>
            {t('editMode.fromLibrary')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onAddFromLocal(type)}>
            {t('editMode.fromLocal')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <ToolRowShell>
      <button
        type="button"
        className={primaryToolButtonClass}
        onClick={actions.onAddText}
        disabled={disabled}
      >
        <span className={primaryIconWrapClass}>
          <Type className={iconClass} />
        </span>
        {t('editMode.addText')}
      </button>
      {renderUnavailableTool(t('editMode.artText'), Sparkles)}
      {renderMediaDropdown('image')}
      {renderMediaDropdown('video')}
      {renderUnavailableTool(t('editMode.chart'), ChartColumn)}
      {renderUnavailableTool(t('editMode.formula'), Sigma)}
    </ToolRowShell>
  )
}
