import { describe, expect, it } from 'vitest'
import { defaultLayout, movePanel, normalizeLayout, reveal, setCollapsed, setHidden, type StudyLayout } from './layout'

const ids = (layout: StudyLayout) => layout.cols.map(col => col.panels.map(p => p.id))

describe('movePanel', () => {
  const base = defaultLayout() // [pdf] [graph, focus] [tree, ask]
  it('stacks a panel before or after another', () => {
    expect(ids(movePanel(base, 'ask', { kind: 'stack', ref: 'graph', where: 'before' }))).toEqual([['pdf'], ['ask', 'graph', 'focus'], ['tree']])
    expect(ids(movePanel(base, 'graph', { kind: 'stack', ref: 'focus', where: 'after' }))).toEqual([['pdf'], ['focus', 'graph'], ['tree', 'ask']])
  })
  it('removes a column that becomes empty', () => {
    expect(ids(movePanel(base, 'pdf', { kind: 'stack', ref: 'tree', where: 'after' }))).toEqual([['graph', 'focus'], ['tree', 'pdf', 'ask']])
  })
  it('splits a new column beside the target, halving its width', () => {
    const next = movePanel(base, 'focus', { kind: 'column', ref: 'tree', side: 'right' })
    expect(ids(next)).toEqual([['pdf'], ['graph'], ['tree', 'ask'], ['focus']])
    expect(next.cols[2]!.w).toBe(15)
    expect(next.cols[3]!.w).toBe(15)
    // Out of its own column, to the left.
    expect(ids(movePanel(base, 'ask', { kind: 'column', ref: 'ask', side: 'left' }))).toEqual([['pdf'], ['graph', 'focus'], ['ask'], ['tree']])
  })
  it('ignores moves that change nothing or exceed the column limit', () => {
    expect(movePanel(base, 'pdf', { kind: 'column', ref: 'pdf', side: 'left' })).toBe(base)
    expect(movePanel(base, 'graph', { kind: 'stack', ref: 'graph', where: 'after' })).toBe(base)
    const four = movePanel(base, 'focus', { kind: 'column', ref: 'tree', side: 'right' })
    expect(movePanel(four, 'ask', { kind: 'column', ref: 'pdf', side: 'left' })).toBe(four)
    // Moving the only panel of a column keeps the count, so it is allowed.
    expect(ids(movePanel(four, 'focus', { kind: 'column', ref: 'pdf', side: 'left' }))).toEqual([['focus'], ['pdf'], ['graph'], ['tree', 'ask']])
  })
})

describe('hide, collapse, reveal', () => {
  it('hides and brings panels back', () => {
    const hidden = setHidden(defaultLayout(), 'pdf', true)
    expect(ids(hidden)).toEqual([['graph', 'focus'], ['tree', 'ask']])
    expect(ids(setHidden(hidden, 'pdf', false))[0]).toEqual(['pdf'])
    const noTree = setHidden(defaultLayout(), 'tree', true)
    expect(ids(setHidden(noTree, 'tree', false)).at(-1)).toEqual(['ask', 'tree'])
  })
  it('reveal un-hides and expands', () => {
    const layout = setCollapsed(setHidden(defaultLayout(), 'graph', true), 'pdf', true)
    const next = reveal(reveal(layout, 'pdf'), 'graph')
    expect(next.hidden).toEqual([])
    expect(next.cols[0]!.panels[0]!.collapsed).toBeUndefined()
  })
})

describe('normalizeLayout', () => {
  it('drops duplicates and unknown panels and restores missing ones', () => {
    const layout = normalizeLayout({ v: 1, cols: [{ w: 2, panels: [{ id: 'graph', h: 1 }, { id: 'graph', h: 1 }, { id: 'nope' }] }, { w: -1, panels: [] }], hidden: ['pdf', 'pdf', 'x'] })
    expect(ids(layout)).toEqual([['graph', 'focus', 'tree', 'ask']])
    expect(layout.hidden).toEqual(['pdf'])
  })
  it('falls back to the default for garbage', () => {
    expect(normalizeLayout(null)).toEqual(defaultLayout())
    expect(normalizeLayout({ v: 2, cols: [] })).toEqual(defaultLayout())
  })
})
