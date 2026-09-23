import { describe, expect, it } from 'vitest'
import { CRITERIA, decide, normalizeForMatch, scoreReview, verifyQuote } from './score'
import type { CriterionId, ReviewResult } from '../types'

const SOURCE = `[Page 1]
Abstract
We propose a sparse attention method that reduces memory by 43% on long documents.
[Page 2]
Method
Our approach replaces dense attention with locality-sensitive hashing buckets.
[Page 3]
Experiments
Results on three benchmarks show consistent gains over the baseline transformer.
Limitations: we only test English corpora.
Code is available at github.com/example/sparse.
References
[1] Vaswani et al.`

function review(score: number, quotes: string[] = [], extra: Partial<ReviewResult> = {}): ReviewResult {
  const criteria = Object.fromEntries(CRITERIA.map(c => [c.id, { score, confidence: 3, rationale: '', evidence: quotes.map(quote => ({ quote, page: 1 })) }])) as ReviewResult['criteria']
  return { createdAt: '', model: 'm', title: '', summary: '', strengths: [], weaknesses: [], questions: [], fatalFlaws: [], criteria, ...extra }
}
const REAL = 'reduces memory by 43% on long documents'

describe('evidence verification', () => {
  it('matches verbatim quotes regardless of whitespace, case and punctuation', () => {
    const source = normalizeForMatch(SOURCE)
    expect(verifyQuote('Reduces  memory by 43 % on long\ndocuments.', source)).toBe(true)
  })
  it('tolerates small OCR differences but rejects invented quotes', () => {
    const source = normalizeForMatch(SOURCE)
    expect(verifyQuote('Our approach replaces dense attention with locality-sensitive hashing bucket', source)).toBe(true)
    expect(verifyQuote('We prove convergence for all non-convex objectives', source)).toBe(false)
    expect(verifyQuote('short', source)).toBe(false)
  })
})

describe('scoreReview', () => {
  it('weights sum to 1', () => {
    expect(CRITERIA.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1)
  })
  it('gives 100 for perfect, verified judgements on a complete paper', () => {
    const s = scoreReview(review(5, [REAL]), SOURCE)
    expect(s.completeness).toBe(1)
    expect(s.total).toBe(100)
    expect(s.decision).toBe('strong-accept')
  })
  it('pulls unsupported judgements halfway to neutral', () => {
    const s = scoreReview(review(5), SOURCE)
    expect(s.criteria.every(c => c.adjusted === 4)).toBe(true)
    expect(s.total).toBe(Math.round(0.9 * 75 + 10))
  })
  it('treats hallucinated evidence like no evidence', () => {
    expect(scoreReview(review(5, ['This quote is nowhere in the paper at all']), SOURCE).total)
      .toBe(scoreReview(review(5), SOURCE).total)
  })
  it('discounts low scores symmetrically, so a harsh unsupported review is also moderated', () => {
    const supported = scoreReview(review(1, [REAL]), SOURCE).total
    const unsupported = scoreReview(review(1), SOURCE).total
    expect(unsupported).toBeGreaterThan(supported)
  })
  it('caps unsound work and fatal flaws', () => {
    const r = review(5, [REAL])
    r.criteria.soundness = { score: 1, confidence: 3, rationale: '', evidence: [{ quote: REAL, page: 1 }] }
    const unsound = scoreReview(r, SOURCE)
    expect(unsound.caps).toContain('unsound')
    expect(unsound.total).toBeLessThanOrEqual(40)
    const fatal = scoreReview(review(5, [REAL], { fatalFlaws: ['Evaluated on training data'] }), SOURCE)
    expect(fatal.caps).toEqual(['fatal'])
    expect(fatal.total).toBe(45)
  })
  it('detects missing structure', () => {
    const s = scoreReview(review(3), '[Page 1]\nJust an essay without sections.')
    expect(s.completeness).toBe(0)
    expect(s.structure.every(item => !item.present)).toBe(true)
  })
  it('lowers confidence for truncated or mostly OCR input', () => {
    const full = scoreReview(review(4, [REAL]), SOURCE).confidence
    const partial = scoreReview(review(4, [REAL]), SOURCE, { pages: 80, scannedPages: 40, ocrPages: 30, ocrFailed: 0, chars: 1, truncated: true }).confidence
    expect(full).toBe(1)
    expect(partial).toBeLessThan(full)
  })
  it('handles missing criteria from a partial model response as neutral', () => {
    const r = review(5, [REAL])
    delete (r.criteria as Partial<Record<CriterionId, unknown>>).clarity
    expect(scoreReview(r, SOURCE).criteria.find(c => c.id === 'clarity')!.adjusted).toBe(3)
  })
  it('exposes contributions that add up to the uncapped total', () => {
    const s = scoreReview(review(4, [REAL]), SOURCE)
    expect(s.criteria.reduce((sum, c) => sum + c.points, 0) + s.structurePoints).toBeCloseTo(s.uncapped)
    expect(Math.round(s.uncapped)).toBe(s.total)
  })
  it('maps totals to decision bands', () => {
    expect([85, 70, 55, 40, 10].map(decide)).toEqual(['strong-accept', 'accept', 'borderline', 'weak-reject', 'reject'])
  })
})
