import { useEffect, useMemo, useState } from 'preact/hooks'
import { ArrowLeft, Check, Copy, ExternalLink, RotateCw, Trash2, X } from 'lucide-preact'
import type { Paper, ReviewResult } from '../types'
import { getPdf } from '../lib/pdf'
import { DECISION_BANDS, scoreReview, type ScoreBreakdown } from '../lib/score'
import type { Copy as CopyText } from '../copy'
import { ProgressView } from './ProgressView'
import { MathText } from './MathText'
import { ModeTabs, type Mode } from './StudyView'

export function ScoreBadge({ score }: { score: ScoreBreakdown }) {
  return <span class={`score-badge d-${score.decision}`}>{score.total}</span>
}

const pct = (value: number) => Math.round(value * 100)
const fmt = (value: number) => value.toFixed(1)

/** The decision band containing the total, with its exclusive upper bound (null for the top band). */
function bandOf(score: ScoreBreakdown) {
  const index = DECISION_BANDS.findIndex(band => band.decision === score.decision)
  return { min: DECISION_BANDS[index]!.min, max: index > 0 ? DECISION_BANDS[index - 1]!.min : null }
}

function capReasons(score: ScoreBreakdown, t: CopyText) {
  return score.caps.map(cap => cap === 'unsound' ? t.capUnsound(fmt(score.criteria.find(c => c.id === 'soundness')!.adjusted)) : t.capFatal)
}

function toMarkdown(paper: Paper, r: ReviewResult, score: ScoreBreakdown, t: CopyText) {
  const list = (items: string[]) => items.map(item => '- ' + item).join('\n')
  const { min, max } = bandOf(score)
  const present = score.structure.filter(s => s.present).length
  return [
    `# ${paper.title}`, '', `**${t.score}: ${score.total}/100 (${t.decisions[score.decision]})** · ${t.confidence} ${pct(score.confidence)}%`, '',
    ...(r.overall ? [`## ${t.overall}`, r.overall, ''] : []),
    `## ${t.grounds}`, '',
    `| ${t.cols.criterion} | ${t.cols.raw} | ${t.cols.verified} | ${t.cols.adjusted} | ${t.cols.weight} | ${t.cols.points} |`, '|---|---|---|---|---|---|',
    ...score.criteria.map(c => `| ${t.criteria[c.id]} | ${c.raw} | ${c.verified}/${c.quotes} | ${fmt(c.adjusted)} | ${pct(c.weight)}% | ${fmt(c.points)} |`),
    `| ${t.structureRow(present, score.structure.length)} | | | | 10% | ${fmt(score.structurePoints)} |`,
    `| **${t.subtotal}** | | | | | **${fmt(score.uncapped)}** |`, '',
    ...capReasons(score, t).map(reason => '- ' + reason),
    '- ' + t.band(score.total, min, max, t.decisions[score.decision]), '',
    ...score.criteria.flatMap(c => r.criteria[c.id].rationale ? [`**${t.criteria[c.id]}**: ${r.criteria[c.id].rationale}`, ''] : []),
    `## ${t.summary}`, r.summary, '', `## ${t.strengths}`, list(r.strengths), '', `## ${t.weaknesses}`, list(r.weaknesses), '',
    ...(r.fatalFlaws.length ? [`## ${t.fatalFlaws}`, list(r.fatalFlaws), ''] : []),
    ...(r.pathToAcceptance?.length ? [`## ${t.pathToAcceptance}`, r.pathToAcceptance.map((s, i) => `${i + 1}. ${s}`).join('\n'), ''] : []),
    ...(r.comments?.length ? [`## ${t.comments}`, r.comments.map(c => `- **[${t.severity[c.severity]}]${c.page ? ` p.${c.page}` : ''}${c.section ? ` ${c.section}` : ''}**: ${c.comment}${c.suggestion ? `\n  - ${t.suggestion}: ${c.suggestion}` : ''}`).join('\n'), ''] : []),
    `## ${t.questions}`, list(r.questions),
  ].join('\n')
}

