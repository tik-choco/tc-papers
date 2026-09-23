import type { CriterionId, Evidence, ReviewResult, ScanInfo } from '../types'

/**
 * Evaluation function.
 *
 * The model only supplies per-criterion 1–5 judgements with quoted evidence. The final
 * score is computed here, deterministically, so it can be audited and recomputed when
 * the function changes (raw judgements are what gets stored).
 *
 * 1. Evidence check: every quote is matched against the scanned text. A judgement's
 *    distance from neutral (3) is scaled by k = 0.5 + 0.5 × verifiedRatio, so ungrounded
 *    or hallucinated evidence pulls the criterion toward 3.
 * 2. Weighted mean of adjusted criteria, mapped to 0–100.
 * 3. Structure completeness (detected locally from the text) contributes 10%.
 * 4. Gates: unsound methodology caps at 40, any fatal flaw caps at 45.
 */
export const SCORER_VERSION = 1

export const CRITERIA: { id: CriterionId; weight: number; anchors: string }[] = [
  { id: 'soundness', weight: 0.25, anchors: 'Are methods, derivations and claims technically correct and justified? 1 = major errors or unsupported central claims, 3 = mostly correct with notable gaps, 5 = rigorous with no identifiable errors.' },
  { id: 'evidence', weight: 0.2, anchors: 'Do experiments/data/proofs actually support the claims (baselines, ablations, statistics, sample size)? 1 = no or anecdotal evidence, 3 = supports main claim with missing controls, 5 = strong, well-controlled, statistically sound.' },
  { id: 'novelty', weight: 0.2, anchors: 'How new is the contribution relative to cited prior work? 1 = known or incremental re-packaging, 3 = meaningful but expected extension, 5 = clearly new idea or result.' },
  { id: 'significance', weight: 0.15, anchors: 'Impact if the claims hold. 1 = negligible, 3 = useful to a sub-community, 5 = likely to change practice or open a direction.' },
  { id: 'clarity', weight: 0.1, anchors: 'Organization, precision of writing, figures, definitions. 1 = hard to follow, 3 = understandable with effort, 5 = clear and precise.' },
  { id: 'reproducibility', weight: 0.1, anchors: 'Could an expert reproduce the work (details, hyperparameters, code/data availability)? 1 = key details missing, 3 = partially, 5 = fully specified with artifacts.' },
]

export const STRUCTURE_CHECKS: { id: string; pattern: RegExp }[] = [
  { id: 'abstract', pattern: /\babstract\b|要旨|概要|摘要/i },
  { id: 'method', pattern: /\bmethods?\b|\bmethodology\b|\bapproach\b|提案手法|手法|方法/i },
  { id: 'results', pattern: /\bexperiments?\b|\bevaluation\b|\bresults\b|実験|評価|結果/i },
  { id: 'limitations', pattern: /\blimitations?\b|threats to validity|\bfuture work\b|限界|課題|今後/i },
  { id: 'references', pattern: /\breferences\b|\bbibliography\b|参考文献|引用文献/i },
  { id: 'artifacts', pattern: /github\.com|gitlab\.|zenodo|huggingface\.co|osf\.io|code (?:is |will be )?(?:publicly )?available|ソースコード|公開して/i },
]

export type Decision = 'strong-accept' | 'accept' | 'borderline' | 'weak-reject' | 'reject'

/** Lower bound of each decision band, highest first. */
export const DECISION_BANDS: { decision: Decision; min: number }[] = [
  { decision: 'strong-accept', min: 80 }, { decision: 'accept', min: 65 }, { decision: 'borderline', min: 50 }, { decision: 'weak-reject', min: 35 }, { decision: 'reject', min: 0 },
]
export const BASE_SHARE = 0.9
export const CAP_UNSOUND = 40
export const CAP_FATAL = 45

export interface CriterionScore {
  id: CriterionId
  weight: number
  raw: number
  adjusted: number
  verified: number
  quotes: number
  /** Per-quote verification result, aligned with the model's evidence array. */
  checks: boolean[]
  /** Contribution to the 0–100 total before caps. */
  points: number
}

