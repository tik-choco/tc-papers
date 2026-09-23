import type { ScanInfo } from '../types'

export interface StoredPdf { id: string; blob: Blob; text: string }
export const MAX_PDF_SIZE = 50 * 1024 * 1024
export const MAX_PAGES = 40
export const MAX_CHARS = 120_000
/** Pages with fewer visible characters than this are treated as images and sent to OCR. */
export const MIN_PAGE_CHARS = 40

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tc-papers:pdfs-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('PDF_STORAGE'))
  })
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  let db: IDBDatabase
  try { db = await database() } catch { throw new Error('PDF_STORAGE') }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', mode)
    const request = action(tx.objectStore('pdfs'))
    tx.oncomplete = () => { db.close(); resolve(request.result) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('PDF_STORAGE')) }
  })
}
export async function storePdf(pdf: StoredPdf): Promise<void> { await transaction('readwrite', store => store.put(pdf)) }
export function getPdf(id: string): Promise<StoredPdf | undefined> { return transaction('readonly', store => store.get(id)) }
export async function deletePdf(id: string): Promise<void> { await transaction('readwrite', store => store.delete(id)) }

/** Validates and hashes a dropped file. Parsing happens later in scanPdf. */
export async function acceptPdf(file: File): Promise<StoredPdf> {
  if (file.size > MAX_PDF_SIZE) throw new Error('PDF_TOO_LARGE')
  if (!file.size || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) throw new Error('PDF_INVALID')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('PDF_INVALID')
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const id = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { id, blob: new Blob([bytes], { type: 'application/pdf' }), text: '' }
}

async function openDocument(blob: Blob) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const base = import.meta.env.BASE_URL
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, cMapUrl: base + 'pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: base + 'pdfjs/standard_fonts/', wasmUrl: base + 'pdfjs/wasm/' })
}

export interface ScanOptions {
  /** OCR one rendered page (JPEG data URL). Omit when no OCR model is available. */
  ocr?: (dataUrl: string, page: number) => Promise<string>
  onProgress?: (done: number, total: number, ocr: boolean) => void
}

/**
 * Text layer first; pages without one are rendered and OCR'd (same approach as tc-pdf-viewer,
 * but only for pages that need it). Output uses [Page N] markers so evidence can cite pages.
 */
export async function scanPdf(blob: Blob, { ocr, onProgress }: ScanOptions = {}): Promise<{ text: string; title: string; scan: ScanInfo }> {
  const task = await openDocument(blob)
  try {
    const doc = await task.promise.catch(() => { throw new Error('PDF_READ_FAILED') })
    const metadata = await doc.getMetadata().catch(() => null)
    const info = metadata?.info as { Title?: unknown } | undefined
    const rawTitle = typeof info?.Title === 'string' ? info.Title.trim().replace(/[\u0000-\u001f]/g, ' ') : ''
    const title = rawTitle && !/^(untitled|document|microsoft word\s*-?)/i.test(rawTitle) ? rawTitle.slice(0, 500) : ''
    const total = Math.min(doc.numPages, MAX_PAGES)
    let text = '', ocrPages = 0, ocrFailed = 0, scannedPages = 0
    for (let n = 1; n <= total && text.length < MAX_CHARS; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
      if (pageText.replace(/\s/g, '').length < MIN_PAGE_CHARS && ocr) {
        onProgress?.(n - 1, total, true)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height)
        const context = canvas.getContext('2d', { alpha: false })!
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
        try { pageText = await ocr(canvas.toDataURL('image/jpeg', 0.85), n); ocrPages++ }
        catch { if (++ocrFailed >= 2 && !ocrPages) ocr = undefined } // e.g. a text-only model: stop retrying
        canvas.width = canvas.height = 0
      }
      page.cleanup()
      text += '\n[Page ' + n + ']\n' + pageText
      scannedPages = n
      onProgress?.(n, total, false)
    }
    const truncated = text.length > MAX_CHARS || doc.numPages > scannedPages
    text = text.slice(0, MAX_CHARS)
    return { text, title, scan: { pages: doc.numPages, scannedPages, ocrPages, ocrFailed, chars: text.length, truncated } }
  } finally { await task.destroy() }
}