function Grounds({ score, t }: { score: ScoreBreakdown; t: CopyText }) {
  const { min, max } = bandOf(score)
  const present = score.structure.filter(s => s.present).length
  const f = score.confidenceFactors
  const widths = DECISION_BANDS.map((band, i) => (i ? DECISION_BANDS[i - 1]!.min : 100) - band.min).reverse()
  return <section class="grounds">
    <h2>{t.grounds}</h2>
    <p class="muted">{t.groundsLead}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>{t.cols.criterion}</th><th>{t.cols.raw}</th><th>{t.cols.verified}</th><th>{t.cols.adjusted}</th><th>{t.cols.weight}</th><th>{t.cols.points}</th></tr></thead>
      <tbody>
        {score.criteria.map(c => <tr key={c.id}>
          <td>{t.criteria[c.id]}</td><td>{c.raw}</td>
          <td class={c.quotes && c.verified === c.quotes ? 'ok' : 'ng'}>{c.verified}/{c.quotes}</td>
          <td>{fmt(c.adjusted)}</td><td>{pct(c.weight)}%</td><td>{fmt(c.points)}</td>
        </tr>)}
        <tr><td>{t.structureRow(present, score.structure.length)}</td><td /><td /><td /><td>10%</td><td>{fmt(score.structurePoints)}</td></tr>
      </tbody>
      <tfoot><tr><td>{t.subtotal}</td><td /><td /><td /><td /><td>{fmt(score.uncapped)}</td></tr></tfoot>
    </table></div>
    <ul class="ground-steps">
      {capReasons(score, t).map(reason => <li class="cap-reason">{reason}</li>)}
      <li><strong>{t.finalScore} {score.total}</strong> — {t.band(score.total, min, max, t.decisions[score.decision])}</li>
    </ul>
    <div class="scale" aria-hidden="true">
      {[...DECISION_BANDS].reverse().map((band, i) => <span key={band.decision} class={`d-${band.decision} ${band.decision === score.decision ? 'current' : ''}`} style={{ width: `${widths[i]}%` }} title={t.decisions[band.decision]} />)}
      <i style={{ left: `${score.total}%` }} />
    </div>
    <p class="muted small">{t.adjustNote}</p>
    <p class="muted small">{t.confidence} {pct(score.confidence)}% = {t.confidenceWhy(pct(f.self), pct(0.5 + 0.5 * f.verifiedRatio))}{f.truncated && ' × ' + t.truncatedNote}{f.mostlyOcr && ' × ' + t.ocrNote}</p>
  </section>
}

