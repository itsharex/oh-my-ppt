import { Sparkles } from 'lucide-react'
import {
  buildArtTextInnerHtml,
  getArtTextTemplateLabel,
  isArtTextTemplateId
} from '@renderer/lib/artTextTemplates'
import { Input } from '../../ui/Input'
import { InspectorSection } from './InspectorSection'
import type { ElementEditorProps } from './types'

export function ArtTextInspector({
  selection,
  draft,
  onDraftChange
}: ElementEditorProps): React.JSX.Element {
  const templateId = selection.snapshot?.attrs.artTextTemplate || draft.artTextTemplateId
  const templateLabel = getArtTextTemplateLabel(templateId) || '艺术字'
  const canEditText = isArtTextTemplateId(templateId)

  const updateText = (text: string, commit = false): void => {
    if (!canEditText) return
    onDraftChange(
      {
        ...draft,
        text,
        html: buildArtTextInnerHtml(templateId, text),
        artTextTemplateId: templateId
      },
      commit ? { commit: true, fields: ['html'] } : undefined
    )
  }

  return (
    <InspectorSection title="艺术字" icon={<Sparkles className="h-3.5 w-3.5 text-[#7a875f]" />}>
      <div className="space-y-2.5">
        <div className="rounded-[1rem] border border-[#ded2bd]/60 bg-[#fffdf8]/70 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8a806b]">
            当前效果
          </div>
          <div className="mt-1 text-xs font-semibold text-[#3f4b35]">{templateLabel}</div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium text-[#7a875f]">文案</span>
          <Input
            value={draft.text}
            onChange={(event) => updateText(event.target.value)}
            onBlur={(event) => updateText(event.target.value, true)}
            disabled={!canEditText}
            className="h-8 rounded-full border border-[#ded2bd]/72 bg-[#fffdf8]/88 px-2.5 text-xs text-[#3f4b35] shadow-[inset_0_1px_2px_rgba(74,59,42,0.05)] focus-visible:border-[#9bb98a] focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium text-[#7a875f]">字号</span>
          <Input
            type="number"
            min={8}
            max={160}
            value={draft.fontSize}
            onChange={(event) => onDraftChange({ ...draft, fontSize: event.target.value })}
            onBlur={(event) =>
              onDraftChange(
                { ...draft, fontSize: event.target.value },
                { commit: true, fields: ['fontSize'] }
              )
            }
            className="h-8 rounded-full border border-[#ded2bd]/72 bg-[#fffdf8]/88 px-2.5 text-xs text-[#3f4b35] shadow-[inset_0_1px_2px_rgba(74,59,42,0.05)] focus-visible:border-[#9bb98a] focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </label>
      </div>
    </InspectorSection>
  )
}
