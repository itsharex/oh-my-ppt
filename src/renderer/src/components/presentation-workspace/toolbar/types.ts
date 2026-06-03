import type { SessionWorkspaceTab } from '@renderer/store'

export type InsertAssetType = 'image' | 'video'

export interface WorkspaceRibbonActions {
  onUndo: () => void
  onRedo: () => void
  onSaveCurrentPage: () => void
  onBackToSessions: () => void
  onAddText: () => void
  onAddFromLibrary: (type: InsertAssetType) => void
  onAddFromLocal: (type: InsertAssetType) => void
  onOpenSpeechScript: () => void
}

export interface WorkspaceRibbonState {
  isGenerating: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
  activeTab: SessionWorkspaceTab
}
