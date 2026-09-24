import { describe, expect, it, vi } from 'vitest'
import { ancestorsOf, applyAnswer, applyTidy, applyTranslation, askMessage, isStudy, layoutStory, loadStudyLang, outline, parseStory, saveStudyLang, storyPrompt, storyReminder, studyTexts, studyToMarkdown } from './study'
import { COPY } from '../copy'
import type { StudyPoint } from '../types'

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
  it('adds and relabels edges and refines summaries the answer sheds light on', () => {
    const raw = JSON.stringify({
      nodeId: null, newNode: { kind: 'concept', label: 'Hash collisions', summary: 'Different tokens in one bucket.', from: 'n2', edgeLabel: 'relies on' },
      links: [{ from: 'n1', to: 'n3', label: 'quantified by' }, { from: 'n2', to: 'n3', label: 'cuts memory, shown by' }, { from: 'new', to: 'n4', label: 'explains' }, { from: 'ghost', to: 'n1', label: 'x' }],
      refine: [{ id: 'n2', summary: 'Hash similar tokens into buckets and attend only within them.' }, { id: 'new', summary: 'ignored' }],
      points: [{ text: 'Buckets are approximate', page: 2 }],
    })
    const { study: next, changed } = applyAnswer(study, raw, q)
    expect(next.edges.find(e => e.from === 'n1' && e.to === 'n3')?.label).toBe('quantified by')
    expect(next.edges.find(e => e.from === 'n2' && e.to === 'n3')?.label).toBe('cuts memory, shown by')
    expect(next.edges.find(e => e.from === 'n5' && e.to === 'n4')?.label).toBe('explains')
    expect(next.edges).toHaveLength(study.edges.length + 3)
    expect(next.nodes[1]!.summary).toBe('Hash similar tokens into buckets and attend only within them.')
    expect(next.nodes.at(-1)!.summary).toBe('Different tokens in one bucket.')
    expect(changed).toEqual({ nodes: ['n2'], edges: ['n1>n3', 'n2>n3', 'n5>n4'] })
    expect(study.nodes[1]!.summary).toBe('Hash similar tokens together.') // not mutated
  })
  it('falls back to the focused node and top level on bad placement', () => {
    const raw = JSON.stringify({ nodeId: 'zzz', parentId: 'missing', points: [{ text: 'Answer' }] })
    const { study: next, nodeId } = applyAnswer(study, raw, q, 'n3')
    expect(nodeId).toBe('n3')
    expect(next.tree.n3!.map(p => p.text)).toEqual(['Answer'])
    expect(() => applyAnswer(study, '{"points": []}', q)).toThrow('AI_INVALID_RESPONSE')
  })
})

