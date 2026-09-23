import { useEffect, useRef, useState } from 'preact/hooks'
import { ArrowLeft, Check, Copy, FileText, Lightbulb, RotateCw, Send, Sparkles, X } from 'lucide-preact'
import type { Paper, StudyPoint } from '../types'
import type { Copy as CopyText, Locale } from '../copy'
import { chatJson } from '../lib/ai'
import { getPdf } from '../lib/pdf'
import { loadPapers, patchPaper } from '../lib/store'
import { ANSWER_SCHEMA, STORY_REMINDER, STORY_SCHEMA, applyAnswer, askMessage, askPrompt, parseStory, storyPrompt, studyToMarkdown } from '../lib/study'
import { StoryGraph } from './StoryGraph'
import { PdfPane, type PdfSelection, type PdfTarget } from './PdfPane'

export type Mode = 'review' | 'study'

export function ModeTabs({ mode, t, onMode }: { mode: Mode; t: CopyText; onMode: (mode: Mode) => void }) {
  return <div class="mode-tabs" role="tablist">
    {(['review', 'study'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? 'active' : ''} onClick={() => onMode(m)}>
      {m === 'study' && <Lightbulb size={14} />}{m === 'study' ? t.study.tab : t.study.reviewTab}
    </button>)}
  </div>
}

function Points({ points, fresh, questions, t, onPage }: { points: StudyPoint[]; fresh: Set<string>; questions: Map<string, { n: number; text: string }>; t: CopyText; onPage: (page: number) => void }) {
  return <ul>
    {points.map(p => {
      const q = p.q ? questions.get(p.q) : undefined
      return <li key={p.id} class={fresh.has(p.id) ? 'fresh' : ''}>
        <span class="pt">
          {q && <span class="q-badge" title={`${t.study.questionBadge}: ${q.text}`}>Q{q.n}</span>}
          {p.text}
          {p.page && <button class="page-ref" onClick={() => onPage(p.page!)}>p.{p.page}</button>}
        </span>
        {p.children.length > 0 && <Points points={p.children} fresh={fresh} questions={questions} t={t} onPage={onPage} />}
      </li>
    })}
  </ul>
}

