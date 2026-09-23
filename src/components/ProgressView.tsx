import { useEffect, useState } from 'preact/hooks'
import { Check } from 'lucide-preact'
import type { Paper } from '../types'
import type { Copy } from '../copy'

/** One-line description of what is happening to the paper right now. */
export function progressText(paper: Paper, t: Copy): string {
  const p = paper.progress
  if (!p) return paper.state === 'queued' ? t.progress.queued : t.states[paper.state]
  if (p.step === 'scan') return t.progress.scan(p.done, p.total)
  if (p.step === 'ocr') return t.progress.ocr(p.done, p.total)
  if (p.step === 'send') return t.progress.send(p.chars)
  const field = p.field && (t.fields[p.field] || t.criteria[p.field as keyof typeof t.criteria])
  return t.progress.generate(p.chars, field)
}

function useElapsed(startedAt?: string) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000)) : 0
}

export function ProgressView({ paper, t }: { paper: Paper; t: Copy }) {
  const p = paper.progress
  const elapsed = useElapsed(p?.startedAt)
  const current = paper.state === 'reviewing' ? 1 : paper.state === 'scanning' ? 0 : -1
  const steps = [t.steps.scan, t.steps.review, t.steps.score]
  const ratio = p?.total && (p.step === 'scan' || p.step === 'ocr') ? (p.done || 0) / p.total : null
  return <section class="progress" aria-live="polite">
    <ol class="steps">
      {steps.map((label, i) => <li key={label} class={i < current ? 'done' : i === current ? 'active' : ''}>
        <span class="dot">{i < current ? <Check size={12} /> : i === current ? <span class="spinner" /> : i + 1}</span>{label}
      </li>)}
    </ol>
    <p class="progress-detail">{progressText(paper, t)}{p && <span class="muted"> · {t.progress.elapsed(elapsed)}</span>}</p>
    {ratio !== null && <span class="bar"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>}
  </section>
}