describe('applyTidy', () => {
  const q = { text: 'Why?', askedAt: '2026-01-01T00:00:00Z', model: 'm' }
  // n1: [O(n²) memory, Quadratic memory, Pairs grow as n² > [detail]], plus a duplicate concept node n5/n6.
  let grown = parseStory(story, 'm')
  for (const raw of [
    { nodeId: 'n1', points: [{ text: 'Quadratic memory', children: [{ text: 'n=64k → 4G pairs' }] }] },
    { nodeId: 'n1', points: [{ text: 'Pairs grow as n²', children: ['detail'] }] },
    { newNode: { kind: 'concept', label: 'LSH', summary: 'Hashing.', from: 'n2' }, points: [{ text: 'Buckets' }] },
    { newNode: { kind: 'concept', label: 'Locality hashing', summary: 'Same thing.', from: 'n3' }, points: [{ text: 'Similar vectors collide' }] },
  ]) grown = applyAnswer(grown, JSON.stringify(raw), q).study
  const [a, b, c] = grown.tree.n1!
  const texts = (points: typeof grown.tree.n1) => points!.map(p => p.text)

  it('merges duplicate bullets and keeps their children', () => {
    const { study, ops, points } = applyTidy(grown, JSON.stringify({ merge: [{ keep: '#' + a!.id, drop: [b!.id], text: 'Memory grows as O(n²)' }] }))
    expect(texts(study.tree.n1)).toEqual(['Memory grows as O(n²)', 'Pairs grow as n²'])
    expect(study.tree.n1![0]!.children.map(p => p.text)).toEqual(['n=64k → 4G pairs'])
    expect(study.tree.n1![0]!.q).toBe(b!.q)
    expect(ops).toBe(1); expect(points).toEqual([a!.id])
    expect(grown.tree.n1).toHaveLength(3) // not mutated
  })
  it('merges duplicate nodes and rewires edges and questions', () => {
    const { study, nodes } = applyTidy(grown, JSON.stringify({ mergeNodes: [{ keep: 'n5', drop: '[n6]', summary: '' }] }))
    expect(study.nodes.map(n => n.id)).not.toContain('n6')
    expect(texts(study.tree.n5)).toEqual(['Buckets', 'Similar vectors collide'])
    expect(study.tree.n6).toBeUndefined()
    expect(study.edges.some(e => e.from === 'n6' || e.to === 'n6')).toBe(false)
    expect(study.edges).toContainEqual(expect.objectContaining({ from: 'n3', to: 'n5' }))
    expect(study.questions.at(-1)!.nodeId).toBe('n5')
    expect(nodes).toEqual(['n5'])
  })
  it('groups, moves and reorders bullets', () => {
    const { study } = applyTidy(grown, JSON.stringify({
      group: [{ nodeId: 'n1', parentId: null, text: 'Cost', ids: [a!.id, c!.id] }],
      move: [{ id: b!.id, nodeId: 'n3', parentId: null }],
      order: [{ nodeId: 'n1', parentId: null, ids: [] }],
    }))
    expect(texts(study.tree.n1)).toEqual(['Cost'])
    expect(texts(study.tree.n1![0]!.children)).toEqual(['O(n²) memory', 'Pairs grow as n²'])
    expect(texts(study.tree.n3)).toEqual(['Quadratic memory'])
    const reordered = applyTidy(grown, JSON.stringify({ order: [{ nodeId: 'n1', ids: [c!.id, a!.id] }] })).study
    expect(texts(reordered.tree.n1)).toEqual(['Pairs grow as n²', 'O(n²) memory', 'Quadratic memory'])
  })
  it('skips unsafe operations and never loses text', () => {
    const detail = c!.children[0]!.id
    const { study, ops } = applyTidy(grown, JSON.stringify({
      merge: [{ keep: detail, drop: [c!.id] }, { keep: 'ghost', drop: [a!.id] }],
      move: [{ id: c!.id, nodeId: 'n1', parentId: detail }, { id: a!.id, nodeId: 'zzz' }],
      mergeNodes: [{ keep: 'n1', drop: 'n1' }],
    }))
    expect(ops).toBe(0)
    expect(study.tree).toEqual(grown.tree)
    expect(() => applyTidy(grown, '{"summary": "looks tidy"}')).toThrow('AI_INVALID_RESPONSE')
    expect(applyTidy(grown, '{"result": {"merge": []}}').ops).toBe(0)
  })
  it('folds identical siblings and lifts bullets deeper than three levels', () => {
    const pt = (id: string, children: StudyPoint[] = []): StudyPoint => ({ id, text: id, page: null, children })
    const deep = applyTidy({ ...grown, tree: { ...grown.tree, n4: [pt('1', [pt('2', [pt('3', [pt('4', [pt('5')])])])])] } }, '{"move": []}')
    expect(deep.study.tree.n4).toEqual([pt('1', [pt('2', [pt('3'), pt('4'), pt('5')])])])
    const twins = applyTidy({ ...grown, tree: { ...grown.tree, n3: [{ id: 'x', text: 'Same.', page: 2, children: [] }, { id: 'y', text: 'same', page: null, children: [{ id: 'z', text: 'kid', page: null, children: [] }] }] } }, '{"merge": []}')
    expect(twins.study.tree.n3).toEqual([{ id: 'x', text: 'Same.', page: 2, children: [{ id: 'z', text: 'kid', page: null, children: [] }] }])
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

it('finds the node and bullets that contain a point', () => {
  const q = { text: 'Why?', askedAt: '2026-01-01T00:00:00Z', model: 'm' }
  const study = applyAnswer(parseStory(story, 'm'), JSON.stringify({ nodeId: 'n1', points: [{ text: 'Pairs grow as n²', children: ['detail'] }] }), q).study
  const parent = study.tree.n1!.at(-1)!, child = parent.children[0]!
  expect([...ancestorsOf(study, [child.id])]).toEqual(['n1', parent.id])
  expect([...ancestorsOf(study, [parent.id])]).toEqual(['n1'])
  expect(ancestorsOf(study, ['missing']).size).toBe(0)
})
