import type { GenerationPageRecord, PPTDatabase, SessionPageRecord } from '../../db/database'

const normalizeContentOutline = (value: string | null | undefined): string | null => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || null
}

const normalizeOutlineSource = (value: string | null | undefined): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

const compactOutlineText = (value: string): string | null => {
  const text = value
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

const outlineSectionPattern =
  /(建议大纲|推荐大纲|每页要点|页面要点|页(?:面)?大纲|幻灯片大纲|Recommended outline|Per-page points|Page outline|Slide outline|Slides? outline)/i

const sectionStopPattern =
  /^(必须保留|风格|表达|注意事项|受众|核心观点|演示目标|Facts\/|Style|Audience|Core argument)\s*[:：]/i

const cnDigitMap: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

const normalizeDigits = (value: string): string =>
  value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))

const parsePageNumberToken = (value: string | undefined): number | null => {
  const token = normalizeDigits(String(value || '').trim())
  if (!token) return null
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10)
  if (!/^[零〇一二两三四五六七八九十]+$/.test(token)) return null
  if (token === '十') return 10
  const tenIndex = token.indexOf('十')
  if (tenIndex >= 0) {
    const before = token.slice(0, tenIndex)
    const after = token.slice(tenIndex + 1)
    const tens = before ? cnDigitMap[before] : 1
    const ones = after ? cnDigitMap[after] : 0
    if (typeof tens !== 'number' || typeof ones !== 'number') return null
    return tens * 10 + ones
  }
  return cnDigitMap[token] ?? null
}

const stripLinePrefix = (line: string): string =>
  line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+•]\s*/, '')
    .trim()

const stripCollectedLine = (line: string): string =>
  stripLinePrefix(line).replace(/^(?:内容要点|要点|Key points?|Content points?)\s*[:：]\s*/i, '')

const matchExplicitPageHeading = (
  line: string
): { pageNumber: number; rest: string } | null => {
  const text = stripLinePrefix(line)
  const patterns: Array<{ pattern: RegExp; restIndex: number }> = [
    {
      pattern:
        /^(?:第\s*([0-9０-９零〇一二两三四五六七八九十]+)\s*[页頁]|(?:P|Page|Slide)\s*([0-9０-９]+)|(?:页面|页|幻灯片)\s*([0-9０-９]+))\s*(?:[:：.、)\]\-–—])?\s*(.*)$/i,
      restIndex: 4
    },
    {
      pattern:
        /^([0-9０-９]+)\s*[.、．)]\s*(?:第\s*)?(?:页|页面|幻灯片|Slide)\s*(?:[:：.、)\]\-–—])?\s*(.*)$/i,
      restIndex: 2
    }
  ]

  for (const { pattern, restIndex } of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const pageNumber = parsePageNumberToken(match[1] || match[2] || match[3])
    if (!pageNumber) continue
    return { pageNumber, rest: (match[restIndex] || '').trim() }
  }

  return null
}

const matchNumberedOutlineItem = (
  line: string
): { pageNumber: number; rest: string } | null => {
  const match = stripLinePrefix(line).match(
    /^([0-9０-９]{1,3}|[零〇一二两三四五六七八九十]{1,4})\s*[.、．)]\s*(.*)$/
  )
  if (!match) return null
  const pageNumber = parsePageNumberToken(match[1])
  if (!pageNumber) return null
  return { pageNumber, rest: match[2].trim() }
}

const collectNumberedEntry = (
  lines: string[],
  pageNumber: number,
  options: { requireOutlineSection: boolean }
): string | null => {
  let inOutlineSection = !options.requireOutlineSection
  let collecting = false
  let sawNumberedItem = false
  const collected: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (outlineSectionPattern.test(trimmed)) {
      inOutlineSection = true
      continue
    }
    if (!inOutlineSection) continue
    if (sectionStopPattern.test(stripLinePrefix(trimmed))) break

    const numbered = matchNumberedOutlineItem(trimmed)
    if (numbered) {
      sawNumberedItem = true
      if (numbered.pageNumber === pageNumber) {
        collecting = true
        if (numbered.rest) collected.push(numbered.rest)
        continue
      }
      if (collecting) break
      continue
    }

    if (collecting) collected.push(stripCollectedLine(trimmed))
  }

  if (!sawNumberedItem) return null
  return compactOutlineText(collected.join(' '))
}

const extractExplicitPageEntry = (source: string, pageNumber: number): string | null => {
  const lines = source.split('\n')
  let collecting = false
  const collected: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const heading = matchExplicitPageHeading(trimmed)
    if (heading) {
      if (collecting) break
      if (heading.pageNumber === pageNumber) {
        collecting = true
        if (heading.rest) collected.push(heading.rest)
      }
      continue
    }
    if (collecting) collected.push(stripCollectedLine(trimmed))
  }

  return compactOutlineText(collected.join(' '))
}

export const resolvePageContentOutline = (
  outline: string | null | undefined,
  pageNumber: number,
  options?: { allowUnheadedNumberedOutline?: boolean }
): string | null => {
  const source = normalizeOutlineSource(outline)
  if (!source) return null

  const explicitEntry = extractExplicitPageEntry(source, pageNumber)
  if (explicitEntry) return explicitEntry

  const lines = source.split('\n')
  const sectionEntry = collectNumberedEntry(lines, pageNumber, { requireOutlineSection: true })
  if (sectionEntry) return sectionEntry

  if (options?.allowUnheadedNumberedOutline) {
    const unheadedEntry = collectNumberedEntry(lines, pageNumber, { requireOutlineSection: false })
    if (unheadedEntry) return unheadedEntry
  }

  return compactOutlineText(source)
}

export async function resolveOutlinesForPages(
  db: PPTDatabase,
  sessionId: string,
  pages: Array<Pick<SessionPageRecord, 'id' | 'file_slug' | 'legacy_page_id' | 'page_number'>>
): Promise<Map<string, string | null>> {
  const snapshots = await db.listLatestGenerationPageSnapshot(sessionId)
  const snapshotByPageId = new Map<string, GenerationPageRecord>()

  for (const page of snapshots) {
    if (!normalizeContentOutline(page.content_outline)) continue
    snapshotByPageId.set(page.page_id, page)
  }

  const resolvedSnapshots = pages.map((page) => {
    const snapshot =
      snapshotByPageId.get(page.file_slug) ||
      (page.legacy_page_id ? snapshotByPageId.get(page.legacy_page_id) : undefined) ||
      null
    return { page, snapshot }
  })

  const outlineUseCount = new Map<string, number>()
  for (const item of resolvedSnapshots) {
    const outline = normalizeContentOutline(item.snapshot?.content_outline)
    if (!outline) continue
    outlineUseCount.set(outline, (outlineUseCount.get(outline) || 0) + 1)
  }

  return new Map(
    resolvedSnapshots.map(({ page, snapshot }) => {
      const outline = normalizeContentOutline(snapshot?.content_outline)
      const pageNumber = snapshot?.page_number || page.page_number
      return [
        page.id,
        resolvePageContentOutline(snapshot?.content_outline, pageNumber, {
          allowUnheadedNumberedOutline: outline ? (outlineUseCount.get(outline) || 0) > 1 : false
        })
      ]
    })
  )
}
