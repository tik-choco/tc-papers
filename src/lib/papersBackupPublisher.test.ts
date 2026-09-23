import { afterEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from './store'
import type { Paper } from '../types'

// Real timers throughout: the module's debounce/initial-delay use real
// setTimeout, and the actual crypto.subtle AES-GCM/digest ops it awaits
// don't resolve under vi.useFakeTimers() (they settle via the real event
// loop, not a faked clock), so waiting for effects uses vi.waitFor instead
// of advancing a fake clock. All steps run in one test/one module instance:
// startPapersBackupPublisher() never unsubscribes its window listener (by
// design, matching booksBackupPublisher — it's an app-lifetime singleton),
// so starting it more than once per file would leak listeners across tests
// and double-count later publishes.

const mocks = vi.hoisted(() => ({ publishShared: vi.fn(), storage_add: vi.fn(async () => 'cid-1') }))
vi.mock('./sharedBus', () => ({ publishShared: mocks.publishShared }))
vi.mock('../vendor/mistlib/index.js', () => ({ storage_add: mocks.storage_add }))
vi.mock('./mist', () => ({ ensureMistStorage: async () => {} }))

const { startPapersBackupPublisher } = await import('./papersBackupPublisher')

function paper(overrides: Partial<Paper> = {}): Paper {
  return { id: 'a'.repeat(64), name: 'p.pdf', size: 1, title: 't', addedAt: '2026-01-01T00:00:00.000Z', state: 'done', ...overrides }
}

function setPapers(papers: Paper[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(papers))
  window.dispatchEvent(new Event('tc-papers:reviews-changed'))
}

async function waitForCalls(count: number) {
  await vi.waitFor(() => expect(mocks.storage_add).toHaveBeenCalledTimes(count), { timeout: 8000, interval: 20 })
}

afterEach(() => vi.clearAllMocks())

describe('startPapersBackupPublisher', () => {
  it('publishes on startup, dedupes unchanged/progress-only content, and republishes on real changes', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([paper({ state: 'reviewing' })]))
    startPapersBackupPublisher()
    startPapersBackupPublisher() // idempotent — must not double-schedule

    await waitForCalls(1)
    expect(mocks.publishShared).toHaveBeenCalledTimes(1)
    const [topic, cid, meta] = mocks.publishShared.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(topic).toBe('papers-backup')
    expect(cid).toBe('')
    expect((meta.item as { id: string }).id).toBe('tc-papers-backup')
    expect((meta.item as { name: string }).name).toBe('tc-papers-backup.json')

    // Re-publish trigger with byte-identical content: signature unchanged, no new publish.
    setPapers([paper({ state: 'reviewing' })])
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(mocks.storage_add).toHaveBeenCalledTimes(1)

    // Only the transient `progress` field changes: still excluded from the signature.
    setPapers([paper({ state: 'reviewing', progress: { step: 'generate', chars: 42, startedAt: '2026-01-01T00:00:01.000Z' } })])
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(mocks.storage_add).toHaveBeenCalledTimes(1)

    // An actual content change republishes.
    setPapers([paper({ state: 'done' }), paper({ id: 'b'.repeat(64) })])
    await waitForCalls(2)
  }, 20000)
})