export interface ScoreBreakdown {
  version: number
  total: number
  base: number
  decision: Decision
  criteria: CriterionScore[]
  structure: { id: string; present: boolean }[]
  completeness: number
  /** Contribution of the structure check to the total before caps. */
  structurePoints: number
  /** Total before caps, unrounded. */
  uncapped: number
  caps: ('unsound' | 'fatal')[]
  confidence: number
  confidenceFactors: { self: number; verifiedRatio: number; truncated: boolean; mostlyOcr: boolean }
}

export function normalizeForMatch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\[page \d+\]/g, '').replace(/-\s*\n\s*/g, '').replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** A quote counts as verified when ≥70% of its 12-character chunks appear in the source (tolerates OCR noise). */
export function verifyQuote(quote: string, normalizedSource: string): boolean {
  const q = normalizeForMatch(quote)
  if (q.length < 8) return false
  if (normalizedSource.includes(q)) return true
  const size = 12, chunks: string[] = []
  for (let i = 0; i + size <= q.length; i += size) chunks.push(q.slice(i, i + size))
  if (chunks.length < 2) return false
  return chunks.filter(chunk => normalizedSource.includes(chunk)).length / chunks.length >= 0.7
}

export function decide(total: number): Decision {
  return DECISION_BANDS.find(band => total >= band.min)?.decision ?? 'reject'
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function scoreReview(review: ReviewResult, sourceText: string, scan?: ScanInfo): ScoreBreakdown {
  const source = normalizeForMatch(sourceText)
  const criteria = CRITERIA.map(({ id, weight }) => {
    const rating = review.criteria[id]
    const raw = clamp(rating?.score || 3, 1, 5)
    const evidence: Evidence[] = rating?.evidence || []
    const checks = evidence.map(item => verifyQuote(item.quote, source))
    const verified = checks.filter(Boolean).length
    const ratio = evidence.length ? verified / evidence.length : 0
    const adjusted = 3 + (raw - 3) * (0.5 + 0.5 * ratio)
    return { id, weight, raw, adjusted, verified, quotes: evidence.length, checks, points: BASE_SHARE * weight * (adjusted - 1) / 4 * 100 }
  })
  const base = criteria.reduce((sum, c) => sum + c.weight * (c.adjusted - 1) / 4 * 100, 0)
  const structure = STRUCTURE_CHECKS.map(({ id, pattern }) => ({ id, present: pattern.test(sourceText) }))
  const completeness = structure.filter(s => s.present).length / structure.length
  const structurePoints = (1 - BASE_SHARE) * completeness * 100
  const uncapped = BASE_SHARE * base + structurePoints
  let total = uncapped
  const caps: ScoreBreakdown['caps'] = []
  if (criteria.find(c => c.id === 'soundness')!.adjusted < 2) { caps.push('unsound'); total = Math.min(total, CAP_UNSOUND) }
  if (review.fatalFlaws.length) { caps.push('fatal'); total = Math.min(total, CAP_FATAL) }
  total = Math.round(clamp(total, 0, 100))

  const quotes = criteria.reduce((sum, c) => sum + c.quotes, 0)
  const verifiedRatio = quotes ? criteria.reduce((sum, c) => sum + c.verified, 0) / quotes : 0
  const selfConfidence = CRITERIA.reduce((sum, { id }) => sum + clamp(review.criteria[id]?.confidence || 1, 1, 3), 0) / CRITERIA.length / 3
  let confidence = selfConfidence * (0.5 + 0.5 * verifiedRatio)
  const truncated = Boolean(scan?.truncated)
  const mostlyOcr = Boolean(scan && scan.scannedPages && scan.ocrPages / scan.scannedPages > 0.5)
  if (truncated) confidence *= 0.85
  if (mostlyOcr) confidence *= 0.9

  return { version: SCORER_VERSION, total, base: Math.round(base), decision: decide(total), criteria, structure, completeness, structurePoints, uncapped, caps,
    confidence: Math.round(confidence * 100) / 100, confidenceFactors: { self: selfConfidence, verifiedRatio, truncated, mostlyOcr } }
}
