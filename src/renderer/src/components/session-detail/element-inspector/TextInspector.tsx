import { Type } from 'lucide-react'
import { RichTextBox } from '../../ui/RichTextBox'
import { InspectorSection } from './InspectorSection'
import type { ElementEditorProps } from './types'
import { useT } from '@renderer/i18n'

export function TextInspector({
  draft,
  onDraftChange
}: ElementEditorProps): React.JSX.Element {
  const t = useT()
  return (
    <>
      <InspectorSection
        title={t('sessionDetail.textContent')}
        icon={<Type className="h-3.5 w-3.5 text-[#7a875f]" />}
      >
        <RichTextBox
          value={draft.html}
          fallbackText={draft.text}
          defaultColor={draft.color}
          defaultFontSize={draft.fontSize}
          onChange={(value) => onDraftChange({ ...draft, html: value.html, text: value.text })}
          onCommit={(value) =>
            onDraftChange(
              { ...draft, html: value.html, text: value.text },
              { commit: true, fields: ['html'] }
            )
          }
        />
      </InspectorSection>
    </>
  )
}
