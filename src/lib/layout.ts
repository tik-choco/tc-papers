// Tiled panel layout for understanding mode: columns side by side, panels stacked inside each column.
// Sizes are flex weights (only their ratios matter), so the layout scales with the window.

export const PANEL_IDS = ['pdf', 'graph', 'focus', 'tree', 'ask'] as const
export type PanelId = typeof PANEL_IDS[number]

export interface PanelSlot { id: PanelId; h: number; collapsed?: boolean }
export interface Column { w: number; panels: PanelSlot[] }
export interface StudyLayout { v: 1; cols: Column[]; hidden: PanelId[] }

/** Where a dragged panel lands, relative to the panel it was dropped on. */
export type DropTarget =
  | { kind: 'stack'; ref: PanelId; where: 'before' | 'after' }
  | { kind: 'column'; ref: PanelId; side: 'left' | 'right' }

export const MAX_COLUMNS = 4
const KEY = 'tc-papers:study-layout-v1'

export function defaultLayout(): StudyLayout {
  return {
    v: 1, hidden: [],
    cols: [
      { w: 38, panels: [{ id: 'pdf', h: 1 }] },
      { w: 32, panels: [{ id: 'graph', h: 62 }, { id: 'focus', h: 38 }] },
      { w: 30, panels: [{ id: 'tree', h: 72 }, { id: 'ask', h: 28 }] },
    ],
  }
}

const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

/** Keeps every panel exactly once (placed or hidden); anything unknown or missing falls back safely. */
export function normalizeLayout(value: unknown): StudyLayout {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (raw.v !== 1 || !Array.isArray(raw.cols)) return defaultLayout()
  const seen = new Set<PanelId>()
  const take = (id: unknown): id is PanelId => PANEL_IDS.includes(id as PanelId) && !seen.has(id as PanelId) && Boolean(seen.add(id as PanelId))
  const cols = raw.cols.slice(0, MAX_COLUMNS).flatMap(col => {
    const c = col && typeof col === 'object' ? col as Record<string, unknown> : {}
    const panels = (Array.isArray(c.panels) ? c.panels : []).flatMap(p => {
      const s = p && typeof p === 'object' ? p as Record<string, unknown> : {}
      return take(s.id) ? [{ id: s.id, h: positive(s.h, 1), ...(s.collapsed === true ? { collapsed: true } : {}) }] : []
    })
    return panels.length ? [{ w: positive(c.w, 1), panels }] : []
  })
  const hidden = (Array.isArray(raw.hidden) ? raw.hidden : []).filter(take)
  const missing = PANEL_IDS.filter(id => !seen.has(id))
  if (!cols.length) return defaultLayout()
  if (missing.length) cols[cols.length - 1]!.panels.push(...missing.map(id => ({ id, h: 1 })))
  return { v: 1, cols, hidden }
}

export function loadLayout(): StudyLayout {
  try { return normalizeLayout(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return defaultLayout() }
}
export function saveLayout(layout: StudyLayout) { try { localStorage.setItem(KEY, JSON.stringify(layout)) } catch { /* session only */ } }

function locate(layout: StudyLayout, id: PanelId) {
  for (let c = 0; c < layout.cols.length; c++) {
    const p = layout.cols[c]!.panels.findIndex(s => s.id === id)
    if (p !== -1) return { c, p }
  }
  return null
}

const without = (layout: StudyLayout, id: PanelId): Column[] =>
  layout.cols.map(col => ({ ...col, panels: col.panels.filter(p => p.id !== id) })).filter(col => col.panels.length)

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 1

export function movePanel(layout: StudyLayout, id: PanelId, target: DropTarget): StudyLayout {
  const from = locate(layout, id)
  if (!from) return layout
  const slot = layout.cols[from.c]!.panels[from.p]!
  if (target.kind === 'stack') {
    if (target.ref === id) return layout
    const cols = without(layout, id)
    const at = cols.findIndex(col => col.panels.some(p => p.id === target.ref))
    if (at === -1) return layout
    const col = cols[at]!
    const index = col.panels.findIndex(p => p.id === target.ref) + (target.where === 'after' ? 1 : 0)
    const panels = [...col.panels]
    panels.splice(index, 0, { ...slot, h: average(col.panels.map(p => p.h)) })
    cols[at] = { ...col, panels }
    return { ...layout, cols }
  }
  // A new column beside the column holding `ref`, taking half of that column's width.
  const refAt = locate(layout, target.ref)
  if (!refAt) return layout
  const alone = layout.cols[from.c]!.panels.length === 1
  if (target.ref === id && alone) return layout
  if (layout.cols.length >= MAX_COLUMNS && !alone) return layout
  const refColumn = layout.cols[refAt.c]!
  const cols = without(layout, id)
  const at = cols.findIndex(col => col.panels.some(p => refColumn.panels.some(r => r.id !== id && r.id === p.id)))
  if (at === -1) return layout
  cols[at] = { ...cols[at]!, w: cols[at]!.w / 2 }
  cols.splice(target.side === 'left' ? at : at + 1, 0, { w: cols[at]!.w, panels: [{ ...slot, h: 1 }] })
  return { ...layout, cols }
}

export function setHidden(layout: StudyLayout, id: PanelId, hide: boolean): StudyLayout {
  if (hide === layout.hidden.includes(id)) return layout
  if (hide) return { ...layout, cols: without(layout, id), hidden: [...layout.hidden, id] }
  const hidden = layout.hidden.filter(h => h !== id)
  // Bring it back at a sensible place: the PDF as the first column, anything else under the last column.
  if (id === 'pdf' && layout.cols.length < MAX_COLUMNS) return { ...layout, hidden, cols: [{ w: 38, panels: [{ id, h: 1 }] }, ...layout.cols] }
  if (!layout.cols.length) return { ...layout, hidden, cols: [{ w: 1, panels: [{ id, h: 1 }] }] }
  const cols = [...layout.cols]
  const last = cols[cols.length - 1]!
  cols[cols.length - 1] = { ...last, panels: [...last.panels, { id, h: average(last.panels.map(p => p.h)) }] }
  return { ...layout, hidden, cols }
}

export function setCollapsed(layout: StudyLayout, id: PanelId, collapsed: boolean): StudyLayout {
  return { ...layout, cols: layout.cols.map(col => ({ ...col, panels: col.panels.map(p => p.id === id ? { ...p, collapsed: collapsed || undefined } : p) })) }
}

/** Makes a panel visible and expanded, e.g. before jumping to a page in the PDF. */
export function reveal(layout: StudyLayout, id: PanelId): StudyLayout {
  return setCollapsed(setHidden(layout, id, false), id, false)
}
