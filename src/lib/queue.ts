import type { Paper, Progress } from '../types'
import type { Locale } from '../copy'
import { aiConfigured, ocrPage, reviewPaper } from './ai'
import { deleteScanCheckpoint, getPdf, getScanCheckpoint, saveScanCheckpoint, scanPdf, storePdf } from './pdf'
import { loadPapers, patchPaper } from './store'
import { scoreReview } from './score'

/** Text shorter than this after scanning cannot be reviewed meaningfully. */
const MIN_REVIEW_CHARS = 200
/** Earlier reviews kept per paper when re-reviewing. */
export const MAX_HISTORY = 10
/** Streaming updates are written to localStorage at most this often. */
const STREAM_UPDATE_MS = 400

export function isPending(paper: Paper): boolean {
  // Image-only PDFs resume automatically once an OCR model is configured.
  if (paper.state === 'error') return paper.error === 'NEEDS_OCR' && aiConfigured('ocr')
  if (!['queued', 'scanning', 'reviewing'].includes(paper.state)) return false
  // Waits without spinning until an AI connection is configured.
  return paper.error !== 'AI_NOT_CONFIGURED' || aiConfigured('review')
}

export async function processPaper(paper: Paper, locale: Locale): Promise<void> {
  const { id } = paper
  const startedAt = new Date().toISOString()
  const progress = (value: Omit<Progress, 'startedAt'>) => patchPaper(id, { progress: { ...value, startedAt } })
  try {
    const stored = await getPdf(id)
    if (!stored) throw new Error('PDF_MISSING')
    let text = stored.text, scan = paper.scan, title = paper.title
    if (!text || !scan) {
      const canOcr = aiConfigured('ocr')
      patchPaper(id, { state: 'scanning', progress: { step: 'scan', startedAt }, error: undefined })
      // Resume an interrupted or partly failed scan: finished pages are saved one by one and not read or OCR'd again.
      const pages = (await getScanCheckpoint(id).catch(() => undefined))?.pages || []
      const result = await scanPdf(stored.blob, {
        ocr: canOcr ? ocrPage : undefined,
        onProgress: (done, total, ocr) => progress(ocr ? { step: 'ocr', done: done + 1, total } : { step: 'scan', done, total }),
        done: pages,
        onPage: async (n, page) => { pages[n - 1] = page; await saveScanCheckpoint({ id, pages }).catch(() => {}) },
      })
      text = result.text; scan = result.scan; title = result.title || title
      await storePdf({ ...stored, text })
      // Every page is final, so the stored text is all a later run needs.
      if (Array.from({ length: result.scan.scannedPages }, (_, i) => pages[i]).every(Boolean)) await deleteScanCheckpoint(id).catch(() => {})
      patchPaper(id, { scan: result.scan, ...(result.title ? { title: result.title } : {}) })
      if (text.replace(/\[Page \d+\]|\s/g, '').length < MIN_REVIEW_CHARS) {
        // Image-only PDF: rescan once an OCR model is available.
        await storePdf({ ...stored, text: '' })
        throw new Error(!canOcr ? 'NEEDS_OCR' : result.scan.ocrFailed ? 'OCR_FAILED' : 'AI_NO_TEXT')
      }
    }
    // Reviews start only when asked for; the paper may be read in understanding mode alone.
    if (loadPapers().find(p => p.id === id)?.scanOnly) { patchPaper(id, { state: 'scanned', progress: undefined, error: undefined }); return }
    if (!aiConfigured('review')) { patchPaper(id, { state: 'queued', progress: undefined, error: 'AI_NOT_CONFIGURED' }); return }
    patchPaper(id, { state: 'reviewing', progress: { step: 'send', chars: text.length, startedAt }, error: undefined })
    let lastWrite = 0
    const review = await reviewPaper(text, locale, (chars, field) => {
      const now = Date.now()
      if (now - lastWrite < STREAM_UPDATE_MS) return
      lastWrite = now
      progress({ step: 'generate', chars, field })
    })
    const { total, decision, version } = scoreReview(review, text, scan)
    // Keep the review being replaced so re-reviewing never loses a result.
    const current = loadPapers().find(p => p.id === id)
    const history = current?.review ? [current.review, ...(current.history || [])].slice(0, MAX_HISTORY) : current?.history
    patchPaper(id, { state: 'done', review, history, score: { total, decision, version }, progress: undefined, error: undefined, ...(review.title && title === paper.name.replace(/\.pdf$/i, '') ? { title: review.title } : {}) })
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error)
    patchPaper(id, { state: 'error', progress: undefined, error: code || 'UNKNOWN' })
  }
}
