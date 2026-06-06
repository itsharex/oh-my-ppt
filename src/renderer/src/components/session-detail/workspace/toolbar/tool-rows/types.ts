import type { WorkspaceRibbonActions, WorkspaceRibbonState } from '../types'

export interface ToolRowProps {
  state: WorkspaceRibbonState
  disabled: boolean
  actions: WorkspaceRibbonActions
}
