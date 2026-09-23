import { describe, expect, it } from 'vitest'
import { hasMath, splitMath } from './math'

describe('splitMath', () => {
  it('finds inline and display TeX in prose', () => {
    expect(splitMath('Loss $\\mathcal{L}$ is minimised: $$\\sum_i \\ell_i$$ done')).toEqual([
      { text: 'Loss ' }, { tex: '\\mathcal{L}', display: false }, { text: ' is minimised: ' }, { tex: '\\sum_i \\ell_i', display: true }, { text: ' done' },
    ])
    expect(splitMath('\\(x^2\\) and \\[y\\]')).toEqual([{ tex: 'x^2', display: false }, { text: ' and ' }, { tex: 'y', display: true }])
  })
  it('leaves prices, escaped dollars and unclosed delimiters as text', () => {
    expect(splitMath('costs $5 and $10 per run')).toEqual([{ text: 'costs $5 and $10 per run' }])
    expect(splitMath('a \\$ sign and $ x')).toEqual([{ text: 'a $ sign and $ x' }])
    expect(splitMath('open $x never closed')).toEqual([{ text: 'open $x never closed' }])
  })
  it('skips KaTeX for plain text', () => {
    expect(hasMath('O(n²) memory')).toBe(false)
    expect(hasMath('$n^2$')).toBe(true)
  })
})
