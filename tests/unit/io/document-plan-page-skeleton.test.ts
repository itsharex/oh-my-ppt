import { describe, expect, it } from 'vitest'
import { scanDocumentOutline } from '../../../src/main/ipc/io/document-outline-scan'
import { buildDocumentPlanPageSkeleton } from '../../../src/main/ipc/io/document-plan-page-skeleton'

describe('document plan page skeleton', () => {
  it('derives an authoritative skeleton only when source candidates match the plan count', () => {
    const scan = scanDocumentOutline(
      [
        '# Source Manual',
        '',
        '## Market',
        'Market details.',
        '',
        '## Execution',
        'Execution details.'
      ].join('\n')
    )

    const skeleton = buildDocumentPlanPageSkeleton({
      scan,
      pageCount: 2,
      userPageCount: null
    })

    expect(skeleton).toHaveLength(2)
    expect(skeleton[0]).toMatchObject({
      pageNumber: 1,
      title: 'Market',
      sourceHeading: '## Market',
      lineStart: 3
    })
    expect(
      buildDocumentPlanPageSkeleton({
        scan,
        pageCount: 1,
        userPageCount: null
      })
    ).toEqual([])
    expect(
      buildDocumentPlanPageSkeleton({
        scan,
        pageCount: 2,
        userPageCount: 2
      })
    ).toHaveLength(2)
    expect(
      buildDocumentPlanPageSkeleton({
        scan,
        pageCount: 2,
        userPageCount: 1
      })
    ).toEqual([])
  })
})
