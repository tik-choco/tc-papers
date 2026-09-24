import { useEffect, useMemo, useState } from 'preact/hooks'
import { hasMath, splitMath } from '../lib/math'

type Render = (tex: string, display: boolean) => string
let render: Render | undefined
let loading: Promise<Render> | undefined
const load = () => loading ??= import('../lib/katexRender').then(m => render = m.renderTex)

/** Prose from the model with its `$…$` TeX rendered by KaTeX; the raw TeX shows until KaTeX has loaded. */
export function MathText({ text }: { text: string }) {
  const math = hasMath(text)
  const [ready, setReady] = useState(Boolean(render))
  useEffect(() => {
    if (!math) return
    // Rendered before KaTeX arrived but mounted after: nothing left to wait for.
    if (render) { setReady(true); return }
    let live = true
    void load().then(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [math])
  const segments = useMemo(() => math ? splitMath(text) : null, [text, math])
  if (!segments || segments.every(s => 'text' in s)) return <>{text}</>
  return <>{segments.map((s, i) => 'text' in s ? s.text
    : ready && render ? <span key={i} class={s.display ? 'math display' : 'math'} dangerouslySetInnerHTML={{ __html: render(s.tex, s.display) }} />
    : <code key={i}>{s.tex}</code>)}</>
}
