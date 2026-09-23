import { useLayoutEffect, useMemo, useState } from 'preact/hooks'
import { ExternalLink, FileText, X } from 'lucide-preact'
import type { Copy } from '../copy'
import { backdropClose } from '../lib/backdrop'
import { PDF_VIEWER_INDEX_KEY, listViewerFiles, loadViewerFile, pdfViewerKnown, type ViewerFile } from '../lib/pdfViewerLibrary'

/** Lists tc-pdf-viewer's library (same origin) and hands the chosen PDF over as a File. */
export function ViewerPicker({ t, onPick, onClose }: { t: Copy; onPick: (file: File) => Promise<void>; onClose: () => void }) {
  const [files, setFiles] = useState(listViewerFiles)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === PDF_VIEWER_INDEX_KEY || e.key === null) setFiles(listViewerFiles()) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('keydown', onKey) }
  }, [onClose])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? files.filter(f => f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)) : files
  }, [files, filter])

  async function pick(file: ViewerFile) {
    if (loading) return
    setLoading(file.cid); setError('')
    try { await onPick(await loadViewerFile(file)) }
    catch (e) { setError(t.errors[e instanceof Error ? e.message : ''] || t.errors.UNKNOWN) }
    finally { setLoading('') }
  }

  return <div class="modal-backdrop" {...backdropClose(onClose)}>
    <div class="modal picker" role="dialog" aria-modal="true" aria-label={t.viewer.title}>
      <div class="modal-head"><h2>{t.viewer.title}</h2><button class="icon" aria-label={t.close} onClick={onClose}><X size={18} /></button></div>
      <p class="muted">{t.viewer.note}</p>
      {error && <p class="error-text" role="alert">{error}</p>}
      {files.length > 6 && <input class="picker-search" type="search" placeholder={t.viewer.search} value={filter} onInput={e => setFilter(e.currentTarget.value)} />}
      {files.length === 0 ? <div class="picker-empty">
        <p class="muted">{pdfViewerKnown() ? t.viewer.empty : t.viewer.unknown}</p>
        <a class="ghost" href="../tc-pdf-viewer/" target="_blank" rel="noopener"><ExternalLink size={15} />{t.viewer.open}</a>
      </div> : <ul class="picker-list">
        {shown.map(file => <li key={file.cid + file.name}>
          <button disabled={Boolean(loading)} onClick={() => void pick(file)}>
            {loading === file.cid ? <span class="spinner" /> : <FileText size={18} strokeWidth={1.5} />}
            <span class="p-main"><span class="p-title">{file.name}</span><span class="muted small">{file.folder}{file.updatedAt ? ' · ' + new Date(file.updatedAt).toLocaleDateString() : ''}</span></span>
          </button>
        </li>)}
      </ul>}
    </div>
  </div>
}