export function ReviewView({ paper, t, onBack, onMode, onRerun, onRemove }: { paper: Paper; t: CopyText; onBack: () => void; onMode: (mode: Mode) => void; onRerun: () => void; onRemove: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true, objectUrl = ''
    getPdf(paper.id).then(stored => {
      if (!alive || !stored) return
      objectUrl = URL.createObjectURL(stored.blob)
      setUrl(objectUrl); setText(stored.text)
    }).catch(() => {})
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [paper.id, paper.scan?.chars])
  // A new review lands at index 0; go back to it.
  useEffect(() => setVersion(0), [paper.review?.createdAt])
  const reviews = useMemo(() => paper.review ? [paper.review, ...(paper.history || [])] : [], [paper.review, paper.history])
  const r = reviews[version] || reviews[0]
  const score = useMemo(() => r && text !== null ? scoreReview(r, text, paper.scan) : null, [r, text, paper.scan])
  const busy = ['queued', 'scanning', 'reviewing'].includes(paper.state)

  return <article class="review">
    <div class="review-top">
      <button class="ghost" onClick={onBack}><ArrowLeft size={16} />{t.back}</button>
      <ModeTabs mode="review" t={t} onMode={onMode} />
      <div class="actions">
        {url && <a class="ghost" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t.open}</a>}
        {r && score && <button class="ghost" onClick={() => { void navigator.clipboard.writeText(toMarkdown(paper, r, score, t)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? t.copied : t.copyMd}</button>}
        <button class="ghost" disabled={busy} onClick={onRerun}><RotateCw size={15} />{paper.state === 'error' ? t.retry : t.rerun}</button>
        <button class={`ghost danger ${confirming ? 'confirming' : ''}`} onClick={() => confirming ? onRemove() : setConfirming(true)} onBlur={() => setConfirming(false)}><Trash2 size={15} />{confirming ? t.confirmRemove : t.remove}</button>
      </div>
    </div>
    <h1>{paper.title}</h1>
    <p class="muted">{paper.name}{paper.scan && ' · ' + t.pages(paper.scan)}{r && ' · ' + r.model}</p>

    {paper.state === 'error' || paper.error ? <p class="error-text" role="alert">{t.errors[paper.error || 'UNKNOWN'] || t.errors.UNKNOWN}</p> : null}
    {busy && !paper.error && <ProgressView paper={paper} t={t} />}

    {reviews.length > 1 && <label class="history">
      <span class="muted">{t.history}</span>
      <select value={version} onChange={e => setVersion(Number(e.currentTarget.value))}>
        {reviews.map((item, i) => {
          const s = text !== null ? scoreReview(item, text, paper.scan) : null
          return <option key={item.createdAt + i} value={i}>{i === 0 ? t.latest + ' · ' : ''}{new Date(item.createdAt).toLocaleString()} · {item.model}{s ? ` · ${s.total}` : ''}</option>
        })}
      </select>
    </label>}

    {r && score && <>
      <section class="verdict">
        <ScoreBadge score={score} />
        <div>
          <strong>{t.decisions[score.decision]}</strong>
          <span class="muted">{t.confidence} {pct(score.confidence)}%</span>
          {score.caps.map(cap => <span class="cap">{t.caps[cap]}</span>)}
        </div>
      </section>

      {r.overall && <section class="overall"><h2>{t.overall}</h2><p><MathText text={r.overall} /></p></section>}

      <Grounds score={score} t={t} />

      <section class="criteria">
        <h2>{t.rationale}</h2>
        {score.criteria.map(c => {
          const rating = r.criteria[c.id]
          return <details key={c.id} open>
            <summary>
              <span class="c-name">{t.criteria[c.id]} <small>{t.weight} {pct(c.weight)}%</small></span>
              <span class="bar"><span style={{ width: `${(c.adjusted - 1) / 4 * 100}%` }} /></span>
              <span class="c-score">{fmt(c.adjusted)}<small>{c.raw !== c.adjusted ? ` (${c.raw})` : ''}</small></span>
            </summary>
            {rating.rationale && <p><MathText text={rating.rationale} /></p>}
            {rating.evidence.length > 0 && <ul class="evidence">{rating.evidence.map((e, i) => <li key={i} class={c.checks[i] ? 'ok' : 'ng'} title={c.checks[i] ? t.verified : t.unverified}>
              {c.checks[i] ? <Check size={13} /> : <X size={13} />}<q>{e.quote}</q>{e.page && <small> p.{e.page}</small>}
            </li>)}</ul>}
          </details>
        })}
        <p class="formula muted"><strong>{t.howScored}:</strong> {t.formula}</p>
      </section>

      {r.summary && <section><h2>{t.summary}</h2><p><MathText text={r.summary} /></p></section>}
      {r.fatalFlaws.length > 0 && <section class="fatal"><h2>{t.fatalFlaws}</h2><ul>{r.fatalFlaws.map(item => <li><MathText text={item} /></li>)}</ul></section>}
      <div class="two-col">
        {r.strengths.length > 0 && <section><h2>{t.strengths}</h2><ul>{r.strengths.map(item => <li><MathText text={item} /></li>)}</ul></section>}
        {r.weaknesses.length > 0 && <section><h2>{t.weaknesses}</h2><ul>{r.weaknesses.map(item => <li><MathText text={item} /></li>)}</ul></section>}
      </div>
      {r.pathToAcceptance && r.pathToAcceptance.length > 0 && <section class="path"><h2>{t.pathToAcceptance}</h2><ol>{r.pathToAcceptance.map(item => <li><MathText text={item} /></li>)}</ol></section>}
      {r.comments && r.comments.length > 0 && <section><h2>{t.comments}</h2><ul class="comments">
        {r.comments.map((c, i) => <li key={i} class={c.severity}>
          <div class="c-head"><span class="sev">{t.severity[c.severity]}</span>{c.page && <span class="muted">p.{c.page}</span>}{c.section && <span class="muted">{c.section}</span>}</div>
          {c.comment && <p><MathText text={c.comment} /></p>}
          {c.suggestion && <p class="suggestion"><strong>{t.suggestion}:</strong> <MathText text={c.suggestion} /></p>}
        </li>)}
      </ul></section>}
      {r.questions.length > 0 && <section><h2>{t.questions}</h2><ul>{r.questions.map(item => <li><MathText text={item} /></li>)}</ul></section>}
      <section><h2>{t.structure}</h2><ul class="checks">{score.structure.map(s => <li class={s.present ? 'ok' : 'ng'}>{s.present ? <Check size={13} /> : <X size={13} />}{t.structureLabels[s.id]}</li>)}</ul></section>
      <p class="muted small saved">{t.savedNote} {t.historyNote}</p>
    </>}
  </article>
}
