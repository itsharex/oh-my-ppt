import type { FontSelection } from './generation'

export type ThinkingStage = 'collect' | 'outline' | 'draft' | 'refine' | 'ready'

export interface ThinkingSource {
  id: string
  name: string
  kind: 'markdown' | 'text' | 'csv' | 'docx' | 'image'
}

export interface ThinkingWorkspace {
  thinkingId: string
  thinkingMd: string
  contextMd: string
  stage: ThinkingStage
  sources: ThinkingSource[]
}

export interface ThinkingWorkspaceListItem {
  thinkingId: string
  updatedAt: number
  topic: string
  stage: ThinkingStage
}

export interface ThinkingChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachments?: ThinkingSource[]
}

export interface ThinkingChatResult {
  reply: string
  thinkingMd: string
  contextMd: string
  stage: ThinkingStage
}

export interface ThinkingPrepareGenerationResult {
  thinkingDocumentPath: string
  topic: string
  pageCount: number
  styleId: string
  styleText?: string
  fontSelection: FontSelection
}
