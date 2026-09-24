import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Languages, LayoutGrid, Lightbulb, ListTree, Plus, RotateCw, Send, Sparkles, Undo2, X } from 'lucide-preact'
import type { Paper, Study, StudyPoint } from '../types'
import type { Copy as CopyText, Locale } from '../copy'
import { chatJson } from '../lib/ai'
import { getPdf } from '../lib/pdf'
import { loadPapers, patchPaper } from '../lib/store'
import { ANSWER_SCHEMA, STORY_SCHEMA, STUDY_LANGS, TIDY_SCHEMA, TRANSLATION_SCHEMA, ancestorsOf, applyAnswer, applyTidy, applyTranslation, askMessage, askPrompt, loadCollapsed, loadStudyLang, saveCollapsed, parseStory, saveStudyLang, storyPrompt, storyReminder, studyTexts, studyToMarkdown, tidyMessage, tidyPrompt, translatePrompt, type StudyLang } from '../lib/study'
import { StoryGraph, scrollWithin } from './StoryGraph'
import { Workspace, type PanelDef } from './Workspace'
import { defaultLayout, loadLayout, reveal, saveLayout, type PanelId, type StudyLayout } from '../lib/layout'
import { PdfPane, type PdfSelection, type PdfTarget } from './PdfPane'
import { MathText } from './MathText'

export type Mode = 'review' | 'study'

export function ModeTabs({ mode, t, onMode }: { mode: Mode; t: CopyText; onMode: (mode: Mode) => void }) {
  return <div class="mode-tabs" role="tablist">
    {(['review', 'study'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? 'active' : ''} onClick={() => onMode(m)}>
      {m === 'study' && <Lightbulb size={14} />}{m === 'study' ? t.study.tab : t.study.reviewTab}
    </button>)}
  </div>
}

/** Opens or closes a branch of the tree. Shown only where there is something to hide. */
function Twisty({ open, t, onToggle }: { open: boolean; t: CopyText; onToggle: () => void }) {
  const label = open ? t.study.panelLabels.collapse : t.study.panelLabels.expand
  return <button type="button" class="twisty" aria-expanded={open} aria-label={label} title={label} onClick={onToggle}>
    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
  </button>
}

type Fold = { collapsed: Set<string>; onToggle: (id: string) => void }

function Points({ points, fresh, questions, fold, t, onPage }: { points: StudyPoint[]; fresh: Set<string>; questions: Map<string, { n: number; text: string }>; fold: Fold; t: CopyText; onPage: (page: number) => void }) {
  return <ul>
    {points.map((p, i) => {
      // One badge per answer: the bullets that follow from the same question go without.
      const q = p.q && p.q !== points[i - 1]?.q ? questions.get(p.q) : undefined
      const branch = p.children.length > 0, open = branch && !fold.collapsed.has(p.id)
      return <li key={p.id} class={`${fresh.has(p.id) ? 'fresh' : ''} ${branch ? 'branch' : ''}`}>
        {branch && <Twisty open={open} t={t} onToggle={() => fold.onToggle(p.id)} />}
        <span class="pt">
          {q && <span class="q-badge" title={`${t.study.questionBadge}: ${q.text}`}>Q{q.n}</span>}
          <MathText text={p.text} />
          {p.page && <button class="page-ref" onClick={() => onPage(p.page!)}>p.{p.page}</button>}
          {branch && !open && <button type="button" class="fold-count" onClick={() => fold.onToggle(p.id)}>+{p.children.length}</button>}
        </span>
        {open && <Points points={p.children} fresh={fresh} questions={questions} fold={fold} t={t} onPage={onPage} />}
      </li>
    })}
  </ul>
}

type Job = 'build' | 'ask' | 'translate' | 'tidy'

const noneFresh = () => ({ nodes: new Set<string>(), edges: new Set<string>(), points: new Set<string>() })

