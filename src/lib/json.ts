/**
 * Tolerant extraction of the one JSON object a model was asked for. Models often wrap it in reasoning
 * (<think>…</think>), code fences or prose, leave trailing commas or raw newlines inside strings, or stop
 * mid-object when they hit the provider's output limit. Each of those is repaired here instead of failing.
 * Throws AI_INVALID_RESPONSE only when no object can be recovered at all.
 */
export function extractJson(raw: string): Record<string, unknown> {
  let text = raw.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
  // An unclosed reasoning block (output cut off inside it, or a template that drops the opening tag).
  text = text.replace(/^[\s\S]*?<\/(think|thinking|reasoning)>/i, '')
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(text)
  if (fenced && fenced[1]!.includes('{')) text = fenced[1]!
  // A few candidates are enough: prose before the object rarely holds more than a brace or two.
  for (let start = text.indexOf('{'), tries = 0; start !== -1 && tries < 20; start = text.indexOf('{', start + 1), tries++) {
    const candidate = scanObject(text, start)
    const repaired = repair(candidate)
    // Curly quotes are only swapped as a last resort: inside Japanese prose they are legitimate text.
    for (const attempt of [candidate.text, repaired, repaired.replace(/[“”]/g, '"')]) {
      try {
        const value: unknown = JSON.parse(attempt)
        if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
      } catch { /* try the next repair or the next '{' */ }
    }
  }
  throw new Error('AI_INVALID_RESPONSE')
}

/** TeX commands that start like a valid JSON escape (\frac reads as form feed + "rac"). */
const TEX_COMMANDS = new Set(('backslash bar beta big bigcap bigcup bigg bigl bigr binom bm bmod boldsymbol bot bullet '
  + 'fbox forall frac frown nabla ne neg neq nexists ngeq ni nleq nmid nolimits nonumber not notin nu '
  + 'rangle rbrace rbrack rceil rfloor rho right rightarrow rm rvert tan tanh tau tbinom text textbf textit textrm textsf '
  + 'textstyle texttt tfrac therefore theta tilde times to top triangle triangleq tt').split(' '))

/**
 * A single backslash in a JSON string that is really TeX the model forgot to escape: an invalid escape
 * (\alpha, \sum, \underline) or a known command. Doubled so the text survives JSON.parse unchanged.
 */
function isTexBackslash(text: string, i: number): boolean {
  const next = text[i + 1] ?? ''
  if (next === 'u') return !/^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))
  if ('bfnrt'.includes(next) && next) return TEX_COMMANDS.has(/^[a-z]+/i.exec(text.slice(i + 1))![0])
  return !'"\\/'.includes(next) || !next
}

interface Scanned { text: string; open: string[]; inString: boolean }

/** Reads one balanced object from `start`, string-aware, so braces in prose after it are ignored. */
function scanObject(text: string, start: number): Scanned {
  const open: string[] = []
  let inString = false, escaped = false, out = ''
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') {
        if (isTexBackslash(text, i)) { out += '\\\\'; continue }
        escaped = true
      }
      else if (c === '"') inString = false
      // Raw control characters are invalid inside JSON strings but common in model output.
      else if (c === '\n') { out += '\\n'; continue }
      else if (c === '\r') continue
      else if (c === '\t') { out += '\\t'; continue }
      out += c
      continue
    }
    out += c
    if (c === '"') inString = true
    else if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']')
    else if (c === '}' || c === ']') { open.pop(); if (!open.length) return { text: out, open, inString: false } }
  }
  return { text: out, open, inString }
}

/** Trailing commas and a cut-off tail: drop the incomplete last member and close what is still open. */
function repair({ text, open, inString }: Scanned): string {
  let s = inString ? text + '"' : text
  if (open.length) {
    // Cut back to the last complete value so a half-written key or number does not break the parse.
    s = s.replace(/,\s*"[^"]*"\s*:\s*"?[^"{}[\],]*$/, '').replace(/,\s*"[^"]*"?\s*$/, '').replace(/[,:]\s*$/, '')
    s += [...open].reverse().join('')
  }
  return s.replace(/,(\s*[}\]])/g, '$1')
}

/** `{"review": {…}}` or `{"result": {…}}` → the inner object, when the expected key is only found one level down. */
export function unwrap(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  if (key in obj) return obj
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && key in value) return value as Record<string, unknown>
  }
  return obj
}
