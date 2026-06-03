import type { GeneratedPage, SessionDetailChatType } from '@renderer/store'

export type ChatType = SessionDetailChatType

export type SessionPreviewPage = GeneratedPage & {
  id: string
  pageId: string
}
