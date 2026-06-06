import { X } from 'lucide-react'
import type { EditSelectionPayload } from '../../preview/edit-mode-script'
import { AppearanceInspector } from './AppearanceInspector'
import { ArtTextInspector } from './ArtTextInspector'
import { InspectorActions } from './InspectorActions'
import { LayerInspector } from './LayerInspector'
import { LayoutInspector } from './LayoutInspector'
import { MediaInspector } from './MediaInspector'
import { TextInspector } from './TextInspector'
import type { ElementEditDraft } from './types'
import { getElementKindLabel, hasCapability, isArtTextSelection } from './types'
import { useT } from '@renderer/i18n'
import { sessionDetailRightPanelContentClass } from '../workspace/right-panel/styles'

export type { ElementEditDraft } from './types'

export function ElementInspectorPanel({
  selection,
  draft,
  onDraftChange,
  onClose,
  onCopy,
  onDelete
}: {
  selection: EditSelectionPayload | null
  draft: ElementEditDraft
  onDraftChange: (
    draft: ElementEditDraft,
    options?: { commit?: boolean; fields?: Array<keyof ElementEditDraft> }
  ) => void
  onClose: () => void
  onDelete?: () => void
  onCopy?: () => void
}): React.JSX.Element {
  const t = useT()
  const snapshot = selection?.snapshot
  const isArtText = isArtTextSelection(selection)

  return (
    <div className={sessionDetailRightPanelContentClass}>
      <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 pb-2.5 pt-3 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#c7d9b4]/12" />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
              {t('sessionDetail.elementInspector')}
            </div>
            {selection && (
              <div className="mt-1 text-[11px] text-[#a0977e]">
                {isArtText ? t('editMode.artText') : getElementKindLabel(selection)}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#667257] transition-colors hover:bg-[#d4e4c1]/78 hover:text-[#34402c]"
            aria-label={t('sessionDetail.closeInspector')}
            title={t('sessionDetail.closeInspector')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2.5">
        {!selection || !snapshot ? (
          <div className="rounded-[1.15rem] border border-[#e8c8c6]/72 bg-[#fdf0ef]/82 px-3 py-4 text-center shadow-[0_6px_14px_rgba(74,59,42,0.08)]">
            <p className="whitespace-pre-line text-[12px] leading-5 text-[#8e5a53]">
              {t('sessionDetail.inspectorUnavailable')}
            </p>
          </div>
        ) : (
          <>
            <LayoutInspector selection={selection} draft={draft} onDraftChange={onDraftChange} />
            {hasCapability(selection, 'layer') && (
              <LayerInspector selection={selection} draft={draft} onDraftChange={onDraftChange} />
            )}
            {isArtText && (
              <ArtTextInspector selection={selection} draft={draft} onDraftChange={onDraftChange} />
            )}
            {!isArtText && hasCapability(selection, 'text') && (
              <TextInspector selection={selection} draft={draft} onDraftChange={onDraftChange} />
            )}
            {hasCapability(selection, 'appearance') && (
              <AppearanceInspector
                selection={selection}
                draft={draft}
                onDraftChange={onDraftChange}
              />
            )}
            {hasCapability(selection, 'media') && (
              <MediaInspector selection={selection} draft={draft} onDraftChange={onDraftChange} />
            )}
          </>
        )}

        <InspectorActions onCopy={onCopy} onDelete={onDelete} />
      </div>
    </div>
  )
}
