import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Loaded on demand by MathText, so pages without formulas never pay for KaTeX. */
export const renderTex = (tex: string, display: boolean) =>
  katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml', maxExpand: 200 })
