import { describe, expect, it } from 'vitest'
import { extractJson, unwrap } from './json'

describe('extractJson', () => {
  it('reads plain and fenced JSON', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 })
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nHope this helps {really}.')).toEqual({ a: 1 })
  })
  it('skips reasoning blocks and braces in surrounding prose', () => {
    expect(extractJson('<think>maybe {"a": 0} or {x}</think>\n{"a": 2}')).toEqual({ a: 2 })
    expect(extractJson('I think {this} matters.\n{"a": 3} and {that}')).toEqual({ a: 3 })
    // Templates that drop the opening tag still end the reasoning with </think>.
    expect(extractJson('reasoning with {braces}</think>{"a": 4}')).toEqual({ a: 4 })
  })
  it('repairs trailing commas and raw newlines inside strings', () => {
    expect(extractJson('{"a": [1, 2,], "b": "line one\nline two",}')).toEqual({ a: [1, 2], b: 'line one\nline two' })
  })
  it('closes output cut off by a token limit, dropping the incomplete tail', () => {
    expect(extractJson('{"summary": "done", "criteria": {"soundness": {"score": 4, "evidence": [{"quote": "abc", "pa')).toEqual({ summary: 'done', criteria: { soundness: { score: 4, evidence: [{ quote: 'abc' }] } } })
    expect(extractJson('{"summary": "half a sente')).toEqual({ summary: 'half a sente' })
    expect(extractJson('{"a": 1, "b": [')).toEqual({ a: 1, b: [] })
  })
  it('keeps curly quotes inside strings and only swaps them when they are the delimiters', () => {
    expect(extractJson('{"a": "彼は“速い”と言った"}')).toEqual({ a: '彼は“速い”と言った' })
    expect(extractJson('{“a”: 1}')).toEqual({ a: 1 })
  })
  it('throws when nothing can be recovered', () => {
    expect(() => extractJson('Sorry, I cannot help with that.')).toThrow('AI_INVALID_RESPONSE')
    expect(() => extractJson('')).toThrow('AI_INVALID_RESPONSE')
  })
})

it('unwraps a single wrapper object', () => {
  expect(unwrap({ review: { criteria: {} } }, 'criteria')).toEqual({ criteria: {} })
  expect(unwrap({ criteria: {}, other: { criteria: 1 } }, 'criteria')).toEqual({ criteria: {}, other: { criteria: 1 } })
})
