import { describe, expect, it } from 'vitest'
import {
  resolveOutlinesForPages,
  resolvePageContentOutline
} from '../../../src/main/ipc/session/page-outline-utils'
import type { GenerationPageRecord, PPTDatabase, SessionPageRecord } from '../../../src/main/db/database'

const makeSnapshot = (
  pageId: string,
  pageNumber: number,
  contentOutline: string
): GenerationPageRecord => ({
  id: `run:${pageId}`,
  run_id: 'run',
  session_id: 'session',
  page_id: pageId,
  page_number: pageNumber,
  title: `P${pageNumber}`,
  content_outline: contentOutline,
  layout_intent: null,
  html_path: null,
  status: 'completed',
  error: null,
  retry_count: 0,
  created_at: 1,
  updated_at: 1
})

const makeSessionPage = (
  id: string,
  fileSlug: string,
  pageNumber: number
): Pick<SessionPageRecord, 'id' | 'file_slug' | 'legacy_page_id' | 'page_number'> => ({
  id,
  file_slug: fileSlug,
  legacy_page_id: null,
  page_number: pageNumber
})

describe('resolvePageContentOutline', () => {
  it('extracts explicit Chinese page sections', () => {
    const outline = [
      '第 1 页：项目背景',
      '- 市场变化',
      '第 2 页：方案策略',
      '- 分阶段落地',
      '- 明确负责人',
      '第 3 页：总结'
    ].join('\n')

    expect(resolvePageContentOutline(outline, 2)).toBe('方案策略 分阶段落地 明确负责人')
  })

  it('extracts explicit English page sections without leaking the page number', () => {
    const outline = ['Page 1: Context', 'Page 2', '- Delivery plan', '- Owner mapping'].join('\n')

    expect(resolvePageContentOutline(outline, 2)).toBe('Delivery plan Owner mapping')
  })

  it('extracts numbered items inside an outline section', () => {
    const outline = [
      '推荐大纲',
      '1. 封面：一句话说明主题',
      '2. 现状分析：痛点、数据、机会',
      '   - 补充关键指标',
      '3. 行动计划：节奏和责任'
    ].join('\n')

    expect(resolvePageContentOutline(outline, 2)).toBe('现状分析：痛点、数据、机会 补充关键指标')
  })

  it('does not split ordinary per-page numbered bullets by default', () => {
    const outline = ['1. 保留核心指标', '2. 加一张趋势图', '3. 结尾突出风险'].join('\n')

    expect(resolvePageContentOutline(outline, 2)).toBe('1. 保留核心指标 2. 加一张趋势图 3. 结尾突出风险')
  })

  it('can split a shared unheaded numbered deck outline', () => {
    const outline = ['1. 背景与目标', '2. 方案设计', '3. 里程碑'].join('\n')

    expect(resolvePageContentOutline(outline, 2, { allowUnheadedNumberedOutline: true })).toBe(
      '方案设计'
    )
  })
})

describe('resolveOutlinesForPages', () => {
  it('uses generation snapshot page numbers so reordered pages keep the right outline', async () => {
    const deckOutline = ['1. 背景与目标', '2. 方案设计', '3. 里程碑'].join('\n')
    const db = {
      listLatestGenerationPageSnapshot: async () => [
        makeSnapshot('page-a', 1, deckOutline),
        makeSnapshot('page-b', 2, deckOutline),
        makeSnapshot('page-c', 3, deckOutline)
      ]
    } as Pick<PPTDatabase, 'listLatestGenerationPageSnapshot'> as PPTDatabase

    const result = await resolveOutlinesForPages(db, 'session', [
      makeSessionPage('session-b', 'page-b', 1),
      makeSessionPage('session-a', 'page-a', 2),
      makeSessionPage('session-c', 'page-c', 3)
    ])

    expect(result.get('session-b')).toBe('方案设计')
    expect(result.get('session-a')).toBe('背景与目标')
    expect(result.get('session-c')).toBe('里程碑')
  })
})
