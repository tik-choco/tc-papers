import { describe, expect, it, vi } from 'vitest'
import { applyAnswer, applyTranslation, askMessage, isStudy, layoutStory, loadStudyLang, outline, parseStory, saveStudyLang, storyPrompt, storyReminder, studyTexts, studyToMarkdown } from './study'
import { COPY } from '../copy'

const story = JSON.stringify({
  thesis: 'Sparse attention makes long documents cheap.',
  nodes: [
    { id: 'p', kind: 'problem', label: 'Attention is quadratic', summary: 'Long inputs blow up memory.', pages: [1], points: [{ text: 'O(n²) memory', page: 1 }] },
    { id: 'm', kind: 'method', label: 'LSH buckets', summary: 'Hash similar tokens together.', pages: [2, 'x'], points: ['bare string bullet'] },
    { id: 'r', kind: 'result', label: '43% less memory', summary: 'Measured on three benchmarks.', pages: [3], points: [] },
    { id: 'l', kind: 'nonsense', label: 'English only', summary: '', pages: [] },
  ],
  edges: [{ from: 'p', to: 'm', label: 'addressed by' }, { from: 'm', to: 'r', label: 'shows' }, { from: 'r', to: 'l', label: 'limited by' }, { from: 'l', to: 'p', label: 'loops' }, { from: 'p', to: 'm' }, { from: 'p', to: 'ghost' }],
  followUps: ['Why LSH?'],
})