export function StudyView({ paper, t, locale, onBack, onMode }: { paper: Paper; t: CopyText; locale: Locale; onBack: () => void; onMode: (mode: Mode) => void }) {
  const study = paper.study
  const [selected, setSelected] = useState(study?.nodes[0]?.id || '')
  const [busy, setBusy] = useState<{ chars: number; building: boolean } | null>(null)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [fresh, setFresh] = useState<{ node: string; points: Set<string> }>({ node: '', points: new Set() })
  const [target, setTarget] = useState<PdfTarget | null>(null)
  const [showPdf, setShowPdf] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 960px)').matches)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const scanned = Boolean(paper.scan) && !['queued', 'scanning'].includes(paper.state)

  useEffect(() => { if (study && !study.nodes.some(n => n.id === selected)) setSelected(study.nodes[0]!.id) }, [study, selected])
  useEffect(() => {
    treeRef.current?.querySelector(`[data-node="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  function jump(page: number) {
    setShowPdf(true)
    setTarget({ page, nonce: Date.now() })
  }

  async function paperText() {
    const stored = await getPdf(paper.id)
    if (!stored) throw new Error('PDF_MISSING')
    if (!stored.text.replace(/\[Page \d+\]|\s/g, '')) throw new Error('AI_NO_TEXT')
    return stored.text
  }

  async function run(building: boolean, job: (onText: (full: string) => void) => Promise<void>) {
    if (busy) return
    setBusy({ chars: 0, building }); setError('')
    try { await job(full => setBusy({ chars: full.length, building })) }
    catch (e) { setError(e instanceof Error ? e.message : 'UNKNOWN') }
    finally { setBusy(null) }
  }

  const build = () => run(true, async onText => {
    const text = await paperText()
    const next = await chatJson('study', [{ role: 'system', content: storyPrompt(locale) }, { role: 'user', content: 'Paper text:\n' + text + '\n\n' + STORY_REMINDER }], STORY_SCHEMA, parseStory, onText)
    patchPaper(paper.id, { study: next })
    setSelected(next.nodes[0]!.id); setFresh({ node: '', points: new Set() }); setConfirming(false)
  })

  const ask = (preset?: string) => run(false, async onText => {
    const current = loadPapers().find(p => p.id === paper.id)?.study
    const text = (preset ?? question).trim() || (selection ? t.study.explainSelection : '')
    if (!current || !text) return
    const focus = current.nodes.find(n => n.id === selected)
    const paperBody = await paperText()
    const record = (model: string) => ({ text, askedAt: new Date().toISOString(), model, ...(selection ? { selection: selection.text.slice(0, 500) } : {}) })
    // Parsing against the current tree validates the reply (and triggers the repair retry if needed).
    const { raw, model } = await chatJson('study', [
      { role: 'system', content: askPrompt(locale) },
      // Paper first so the long, unchanging prefix can be cached by the provider between questions.
      { role: 'user', content: 'Paper text:\n' + paperBody + '\n\n' + askMessage(current, text, focus, selection || undefined) },
    ], ANSWER_SCHEMA, (raw, model) => { applyAnswer(current, raw, record(model), focus?.id); return { raw, model } }, onText)
    // Re-read: another tab may have added to the tree while the model was answering.
    const latest = loadPapers().find(p => p.id === paper.id)?.study || current
    const result = applyAnswer(latest, raw, record(model), focus?.id)
    patchPaper(paper.id, { study: result.study })
    setSelected(result.nodeId); setFresh({ node: result.study.nodes.length > latest.nodes.length ? result.nodeId : '', points: new Set(result.added) })
    setQuestion(''); setSelection(null)
  })

  function onSelectText(value: PdfSelection) {
    setSelection(value)
    input.current?.focus()
  }

  const focus = study?.nodes.find(n => n.id === selected)
  const questions = new Map(study?.questions.map((q, i) => [q.id, { n: i + 1, text: q.text }]) || [])
  const canAsk = !busy && (question.trim() || selection)

  return <article class={`study ${showPdf ? 'with-pdf' : ''}`}>
    {showPdf && <PdfPane paperId={paper.id} target={target} onSelect={onSelectText} t={t} />}
    <div class="study-main">
      <div class="review-top">
        <button class="ghost" onClick={onBack}><ArrowLeft size={16} />{t.back}</button>
        <ModeTabs mode="study" t={t} onMode={onMode} />
        <div class="actions">
          <button class="ghost" aria-pressed={showPdf} onClick={() => setShowPdf(v => !v)}><FileText size={15} />{showPdf ? t.study.hidePdf : t.study.showPdf}</button>
          {study && <button class="ghost" onClick={() => { void navigator.clipboard.writeText(studyToMarkdown(paper.title, study, t.study.kinds)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? t.copied : t.study.copy}</button>}
          {study && <button class={`ghost ${confirming ? 'danger confirming' : ''}`} disabled={Boolean(busy)} onClick={() => confirming ? void build() : setConfirming(true)} onBlur={() => setConfirming(false)}><RotateCw size={15} />{confirming ? t.study.confirmRebuild : t.study.rebuild}</button>}
        </div>
      </div>
      <h1 class="study-title">{paper.title}</h1>

      {error && <p class="error-text" role="alert">{t.errors[error] || t.errors.UNKNOWN}</p>}

      {!study ? <section class="study-intro">
        <Sparkles size={26} strokeWidth={1.5} />
        <p>{t.study.lead}</p>
        {scanned ? <button class="primary" disabled={Boolean(busy)} onClick={() => void build()}>
          {busy ? <><span class="spinner" />{t.study.building}</> : t.study.build}
        </button> : <p class="muted">{t.study.notReady}</p>}
        {busy && <p class="muted small">{t.study.thinking(busy.chars)}</p>}
      </section> : <>
        {study.thesis && <p class="thesis"><strong>{t.study.thesis}</strong>{study.thesis}</p>}
        <StoryGraph nodes={study.nodes} edges={study.edges} selected={selected} fresh={fresh.node} kinds={t.study.kinds} onSelect={setSelected} />

        {focus && <section class={`focus k-${focus.kind}`}>
          <small>{t.study.kinds[focus.kind]}</small>
          <h2>{focus.label}</h2>
          <p>{focus.summary}</p>
          {focus.pages.length > 0 && <p class="pages">{focus.pages.map(page => <button key={page} class="page-ref" onClick={() => jump(page)}>p.{page}</button>)}</p>}
        </section>}

        <section class="tree" ref={treeRef} aria-label={t.study.tree}>
          <h2>{t.study.tree} <span class="muted small">{t.study.asked(study.questions.length)}</span></h2>
          <ul class="tree-root">
            {study.nodes.map(node => <li key={node.id} data-node={node.id} class={node.id === selected ? 'current' : ''}>
              <button class={`node-head k-${node.kind}`} onClick={() => setSelected(node.id)}><i />{node.label}<small>{t.study.kinds[node.kind]}</small></button>
              {(study.tree[node.id] || []).length > 0 && <Points points={study.tree[node.id]!} fresh={fresh.points} questions={questions} t={t} onPage={jump} />}
            </li>)}
          </ul>
        </section>

        <form class="ask" onSubmit={e => { e.preventDefault(); if (canAsk) void ask() }}>
          {study.followUps.length > 0 && !busy && <div class="follow-ups" aria-label={t.study.followUps}>
            {study.followUps.map(item => <button type="button" key={item} onClick={() => void ask(item)}>{item}</button>)}
          </div>}
          {selection && <div class="selection-chip">
            <span><strong>{t.study.selection}{selection.page ? ` p.${selection.page}` : ''}:</strong> “{selection.text.length > 140 ? selection.text.slice(0, 140) + '…' : selection.text}”</span>
            <button type="button" class="icon" aria-label={t.close} onClick={() => setSelection(null)}><X size={14} /></button>
          </div>}
          <div class="ask-row">
            <textarea ref={input} rows={2} value={question} disabled={Boolean(busy)}
              placeholder={focus ? t.study.askAbout(focus.label) : t.study.askPlaceholder} aria-label={t.study.ask}
              onInput={e => setQuestion(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (canAsk) void ask() } }} />
            <button class="primary send" type="submit" disabled={!canAsk} aria-label={t.study.ask} title={t.study.ask}>{busy ? <span class="spinner" /> : <Send size={16} />}</button>
          </div>
          {busy && <p class="muted small">{t.study.thinking(busy.chars)}</p>}
        </form>
      </>}
    </div>
  </article>
}
