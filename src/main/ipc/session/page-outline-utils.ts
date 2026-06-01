import type { PPTDatabase, SessionPageRecord } from '../../db/database'

const normalizeContentOutline = (value: string | null | undefined): string | null => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || null
}

export async function resolveOutlinesForPages(
  db: PPTDatabase,
  sessionId: string,
  pages: Array<Pick<SessionPageRecord, 'id' | 'file_slug' | 'legacy_page_id'>>
): Promise<Map<string, string | null>> {
  const snapshots = await db.listLatestGenerationPageSnapshot(sessionId)
  const outlineByPageId = new Map<string, string>()

  for (const page of snapshots) {
    const outline = normalizeContentOutline(page.content_outline)
    if (outline) outlineByPageId.set(page.page_id, outline)
  }

  return new Map(
    pages.map((page) => [
      page.id,
      outlineByPageId.get(page.file_slug) ||
        (page.legacy_page_id ? outlineByPageId.get(page.legacy_page_id) : undefined) ||
        null
    ])
  )
}
