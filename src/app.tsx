import { useEffect, useRef, useState } from 'preact/hooks'
import { FileUp, Library, Moon, Settings2, Sun, X } from 'lucide-preact'
import type { Paper } from './types'
import { COPY, detectLocale } from './copy'
import { loadPapers, mutatePapers, patchPaper, subscribePapers } from './lib/store'
import { acceptPdf, deletePdf, getPdf, storePdf } from './lib/pdf'
import { isPending, processPaper } from './lib/queue'
import { writeAppManifest } from './lib/appManifest'
import { AiSettings, useAiNetwork } from './components/AiSettings'
import { ReviewView } from './components/ReviewView'
import { StudyView, type Mode } from './components/StudyView'
import { ViewerPicker } from './components/ViewerPicker'
import { PDF_VIEWER_INDEX_KEY } from './lib/pdfViewerLibrary'
import { progressText } from './components/ProgressView'
import { useTheme } from './hooks/useTheme'

const hashParams = () => new URLSearchParams(location.hash.slice(1))
const readHash = () => hashParams().get('paper') || ''
const readMode = (): Mode => hashParams().get('mode') === 'study' ? 'study' : 'review'

export function App() {
  const [locale] = useState(detectLocale)
  const t = COPY[locale]
  const [papers, setPapers] = useState(loadPapers)
  const [selectedId, setSelectedId] = useState(readHash)
  const [mode, setMode] = useState(readMode)
  const [picker, setPicker] = useState(false)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const [settings, setSettings] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)
  const running = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const network = useAiNetwork()
  const { theme, toggleTheme } = useTheme()

  useEffect(() => { document.documentElement.lang = locale }, [locale])
  useEffect(() => subscribePapers(() => setPapers(loadPapers())), [])
  useEffect(() => {
    const onHash = () => { setSelectedId(readHash()); setMode(readMode()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { writeAppManifest({ app: 'tc-papers', version: '0.1.0', publishes: ['papers-backup'], consumes: [], reads: ['tc-shared-llm-config-v1', PDF_VIEWER_INDEX_KEY] }) }, [])
  useEffect(() => {
    if (!settings) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettings(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [settings])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // One paper at a time; re-evaluated whenever the list, the AI config or the previous job changes.
  useEffect(() => {
    if (running.current) return
    const next = papers.find(isPending)
    if (!next) return
    running.current = true
    void processPaper(next, locale).finally(() => { running.current = false; setTick(n => n + 1) })
  }, [papers, network.config, network.preferences, tick])

  function select(id: string, nextMode: Mode = 'review') {
    setSelectedId(id); setMode(nextMode)
    const url = new URL(location.href)
    url.hash = id ? new URLSearchParams({ paper: id, ...(nextMode === 'study' ? { mode: 'study' } : {}) }).toString() : ''
    history.replaceState(null, '', url)
  }

  async function addFiles(files: File[]) {
    const errors: string[] = []
    let firstId = ''
    for (const file of files) {
      try {
        const stored = await acceptPdf(file)
        if (loadPapers().some(p => p.id === stored.id)) { errors.push(`${file.name}: ${t.duplicate}`); continue }
        await storePdf(stored)
        const paper: Paper = { id: stored.id, name: file.name.slice(0, 500), size: file.size, title: file.name.replace(/\.pdf$/i, '').slice(0, 500), addedAt: new Date().toISOString(), state: 'queued', scanOnly: true }
        mutatePapers(current => [paper, ...current.filter(p => p.id !== paper.id)])
        firstId ||= paper.id
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        errors.push(`${file.name}: ${t.errors[code] || t.errors.UNKNOWN}`)
      }
    }
    if (errors.length) setNotice(errors.join(' / '))
    if (files.length === 1 && firstId) select(firstId)
  }

  /** A PDF picked in tc-pdf-viewer joins the list like a dropped file, then opens in understanding mode. */
  async function importFromViewer(file: File) {
    const { id } = await acceptPdf(file)
    if (!loadPapers().some(p => p.id === id)) await addFiles([file])
    if (!loadPapers().some(p => p.id === id)) return
    setPicker(false)
    select(id, 'study')
  }

  /** Starts the first review, or reviews again. */
  async function rerun(paper: Paper) {
    // Retry resumes where it failed: a finished scan is kept and only the review runs again.
    // Pages whose OCR failed are rescanned; the others come from the scan checkpoint.
    if (paper.state === 'error' && paper.scan?.ocrFailed) {
      const stored = await getPdf(paper.id).catch(() => undefined)
      if (stored) await storePdf({ ...stored, text: '' })
      patchPaper(paper.id, { state: 'queued', error: undefined, scan: undefined, scanOnly: undefined })
    } else patchPaper(paper.id, { state: 'queued', error: undefined, scanOnly: undefined })
  }

  function remove(paper: Paper) {
    mutatePapers(current => current.filter(p => p.id !== paper.id))
    void deletePdf(paper.id).catch(() => {})
    select('')
  }

  const selected = papers.find(p => p.id === selectedId)
  const studying = Boolean(selected) && mode === 'study'

  return <div class={`shell ${dragging ? 'dragging' : ''} ${studying ? 'full' : ''}`}
    onDragOver={e => { e.preventDefault(); setDragging(true) }}
    onDragLeave={e => { if (!e.relatedTarget) setDragging(false) }}
    onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files.length) void addFiles(Array.from(e.dataTransfer.files)) }}>
    <header class="topbar">
      <a class="brand" href="#" onClick={e => { e.preventDefault(); select('') }}>TC Papers</a>
      {/* Understanding mode renders its toolbar here, so the whole header is one slim row. */}
      {studying && <div class="topbar-slot" ref={setToolbarSlot} />}
      <div class="top-actions">
        <button class="icon" aria-label={theme === 'light' ? t.toDark : t.toLight} title={theme === 'light' ? t.toDark : t.toLight} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
        <button class="icon" aria-label={t.settings} title={t.settings} onClick={() => setSettings(true)}><Settings2 size={18} /></button>
      </div>
    </header>

    <main class={studying ? 'wide' : ''}>
      {selected && studying ? <StudyView paper={selected} t={t} locale={locale} toolbarSlot={toolbarSlot} onBack={() => select('')} onMode={m => select(selected.id, m)} />
        : selected ? <ReviewView paper={selected} t={t} onBack={() => select('')} onMode={m => select(selected.id, m)} onRerun={() => void rerun(selected)} onRemove={() => remove(selected)} /> : <>
        <button class="dropzone" onClick={() => fileRef.current?.click()}>
          <FileUp size={28} strokeWidth={1.5} />
          <strong>{t.drop}</strong>
          <span class="muted">{t.choose} · {t.limit}</span>
        </button>
        <button class="ghost from-viewer" onClick={() => setPicker(true)}><Library size={15} />{t.viewer.pick}</button>
        {papers.length > 0 && <ul class="papers">
          {papers.map(paper => <li key={paper.id}>
            <button onClick={() => select(paper.id)}>
              {paper.state === 'done' && paper.score ? <span class={`score-badge d-${paper.score.decision}`}>{paper.score.total}</span>
                : paper.state === 'scanned' ? <span class="score-badge pending">–</span>
                : <span class={`score-badge pending ${paper.state === 'error' || paper.error ? 'failed' : ''}`}>{paper.state === 'error' || paper.error ? '!' : <span class="spinner" />}</span>}
              <span class="p-main">
                <span class="p-title">{paper.title}</span>
                <span class="muted">{paper.state === 'done' && paper.score ? t.decisions[paper.score.decision as keyof typeof t.decisions]
                  : paper.error ? t.errors[paper.error] || t.errors.UNKNOWN : progressText(paper, t)}</span>
              </span>
            </button>
          </li>)}
        </ul>}
      </>}
    </main>

    <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={e => { void addFiles(Array.from(e.currentTarget.files || [])); e.currentTarget.value = '' }} />
    {dragging && <div class="drop-overlay"><FileUp size={40} strokeWidth={1.5} /><strong>{t.drop}</strong></div>}
    {notice && <div class="toast" role="alert"><span>{notice}</span><button class="icon" aria-label={t.close} onClick={() => setNotice('')}><X size={15} /></button></div>}
    {picker && <ViewerPicker t={t} onPick={importFromViewer} onClose={() => setPicker(false)} />}
    {settings && <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setSettings(false) }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={t.settings}>
        <div class="modal-head"><h2>{t.aiSettings}</h2><button class="icon" aria-label={t.close} onClick={() => setSettings(false)}><X size={18} /></button></div>
        <AiSettings locale={locale} network={network} />
      </div>
    </div>}
  </div>
}
