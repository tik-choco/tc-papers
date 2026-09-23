export type CriterionId = 'soundness' | 'evidence' | 'novelty' | 'significance' | 'clarity' | 'reproducibility'

export interface Evidence { page: number | null; quote: string }

/** Raw per-criterion judgement returned by the reviewer model. Scores are never trusted as final. */
export interface CriterionRating {
  score: number // 1–5
  confidence: number // 1–3
  rationale: string
  evidence: Evidence[]
}

/** A reviewer comment anchored to a place in the paper, always paired with a concrete fix. */
export interface ReviewComment {
  page: number | null
  section: string
  severity: 'major' | 'minor'
  comment: string
  suggestion: string
}

/** Raw model output. The final score is always recomputed locally by lib/score.ts. */
export interface ReviewResult {
  createdAt: string
  model: string
  title: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  questions: string[]
  fatalFlaws: string[]
  /** Optional: the model may omit them. */
  overall?: string
  comments?: ReviewComment[]
  pathToAcceptance?: string[]
  criteria: Record<CriterionId, CriterionRating>
}

export type PaperState = 'queued' | 'scanning' | 'reviewing' | 'done' | 'error'

export type ProgressStep = 'scan' | 'ocr' | 'send' | 'generate'

/** Live status of the job currently running on a paper. */
export interface Progress {
  step: ProgressStep
  /** Pages done / total while scanning, OCR page number while OCRing. */
  done?: number
  total?: number
  /** Characters sent (send) or received so far (generate). */
  chars?: number
  /** Field the model is currently writing, detected from the stream. */
  field?: string
  startedAt: string
}

export interface ScanInfo { pages: number; scannedPages: number; ocrPages: number; ocrFailed: number; chars: number; truncated: boolean }

export interface Paper {
  /** SHA-256 of the PDF bytes; also the IndexedDB key. */
  id: string
  name: string
  size: number
  title: string
  addedAt: string
  state: PaperState
  progress?: Progress
  error?: string
  scan?: ScanInfo
  review?: ReviewResult
  /** Earlier reviews of the same PDF, newest first (kept when re-reviewing). */
  history?: ReviewResult[]
  /** Cached result of lib/score.ts for the list view; the detail view recomputes it. */
  score?: { total: number; decision: string; version: number }
  /** Understanding mode: the story graph and the reader's growing notes. */
  study?: Study
}

/** Role a part of the paper plays in its argument. `concept` nodes are added while the reader asks questions. */
export type StoryKind = 'background' | 'problem' | 'gap' | 'claim' | 'method' | 'experiment' | 'result' | 'limitation' | 'implication' | 'concept'

export interface StoryNode { id: string; kind: StoryKind; label: string; summary: string; pages: number[] }
export interface StoryEdge { from: string; to: string; label: string }

/** One bullet of the understanding tree. `q` is the question that added it (absent for the initial outline). */
export interface StudyPoint { id: string; text: string; page: number | null; children: StudyPoint[]; q?: string }

export interface StudyQuestion { id: string; text: string; nodeId: string; askedAt: string; model: string; selection?: string }

export interface Study {
  createdAt: string
  model: string
  /** The paper's story in one sentence. */
  thesis: string
  /** In story order. */
  nodes: StoryNode[]
  edges: StoryEdge[]
  /** Bullets per story node id. */
  tree: Record<string, StudyPoint[]>
  questions: StudyQuestion[]
  /** Questions worth asking next, refreshed after every answer. */
  followUps: string[]
}