export function StudyView({ paper, t, locale, toolbarSlot, onBack, onMode }: { paper: Paper; t: CopyText; locale: Locale; toolbarSlot?: HTMLElement | null; onBack: () => void; onMode: (mode: Mode) => void }) {
  const study = paper.study
  const [selected, setSelected] = useState(study?.nodes[0]?.id || '')
  const [busy, setBusy] = useState<{ chars: number; job: Job } | null>(null)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [fresh, setFresh] = useState(noneFresh)
  const [target, setTarget] = useState<PdfTarget | null>(null)
  const [layout, setLayout] = useState(loadLayout)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lang, setLang] = useState(() => loadStudyLang(locale))
  /** The last tidy and the study before it, for undo. Any later change to the study drops it. */
  const [tidied, setTidied] = useState<{ before: Study; ops: number } | null>(null)
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(paper.id))
  const input = useRef<HTMLTextAreaElement>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLElement>(null)
  const [graphVisible, setGraphVisible] = useState(true)
  const scanned = Boolean(paper.scan) && !['queued', 'scanning'].includes(paper.state)

  useEffect(() => { if (study && !study.nodes.some(n => n.id === selected)) setSelected(study.nodes[0]!.id) }, [study, selected])
  // The tree panel follows the selected node and newly added answers. Only that panel scrolls, never the page,
  // so on a phone (where panels stack and nothing scrolls on its own) choosing a node leaves the view alone.
  useEffect(() => {
    const body = treeRef.current?.closest<HTMLElement>('.panel-body'), section = treeRef.current?.querySelector<HTMLElement>(`[data-node="${selected}"]`)
    if (body && section) scrollWithin(body, section, 'start')
  }, [selected])
  useEffect(() => {
    const body = treeRef.current?.closest<HTMLElement>('.panel-body'), added = treeRef.current?.querySelector<HTMLElement>('li.fresh')
    if (body && added) scrollWithin(body, added, 'nearest')
  }, [fresh])
  // On a phone the graph can be far above; a button in the question box brings it back.
  useEffect(() => {
    const el = graphRef.current
    if (!el) return
    // "Visible" means enough of it to pick a node from, not a sliver at the top edge of the screen.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setGraphVisible(entry.intersectionRect.height >= Math.min(160, entry.boundingClientRect.height * 0.9))
    }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) })
    observer.observe(el)
    return () => observer.disconnect()
  }, [Boolean(study)])

  function onLayout(next: StudyLayout) {
    setLayout(next)
    saveLayout(next)
  }

  function changeCollapsed(next: Set<string>) {
    setCollapsed(next)
    saveCollapsed(paper.id, next)
  }
  const fold: Fold = { collapsed, onToggle: id => { const next = new Set(collapsed); if (!next.delete(id)) next.add(id); changeCollapsed(next) } }

  /** Highlights what changed, opening any collapsed branch that hides it. */
  function showFresh(next: ReturnType<typeof noneFresh>, updated: Study) {
    setFresh(next)
    const hiding = [...ancestorsOf(updated, next.points)].filter(id => collapsed.has(id))
    if (hiding.length) changeCollapsed(new Set([...collapsed].filter(id => !hiding.includes(id))))
  }

  function jump(page: number) {
    const next = reveal(layout, 'pdf')
    if (next !== layout) onLayout(next)
    setTarget({ page, nonce: Date.now() })
  }

  async function paperText() {
    const stored = await getPdf(paper.id)
    if (!stored) throw new Error('PDF_MISSING')
    if (!stored.text.replace(/\[Page \d+\]|\s/g, '')) throw new Error('AI_NO_TEXT')
    return stored.text
  }

  async function run(name: Job, job: (onText: (full: string) => void) => Promise<void>) {
    if (busy) return
    setBusy({ chars: 0, job: name }); setError(''); setTidied(null)
    try { await job(full => setBusy({ chars: full.length, job: name })) }
    catch (e) { setError(e instanceof Error ? e.message : 'UNKNOWN') }
    finally { setBusy(null) }
  }

  const build = () => run('build', async onText => {
    const text = await paperText()
    const next = await chatJson('study', [{ role: 'system', content: storyPrompt(lang) }, { role: 'user', content: 'Paper text:\n' + text + '\n\n' + storyReminder(lang) }], STORY_SCHEMA, parseStory, onText)
    patchPaper(paper.id, { study: { ...next, lang } })
    setSelected(next.nodes[0]!.id); setFresh(noneFresh()); setConfirming(false)
  })

  const ask = (preset?: string) => run('ask', async onText => {
    const current = loadPapers().find(p => p.id === paper.id)?.study
    const text = (preset ?? question).trim() || (selection ? t.study.explainSelection : '')
    if (!current || !text) return
    const focus = current.nodes.find(n => n.id === selected)
    const paperBody = await paperText()
    const record = (model: string) => ({ text, askedAt: new Date().toISOString(), model, ...(selection ? { selection: selection.text.slice(0, 500) } : {}) })
    // Parsing against the current tree validates the reply (and triggers the repair retry if needed).
    const { raw, model } = await chatJson('study', [
      { role: 'system', content: askPrompt(lang) },
      // Paper first so the long, unchanging prefix can be cached by the provider between questions.
      { role: 'user', content: 'Paper text:\n' + paperBody + '\n\n' + askMessage(current, text, focus, selection || undefined, lang) },
    ], ANSWER_SCHEMA, (raw, model) => { applyAnswer(current, raw, record(model), focus?.id); return { raw, model } }, onText)
    // Re-read: another tab may have added to the tree while the model was answering.
    const latest = loadPapers().find(p => p.id === paper.id)?.study || current
    const result = applyAnswer(latest, raw, record(model), focus?.id)
    patchPaper(paper.id, { study: result.study })
    setSelected(result.nodeId); // Highlights what the answer changed in the graph: a new node, new or relabelled edges, refined summaries.
    const nodes = new Set(result.changed.nodes)
    if (result.study.nodes.length > latest.nodes.length) nodes.add(result.nodeId)
    showFresh({ nodes, edges: new Set(result.changed.edges), points: new Set(result.added) }, result.study)
    setQuestion(''); setSelection(null)
  })

  // Translates the graph, tree and questions in place, so switching language never costs the reader's notes.
  const translate = () => run('translate', async onText => {
    const current = loadPapers().find(p => p.id === paper.id)?.study
    if (!current) return
    const { raw } = await chatJson('study', [{ role: 'system', content: translatePrompt(lang) }, { role: 'user', content: JSON.stringify(studyTexts(current)) }],
      TRANSLATION_SCHEMA, raw => { applyTranslation(current, raw, lang); return { raw } }, onText)
    const latest = loadPapers().find(p => p.id === paper.id)?.study || current
    patchPaper(paper.id, { study: applyTranslation(latest, raw, lang) })
  })

  // Merges duplicates and fixes placement and order. The model only returns edits to existing ids, so the paper is not sent.
  const tidy = () => run('tidy', async onText => {
    const current = loadPapers().find(p => p.id === paper.id)?.study
    if (!current) return
    const { raw } = await chatJson('study', [{ role: 'system', content: tidyPrompt(lang) }, { role: 'user', content: tidyMessage(current, lang) }],
      TIDY_SCHEMA, raw => { applyTidy(current, raw); return { raw } }, onText)
    const latest = loadPapers().find(p => p.id === paper.id)?.study || current
    const result = applyTidy(latest, raw)
    if (result.ops) patchPaper(paper.id, { study: result.study })
    setTidied({ before: latest, ops: result.ops })
    showFresh({ nodes: new Set(result.nodes), edges: new Set(), points: new Set(result.points) }, result.study)
  })

  function undoTidy() {
    if (!tidied) return
    patchPaper(paper.id, { study: tidied.before })
    setTidied(null); setFresh(noneFresh())
  }

  function chooseLang(value: StudyLang) {
    setLang(value)
    saveStudyLang(value)
  }

  function onSelectText(value: PdfSelection) {
    setSelection(value)
    input.current?.focus()
  }

  const focus = study?.nodes.find(n => n.id === selected)
  const questions = new Map(study?.questions.map((q, i) => [q.id, { n: i + 1, text: q.text }]) || [])
  const canAsk = !busy && (question.trim() || selection)
  // Studies made before the language setting were written in the UI language.
  const storyLang = study?.lang ?? locale
  const pending = <p class="muted panel-empty">{t.study.afterBuild}</p>

  const panels: Record<PanelId, PanelDef> = {
    pdf: { title: t.study.panels.pdf, body: <PdfPane paperId={paper.id} target={target} onSelect={onSelectText} t={t} /> },
    graph: {
      title: t.study.panels.graph,
      body: !study ? <section class="study-intro">
        <Sparkles size={26} strokeWidth={1.5} />
        <p>{t.study.lead}</p>
        {scanned ? <button class="primary" disabled={Boolean(busy)} onClick={() => void build()}>
          {busy ? <><span class="spinner" />{t.study.building}</> : t.study.build}
        </button> : <p class="muted">{t.study.notReady}</p>}
        {busy && <p class="muted small">{t.study.thinking(busy.chars)}</p>}
      </section> : <div class="graph-panel" ref={graphRef}>
        {study.thesis && <p class="thesis"><strong>{t.study.thesis}</strong><MathText text={study.thesis} /></p>}
        <StoryGraph nodes={study.nodes} edges={study.edges} selected={selected} fresh={fresh} kinds={t.study.kinds} onSelect={setSelected} />
      </div>,
    },
    focus: {
      title: t.study.panels.focus,
      body: study && focus ? <section class={`focus k-${focus.kind}`}>
        <small>{t.study.kinds[focus.kind]}</small>
        <h2><MathText text={focus.label} /></h2>
        <p><MathText text={focus.summary} /></p>
        {focus.pages.length > 0 && <p class="pages">{focus.pages.map(page => <button key={page} class="page-ref" onClick={() => jump(page)}>p.{page}</button>)}</p>}
        {(study.tree[focus.id] || []).length > 0 && <div class="focus-points"><Points points={study.tree[focus.id]!} fresh={fresh.points} questions={questions} fold={fold} t={t} onPage={jump} /></div>}
      </section> : pending,
    },
    tree: {
      title: study ? `${t.study.tree} · ${t.study.asked(study.questions.length)}` : t.study.tree,
      body: study ? <section class="tree" ref={treeRef}>
        <ul class="tree-root">
          {study.nodes.map(node => {
            const points = study.tree[node.id] || [], open = !collapsed.has(node.id)
            return <li key={node.id} data-node={node.id} class={node.id === selected ? 'current' : ''}>
              <div class="node-row">
                {points.length > 0 ? <Twisty open={open} t={t} onToggle={() => fold.onToggle(node.id)} /> : <span class="twisty" aria-hidden="true" />}
                <button class={`node-head k-${node.kind}`} title={t.study.kinds[node.kind]} onClick={() => setSelected(node.id)}><i /><MathText text={node.label} /></button>
                {points.length > 0 && !open && <button type="button" class="fold-count" onClick={() => fold.onToggle(node.id)}>+{points.length}</button>}
              </div>
              {points.length > 0 && open && <Points points={points} fresh={fresh.points} questions={questions} fold={fold} t={t} onPage={jump} />}
            </li>
          })}
        </ul>
      </section> : pending,
    },
    ask: {
      title: t.study.panels.ask,
      body: study ? <form class="ask" onSubmit={e => { e.preventDefault(); if (canAsk) void ask() }}>
        {!graphVisible && <button type="button" class="to-graph" onClick={() => graphRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}><ArrowUp size={14} />{t.study.toGraph}</button>}
        {study.followUps.length > 0 && !busy && <div class="follow-ups" aria-label={t.study.followUps}>
          {study.followUps.map(item => <button type="button" key={item} onClick={() => void ask(item)}><MathText text={item} /></button>)}
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
      </form> : pending,
    },
  }

  // One row: back, title, hidden-panel chips, mode tabs, actions. Labels shrink to icons on narrower screens.
  const toolbar = <div class="study-bar">
    <button class="ghost" onClick={onBack} title={t.back}><ArrowLeft size={16} /><span class="lbl">{t.back}</span></button>
    <h1 class="study-title" title={paper.title}>{paper.title}</h1>
    {layout.hidden.length > 0 && <div class="hidden-panels">
      {layout.hidden.map(id => <button key={id} class="chip" onClick={() => onLayout(reveal(layout, id))} title={t.study.showPanel}><Plus size={13} />{panels[id].title.split(' · ')[0]}</button>)}
    </div>}
    <ModeTabs mode="study" t={t} onMode={onMode} />
    <div class="actions">
      <label class="ghost lang-select" title={t.study.language}>
        <Languages size={15} />
        <select aria-label={t.study.language} value={lang} onChange={e => chooseLang(e.currentTarget.value as StudyLang)}>
          {(Object.keys(STUDY_LANGS) as StudyLang[]).map(key => <option key={key} value={key}>{STUDY_LANGS[key].label}</option>)}
        </select>
      </label>
      {study && <button class="ghost" title={t.study.copy} onClick={() => { void navigator.clipboard.writeText(studyToMarkdown(paper.title, study, t.study.kinds)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? <Check size={15} /> : <Copy size={15} />}<span class="lbl">{copied ? t.copied : t.study.copy}</span></button>}
      {study && <button class="ghost" title={t.study.tidyHint} disabled={Boolean(busy)} onClick={() => void tidy()}>{busy?.job === 'tidy' ? <span class="spinner" /> : <ListTree size={15} />}<span class="lbl">{busy?.job === 'tidy' ? t.study.tidying : t.study.tidy}</span></button>}
      {study && <button class={`ghost ${confirming ? 'danger confirming' : ''}`} title={t.study.rebuild} disabled={Boolean(busy)} onClick={() => confirming ? void build() : setConfirming(true)} onBlur={() => setConfirming(false)}><RotateCw size={15} />{confirming ? t.study.confirmRebuild : <span class="lbl">{t.study.rebuild}</span>}</button>}
      <button class="ghost" onClick={() => onLayout(defaultLayout())} title={t.study.resetLayoutHint} aria-label={t.study.resetLayout}><LayoutGrid size={15} /><span class="lbl">{t.study.resetLayout}</span></button>
    </div>
  </div>

  return <article class="study">
    {toolbarSlot ? createPortal(toolbar, toolbarSlot) : toolbar}
    {error && <p class="error-text" role="alert">{t.errors[error] || t.errors.UNKNOWN}</p>}
    {study && storyLang !== lang && <div class="lang-note">
      <span>{t.study.langMismatch(STUDY_LANGS[storyLang as StudyLang]?.label || storyLang, STUDY_LANGS[lang].label)}</span>
      <button class="ghost" disabled={Boolean(busy)} onClick={() => void translate()}><Languages size={15} />{t.study.translate(STUDY_LANGS[lang].label)}</button>
    </div>}
    {tidied && <div class="lang-note" role="status">
      <span>{tidied.ops ? t.study.tidied(tidied.ops) : t.study.tidyNone}</span>
      <span>
        {tidied.ops > 0 && <button class="ghost" onClick={undoTidy}><Undo2 size={15} />{t.study.undo}</button>}
        <button class="icon" aria-label={t.close} onClick={() => setTidied(null)}><X size={14} /></button>
      </span>
    </div>}
    <Workspace layout={layout} onLayout={onLayout} panels={panels} labels={t.study.panelLabels} />
  </article>
}
