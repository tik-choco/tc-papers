import { useEffect, useRef, useState } from 'preact/hooks'
import { Minus, Plus } from 'lucide-preact'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getPdf, openDocument } from '../lib/pdf'
import type { Copy } from '../copy'

/** Scroll request: the nonce lets the same page be requested twice in a row. */
export interface PdfTarget { page: number; nonce: number }
export interface PdfSelection { text: string; page: number | null }
interface Size { w: number; h: number }

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2]

function PageView({ doc, n, scale, base }: { doc: PDFDocumentProxy; n: number; scale: number; base: Size }) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [size, setSize] = useState<Size | null>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(Boolean(entry?.isIntersecting)), { rootMargin: '800px 0px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [])
  // Only pages near the viewport keep a canvas, so long papers stay light.
  useEffect(() => {
    const canvas = canvasRef.current!, text = textRef.current!
    if (!near || !scale) { canvas.width = canvas.height = 0; text.replaceChildren(); return }
    let cancelled = false
    let cancel = () => {}
    void (async () => {
      const [pdfjs, page] = await Promise.all([import('pdfjs-dist'), doc.getPage(n)])
      if (cancelled) return
      const unit = page.getViewport({ scale: 1 })
      setSize({ w: unit.width, h: unit.height })
      const viewport = page.getViewport({ scale })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio)
      const render = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      text.replaceChildren()
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport })
      cancel = () => { render.cancel(); layer.cancel() }
      await Promise.all([render.promise, layer.render()]).catch(() => {})
    })()
    return () => { cancelled = true; cancel() }
  }, [near, scale, doc, n])
  const own = size || base
  return <div ref={ref} class="pdf-page" data-page={n} style={{ width: own.w * scale + 'px', height: own.h * scale + 'px', '--total-scale-factor': scale }}>
    <canvas ref={canvasRef} />
    <div ref={textRef} class="textLayer" />
  </div>
}

export function PdfPane({ paperId, target, onSelect, t }: { paperId: string; target: PdfTarget | null; onSelect: (selection: PdfSelection) => void; t: Copy }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [base, setBase] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(2)
  const [current, setCurrent] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    let destroy = () => {}
    setDoc(null); setFailed(false)
    void (async () => {
      const stored = await getPdf(paperId)
      if (!stored) throw new Error('PDF_MISSING')
      const task = await openDocument(stored.blob)
      destroy = () => { void task.destroy() }
      if (!alive) return destroy()
      const loaded = await task.promise
      const first = (await loaded.getPage(1)).getViewport({ scale: 1 })
      if (!alive) return
      setBase({ w: first.width, h: first.height }); setDoc(loaded)
    })().catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; destroy() }
  }, [paperId])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth - 24))
    observer.observe(el)
    return () => observer.disconnect()
  }, [doc])

  useEffect(() => {
    if (!target || !doc) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${Math.min(target.page, doc.numPages)}"]`)
    if (el) scroller.current!.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
  }, [target, doc])

  function onScroll() {
    const el = scroller.current!
    const pages = el.querySelectorAll<HTMLElement>('.pdf-page')
    const mid = el.scrollTop + el.clientHeight / 3
    let page = 1
    for (const p of pages) { if (p.offsetTop <= mid) page = Number(p.dataset.page) } // pages are in order
    setCurrent(page)
  }

  function onPointerUp() {
    const selection = window.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim() || ''
    if (text.length < 2 || !selection?.anchorNode || !scroller.current?.contains(selection.anchorNode)) return
    const page = (selection.anchorNode.parentElement?.closest('[data-page]') as HTMLElement | null)?.dataset.page
    onSelect({ text: text.slice(0, 2000), page: page ? Number(page) : null })
  }

  const scale = width > 0 && base ? width / base.w * ZOOMS[zoom]! : 0
  return <section class="pdf-pane" aria-label="PDF">
    <div class="pdf-bar">
      <span class="muted small">{doc ? `p. ${current} / ${doc.numPages}` : ''}</span>
      <span class="muted small pdf-hint">{t.study.selectHint}</span>
      <div class="pdf-zoom">
        <button class="icon" aria-label={t.study.zoomOut} title={t.study.zoomOut} disabled={zoom === 0} onClick={() => setZoom(z => z - 1)}><Minus size={15} /></button>
        <button class="icon" aria-label={t.study.zoomIn} title={t.study.zoomIn} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(z => z + 1)}><Plus size={15} /></button>
      </div>
    </div>
    <div ref={scroller} class="pdf-scroll" onScroll={onScroll} onMouseUp={onPointerUp} onTouchEnd={onPointerUp} onKeyUp={onPointerUp}>
      {failed ? <p class="muted pdf-empty">{t.errors.PDF_MISSING}</p>
        : !doc || !base ? <p class="muted pdf-empty"><span class="spinner" /></p>
        : Array.from({ length: doc.numPages }, (_, i) => <PageView key={i} doc={doc} n={i + 1} scale={scale} base={base} />)}
    </div>
  </section>
}
