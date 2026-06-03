import type { SessionWorkspaceTab } from '@renderer/store'
import type { ArtTextTemplateId } from '@renderer/lib/artTextTemplates'

export type InsertAssetType = 'image' | 'video'

export interface WorkspaceRibbonActions {
  onUndo: () => void
  onRedo: () => void
  onSaveCurrentPage: () => void
  onBackToSessions: () => void
  onAddText: () => void
  onAddArtText: (templateId: ArtTextTemplateId) => void
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
