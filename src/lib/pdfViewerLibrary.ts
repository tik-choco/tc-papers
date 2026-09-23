// Read-only access to tc-pdf-viewer's PDF library on the same origin (pull-type, contract:
// protocol/docs/data-contracts/docs/keys/tc-pdf-viewer.md `mist_files_index`). tc-papers never writes it.
import { storage_get } from '../vendor/mistlib/index.js'
import { readAppManifest } from './appManifest'
import { ensureMistStorage } from './mist'

export const PDF_VIEWER_INDEX_KEY = 'mist_files_index'
export interface ViewerFile { name: string; cid: string; folder: string; updatedAt: number }

/** Parses the index defensively: entries of any other shape are skipped, never trusted. */
export function listViewerFiles(): ViewerFile[] {
  let value: unknown
  try { value = JSON.parse(localStorage.getItem(PDF_VIEWER_INDEX_KEY) || '[]') } catch { return [] }
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const f = item as Record<string, unknown>
    if (typeof f.name !== 'string' || !f.name || typeof f.cid !== 'string' || !f.cid) return []
    const time = Number(f.updatedAt ?? f.createdAt)
    return [{ name: f.name.slice(0, 500), cid: f.cid, folder: typeof f.folder === 'string' && f.folder ? f.folder.slice(0, 200) : 'Default', updatedAt: Number.isFinite(time) ? time : 0 }]
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Whether tc-pdf-viewer has ever run on this origin (so an empty list means "no PDFs yet", not "not installed"). */
export function pdfViewerKnown(): boolean { return readAppManifest('tc-pdf-viewer') !== null || listViewerFiles().length > 0 }

export async function loadViewerFile(file: ViewerFile): Promise<File> {
  await ensureMistStorage()
  let bytes: Uint8Array
  try { bytes = await storage_get(file.cid) } catch { throw new Error('VIEWER_FILE_MISSING') }
  const name = /\.pdf$/i.test(file.name) ? file.name : file.name + '.pdf'
  return new File([bytes as BlobPart], name, { type: 'application/pdf' })
}
