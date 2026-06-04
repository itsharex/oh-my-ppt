import type { DocumentPlanPageSkeletonItem } from '@shared/generation'
import {
  deriveOutlinePageCandidates,
  type DocumentOutlinePageCandidate,
  type DocumentOutlineScan
} from './document-outline-scan'

export const buildDocumentPlanPageSkeleton = (args: {
  scan: DocumentOutlineScan | null
  pageCandidates?: DocumentOutlinePageCandidate[]
  pageCount: number
  userPageCount: number | null
}): DocumentPlanPageSkeletonItem[] => {
  if (!args.scan) return []
  const candidates = args.pageCandidates ?? deriveOutlinePageCandidates(args.scan)
  if (candidates.length === 0 || candidates.length !== args.pageCount) return []
  if (args.userPageCount !== null && args.userPageCount !== candidates.length) return []
  return candidates.map((candidate, index) => ({
    pageNumber: index + 1,
    title: candidate.title,
    role: candidate.role,
    sourceHeading: candidate.sourceHeading,
    headingLevel: candidate.headingLevel,
    lineStart: candidate.lineStart,
    lineEnd: candidate.lineEnd,
    reason: candidate.reason
  }))
}
