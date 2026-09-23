export type MathSegment = { text: string } | { tex: string; display: boolean }

/** Cheap check so plain text never loads KaTeX. */
export const hasMath = (text: string) => /\$|\\\(|\\\[/.test(text)

/**
 * Splits model prose into text and TeX: `$$…$$`, `\[…\]` (display) and `$…$`, `\(…\)` (inline).
 * A `$` only opens inline math when not followed by a space and closes when not preceded by one nor
 * followed by a digit (the pandoc rule), so prices like "$5 and $10" stay text. `\$` is a literal dollar.
 */
export function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = []
  let plain = '', i = 0
  const flush = () => { if (plain) out.push({ text: plain }); plain = '' }
  const take = (close: string, from: number, display: boolean, valid: (end: number) => boolean = () => true) => {
    for (let end = text.indexOf(close, from); end !== -1; end = text.indexOf(close, end + 1)) {
      if (text[end - 1] === '\\' && close[0] === '$') continue
      if (!valid(end)) continue
      const tex = text.slice(from, end).trim()
      if (!tex) return false
      flush(); out.push({ tex, display }); i = end + close.length
      return true
    }
    return false
  }
  while (i < text.length) {
    const c = text[i]!, next = text[i + 1]
    if (c === '\\' && next === '$') { plain += '$'; i += 2; continue }
    if (c === '\\' && next === '(' && take('\\)', i + 2, false)) continue
    if (c === '\\' && next === '[' && take('\\]', i + 2, true)) continue
    if (c === '$' && next === '$' && take('$$', i + 2, true)) continue
    if (c === '$' && next !== '$' && next !== undefined && !/\s/.test(next)
      && take('$', i + 1, false, end => !/\s/.test(text[end - 1]!) && !/\d/.test(text[end + 1] ?? ''))) continue
    plain += c; i++
  }
  flush()
  return out
}

/** Prompt rule shared by every mode that shows model prose through MathText. */
export const MATH_RULE = 'Write math in prose fields as TeX: $…$ inline, $$…$$ for a displayed equation (e.g. "$O(n^2)$", "$\\\\mathcal{L} = \\\\sum_i \\\\ell_i$"); in the JSON string every TeX backslash is escaped as \\\\. Keep short labels plain text without TeX.'
