import type { Paper } from '../types'

export const STORAGE_KEY = 'tc-papers:reviews-v1'
const CHANGE_EVENT = 'tc-papers:reviews-changed'
const STATES = ['queued', 'scanning', 'reviewing', 'done', 'error']

function isPaper(value: unknown): value is Paper {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.id === 'string' && /^[a-f0-9]{64}$/.test(p.id) && typeof p.name === 'string' && typeof p.title === 'string'
    && typeof p.size === 'number' && typeof p.addedAt === 'string' && STATES.includes(p.state as string)
}

export function loadPapers(): Paper[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch { return [] }
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    // Drop malformed progress/history entries rather than trusting stored data.
    return Array.isArray(value) ? value.filter(isPaper).map(p => ({
      ...p,
      progress: typeof p.progress === 'object' && p.progress ? p.progress : undefined,
      history: Array.isArray(p.history) ? p.history.filter(r => r && typeof r === 'object' && r.criteria) : undefined,
    })) : []
  } catch { return [] }
}

export function savePapers(papers: Paper[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(papers))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Read-modify-write against the latest stored list so concurrent tabs and the queue don't clobber each other. */
export function mutatePapers(transform: (papers: Paper[]) => Paper[]): Paper[] {
  const next = transform(loadPapers())
  savePapers(next)
  return next
}

export function patchPaper(id: string, patch: Partial<Paper>): void {
  mutatePapers(papers => papers.map(p => p.id === id ? { ...p, ...patch } : p))
}

export function subscribePapers(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) callback() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE_EVENT, callback) }
}