describe('parseStory', () => {
  const study = parseStory('```json\n' + story + '\n```', 'model')
  it('renames nodes and keeps only valid, unique edges', () => {
    expect(study.nodes.map(n => n.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(study.nodes[1]!.pages).toEqual([2])
    expect(study.nodes[3]!.kind).toBe('concept')
    expect(study.edges).toHaveLength(4)
    expect(study.edges[0]).toEqual({ from: 'n1', to: 'n2', label: 'addressed by' })
    expect(study.tree.n2![0]!.text).toBe('bare string bullet')
    expect(isStudy(study)).toBe(true)
  })
  it('rejects output without nodes', () => {
    expect(() => parseStory('{"nodes": []}', 'm')).toThrow('AI_INVALID_RESPONSE')
    expect(() => parseStory('not json', 'm')).toThrow('AI_INVALID_RESPONSE')
  })
  it('lists bullet ids in the outline so answers can nest under them', () => {
    const id = study.tree.n1![0]!.id
    expect(outline(study)).toContain(`[#${id}] O(n²) memory (p.1)`)
  })
})

describe('applyAnswer', () => {
  const study = parseStory(story, 'model')
  const q = { text: 'Why?', askedAt: '2026-01-01T00:00:00Z', model: 'm' }
  it('nests under an existing bullet and records the question', () => {
    const parent = study.tree.n1![0]!.id
    const raw = JSON.stringify({ nodeId: 'n1', parentId: '#' + parent, points: [{ text: 'Every token attends to every token', page: 1, children: [{ text: 'n=64k → 4G pairs' }] }], followUps: ['Next?'] })
    const { study: next, nodeId, added } = applyAnswer(study, raw, q)
    expect(nodeId).toBe('n1')
    const nested = next.tree.n1![0]!.children
    expect(nested).toHaveLength(1)
    expect(nested[0]!.q).toBe(next.questions[0]!.id)
    expect(nested[0]!.children[0]!.text).toBe('n=64k → 4G pairs')
    expect(added).toEqual([nested[0]!.id])
    expect(next.followUps).toEqual(['Next?'])
    expect(study.tree.n1![0]!.children).toHaveLength(0) // not mutated
  })
  it('creates a concept node linked to the graph', () => {
    const raw = JSON.stringify({ nodeId: null, newNode: { kind: 'concept', label: 'Locality-sensitive hashing', summary: 'Hashing that keeps neighbours together.', from: 'n2', edgeLabel: 'uses' }, points: [{ text: 'Similar vectors collide', page: 2 }] })
    const { study: next, nodeId } = applyAnswer(study, raw, q, 'n3')
    expect(nodeId).toBe('n5')
    expect(next.nodes.at(-1)).toMatchObject({ id: 'n5', kind: 'concept', pages: [2] })
    expect(next.edges.at(-1)).toEqual({ from: 'n2', to: 'n5', label: 'uses' })
    expect(next.followUps).toEqual(study.followUps)
  })
  it('falls back to the focused node and top level on bad placement', () => {
    const raw = JSON.stringify({ nodeId: 'zzz', parentId: 'missing', points: [{ text: 'Answer' }] })
    const { study: next, nodeId } = applyAnswer(study, raw, q, 'n3')
    expect(nodeId).toBe('n3')
    expect(next.tree.n3!.map(p => p.text)).toEqual(['Answer'])
    expect(() => applyAnswer(study, '{"points": []}', q)).toThrow('AI_INVALID_RESPONSE')
  })
})

describe('layoutStory', () => {
  it('stacks the flow in layers and sets back edges apart', () => {
    const study = parseStory(story, 'model')
    const layout = layoutStory(study.nodes, study.edges)
    expect(layout.nodes.map(n => n.layer)).toEqual([0, 1, 2, 3])
    expect(layout.back.size).toBe(1)
    expect([...layout.back][0]).toMatchObject({ from: 'n4', to: 'n1' })
    expect(layout.nodes[1]!.y).toBeGreaterThan(layout.nodes[0]!.y)
  })
  it('places siblings side by side', () => {
    const nodes = ['a', 'b', 'c'].map(id => ({ id, kind: 'result' as const, label: id, summary: '', pages: [] }))
    const layout = layoutStory(nodes, [{ from: 'a', to: 'b', label: '' }, { from: 'a', to: 'c', label: '' }])
    expect(layout.nodes[1]!.y).toBe(layout.nodes[2]!.y)
    expect(layout.nodes[1]!.x).toBeLessThan(layout.nodes[2]!.x)
    expect(layout.nodes[0]!.x).toBe((layout.nodes[1]!.x + layout.nodes[2]!.x) / 2)
  })
})

describe('output language', () => {
  it('states the language in the system prompt and again after the paper', () => {
    expect(storyPrompt('ja')).toContain('in Japanese, even when the paper is written in another language')
    expect(storyReminder('zh-Hans')).toContain('Simplified Chinese')
    const study = parseStory(story, 'm')
    expect(askMessage(study, 'Why?', undefined, undefined, 'ko').trimEnd()).toMatch(/Korean[\s\S]*"followUps": string\[\]\}$/)
  })
  it('defaults to the browser language, then remembers the choice', () => {
    localStorage.removeItem('tc-papers:study-lang-v1')
    const spy = vi.spyOn(navigator, 'language', 'get')
    spy.mockReturnValue('zh-TW'); expect(loadStudyLang('en')).toBe('zh-Hant')
    spy.mockReturnValue('zh-CN'); expect(loadStudyLang('en')).toBe('zh-Hans')
    spy.mockReturnValue('fr-FR'); expect(loadStudyLang('ja')).toBe('ja')
    saveStudyLang('ko'); expect(loadStudyLang('ja')).toBe('ko')
    spy.mockRestore(); localStorage.removeItem('tc-papers:study-lang-v1')
  })
  it('translates every text in place and keeps ids, structure and untranslated keys', () => {
    const q = { text: 'Why quadratic?', askedAt: '2026-01-01T00:00:00Z', model: 'm' }
    const study = applyAnswer(parseStory(story, 'm'), JSON.stringify({ nodeId: 'n1', points: [{ text: 'Pairs grow as n²', children: ['detail'] }] }), q).study
    const texts = studyTexts(study)
    expect(texts['n1.label']).toBe('Attention is quadratic')
    expect(Object.values(texts)).toContain('detail')
    // Translate everything except the first node's summary, which the model "forgot".
    const reply = Object.fromEntries(Object.entries(texts).filter(([key]) => key !== 'n1.summary').map(([key, value]) => [key, '訳:' + value]))
    const next = applyTranslation(study, JSON.stringify(reply), 'ja')
    expect(next.lang).toBe('ja')
    expect(next.nodes[0]).toMatchObject({ id: 'n1', label: '訳:Attention is quadratic', summary: 'Long inputs blow up memory.' })
    expect(next.tree.n1!.at(-1)!.children[0]!.text).toBe('訳:detail')
    expect(next.tree.n1!.at(-1)!.id).toBe(study.tree.n1!.at(-1)!.id)
    expect(next.questions[0]!.text).toBe('訳:Why quadratic?')
    expect(next.edges.map(e => e.to)).toEqual(study.edges.map(e => e.to))
  })
  it('rejects a reply that is not a translation of these notes', () => {
    expect(() => applyTranslation(parseStory(story, 'm'), '{"summary": "something else"}', 'ja')).toThrow('AI_INVALID_RESPONSE')
  })
})

it('exports the tree as Markdown', () => {
  const md = studyToMarkdown('Paper', parseStory(story, 'm'), COPY.en.study.kinds)
  expect(md).toContain('## Attention is quadratic（Problem）')
  expect(md).toContain('- O(n²) memory (p.1)')
  expect(md).toContain('→ addressed by LSH buckets')
})
