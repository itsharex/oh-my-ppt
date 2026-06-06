import type { SessionWorkspaceTab } from '@renderer/store'
import { AiToolRow } from './tool-rows/AiToolRow'
import { AnimationToolRow } from './tool-rows/AnimationToolRow'
import { InsertToolRow } from './tool-rows/InsertToolRow'
import { PreviewToolRow } from './tool-rows/PreviewToolRow'
import { SpeechToolRow } from './tool-rows/SpeechToolRow'
import type { ToolRowProps } from './tool-rows/types'

const toolRows: Record<
  SessionWorkspaceTab,
  (props: ToolRowProps) => React.JSX.Element | null
> = {
  preview: PreviewToolRow,
  edit: InsertToolRow,
  animation: AnimationToolRow,
  speech: SpeechToolRow,
  ai: AiToolRow
}

export function DynamicToolRow(props: ToolRowProps): React.JSX.Element | null {
  const ToolRow = toolRows[props.state.activeTab]
  return <ToolRow {...props} />
}
