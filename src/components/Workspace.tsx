import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ChevronDown, ChevronRight, GripVertical, X } from 'lucide-preact'
import { MAX_COLUMNS, movePanel, setCollapsed, setHidden, type DropTarget, type PanelId, type StudyLayout } from '../lib/layout'

export interface PanelDef { title: string; body: ComponentChildren }
interface Labels { collapse: string; expand: string; hide: string; dragHint: string }

const MIN_W = 220, MIN_H = 90
const wide = () => typeof matchMedia === 'undefined' || matchMedia('(min-width: 960px)').matches

interface Drag { id: PanelId; x: number; y: number; target: DropTarget | null; box: { left: number; top: number; width: number; height: number } | null }

/**
 * Tiled panels: drag a header onto another panel (upper/lower half stacks, left/right edge makes a new
 * column), drag the gaps to resize, double-click a gap to even it out. On narrow screens the panels simply
 * stack in reading order.
 */
export function Workspace({ layout, onLayout, panels, labels }: { layout: StudyLayout; onLayout: (layout: StudyLayout) => void; panels: Record<PanelId, PanelDef>; labels: Labels }) {
  const root = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const latest = useRef(layout)
  latest.current = layout

  // Fill the window below the toolbar exactly, so the page itself never scrolls on wide screens.
  const fit = () => {
    const el = root.current
    if (el) setHeight(wide() ? Math.max(360, Math.floor(innerHeight - (el.getBoundingClientRect().top + scrollY) - 12)) : null)
  }
  // Every render: a note appearing in the toolbar above moves the workspace down.
  useLayoutEffect(fit)
  useLayoutEffect(() => {
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  function hitTest(x: number, y: number, dragged: PanelId): Pick<Drag, 'target' | 'box'> {
    const base = root.current!.getBoundingClientRect()
    for (const el of root.current!.querySelectorAll<HTMLElement>('[data-panel]')) {
      const r = el.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const ref = el.dataset.panel as PanelId
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
      const box = (left: number, top: number, width: number, height: number) => ({ left: left - base.left, top: top - base.top, width, height })
      // Edges split off a new column; the rest stacks above or below.
      if ((fx < 0.22 || fx > 0.78) && (latest.current.cols.length < MAX_COLUMNS || isAlone(dragged))) {
        const side = fx < 0.22 ? 'left' as const : 'right' as const
        const target: DropTarget = { kind: 'column', ref, side }
        if (movePanel(latest.current, dragged, target) === latest.current) return { target: null, box: null }
        return { target, box: box(side === 'left' ? r.left : r.left + r.width / 2, r.top, r.width / 2, r.height) }
      }
      if (ref === dragged) return { target: null, box: null }
      const where = fy < 0.5 ? 'before' as const : 'after' as const
      return { target: { kind: 'stack', ref, where }, box: box(r.left, where === 'before' ? r.top : r.top + r.height / 2, r.width, r.height / 2) }
    }
    return { target: null, box: null }
  }
  const isAlone = (id: PanelId) => latest.current.cols.some(col => col.panels.length === 1 && col.panels[0]!.id === id)

  function startDrag(e: PointerEvent, id: PanelId) {
    if (e.button !== 0 || !wide() || (e.target as HTMLElement).closest('button, select, input, textarea, a')) return
    const sx = e.clientX, sy = e.clientY
    let started = false
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      started = true
      ev.preventDefault()
      setDrag({ id, x: ev.clientX, y: ev.clientY, ...hitTest(ev.clientX, ev.clientY, id) })
    }
    const end = (ev: PointerEvent) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
      if (!started) return
      const { target } = ev.type === 'pointerup' ? hitTest(ev.clientX, ev.clientY, id) : { target: null }
      if (target) onLayout(movePanel(latest.current, id, target))
      setDrag(null)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
  }

  /** Drags the gap after column `c` (axis x) or after panel `p` in column `c` (axis y). */
  function startResize(e: PointerEvent, c: number, p: number | null) {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    const a = handle.previousElementSibling as HTMLElement, b = handle.nextElementSibling as HTMLElement
    const vertical = p !== null
    const size = (el: HTMLElement) => vertical ? el.getBoundingClientRect().height : el.getBoundingClientRect().width
    const pa = size(a), pb = size(b), start = vertical ? e.clientY : e.clientX
    const weights = () => {
      const l = latest.current
      return vertical ? [l.cols[c]!.panels[p!]!.h, l.cols[c]!.panels[p! + 1]!.h] : [l.cols[c]!.w, l.cols[c + 1]!.w]
    }
    const [wa, wb] = weights() as [number, number]
    const min = vertical ? MIN_H : MIN_W
    document.body.classList.add(vertical ? 'resizing-y' : 'resizing-x')
    const move = (ev: PointerEvent) => {
      const delta = Math.max(min - pa, Math.min(pb - min, (vertical ? ev.clientY : ev.clientX) - start))
      const na = (wa + wb) * (pa + delta) / (pa + pb), nb = wa + wb - na
      onLayout(apply(latest.current, c, p, na, nb))
    }
    const end = () => {
      document.body.classList.remove('resizing-x', 'resizing-y')
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', end)
      removeEventListener('pointercancel', end)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', end)
    addEventListener('pointercancel', end)
  }
  function even(c: number, p: number | null) {
    const l = latest.current
    const [wa, wb] = p !== null ? [l.cols[c]!.panels[p]!.h, l.cols[c]!.panels[p + 1]!.h] : [l.cols[c]!.w, l.cols[c + 1]!.w]
    onLayout(apply(l, c, p, (wa + wb) / 2, (wa + wb) / 2))
  }

  return <div ref={root} class={`workspace ${drag ? 'dragging' : ''}`} style={height ? { height: height + 'px' } : undefined}>
    {layout.cols.map((col, c) => [
      c > 0 && <div key={'gx' + c} class="gap gap-x" role="separator" aria-orientation="vertical" onPointerDown={e => startResize(e, c - 1, null)} onDblClick={() => even(c - 1, null)} />,
      <div key={col.panels[0]!.id} class="ws-col" style={{ flex: `${col.w} 1 0` }}>
        {col.panels.map((slot, p) => {
          const def = panels[slot.id]
          const blocked = slot.collapsed || col.panels[p - 1]?.collapsed
          return [
            p > 0 && <div key={'gy' + slot.id} class={`gap gap-y ${blocked ? 'blocked' : ''}`} role="separator" aria-orientation="horizontal"
              onPointerDown={e => { if (!blocked) startResize(e, c, p - 1) }} onDblClick={() => { if (!blocked) even(c, p - 1) }} />,
            <section key={slot.id} data-panel={slot.id} class={`panel panel-${slot.id} ${slot.collapsed ? 'collapsed' : ''} ${drag?.id === slot.id ? 'lifted' : ''}`}
              style={{ flex: slot.collapsed ? 'none' : `${slot.h} 1 0` }} aria-label={def.title}>
              <header class="panel-head" onPointerDown={e => startDrag(e, slot.id)} title={labels.dragHint}>
                <GripVertical size={14} class="grip" />
                <button type="button" class="icon" aria-label={slot.collapsed ? labels.expand : labels.collapse} title={slot.collapsed ? labels.expand : labels.collapse}
                  onClick={() => onLayout(setCollapsed(latest.current, slot.id, !slot.collapsed))}>{slot.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>
                <h2>{def.title}</h2>
                <button type="button" class="icon" aria-label={labels.hide} title={labels.hide} onClick={() => onLayout(setHidden(latest.current, slot.id, true))}><X size={14} /></button>
              </header>
              {!slot.collapsed && <div class="panel-body">{def.body}</div>}
            </section>,
          ]
        })}
      </div>,
    ])}
    {drag?.box && <div class="drop-preview" style={{ left: drag.box.left + 'px', top: drag.box.top + 'px', width: drag.box.width + 'px', height: drag.box.height + 'px' }} />}
    {drag && <div class="drag-ghost" style={{ left: drag.x + 'px', top: drag.y + 'px' }}>{panels[drag.id].title}</div>}
  </div>
}

function apply(layout: StudyLayout, c: number, p: number | null, a: number, b: number): StudyLayout {
  const cols = layout.cols.map(col => ({ ...col, panels: [...col.panels] }))
  if (p === null) { cols[c]!.w = a; cols[c + 1]!.w = b }
  else { cols[c]!.panels[p] = { ...cols[c]!.panels[p]!, h: a }; cols[c]!.panels[p + 1] = { ...cols[c]!.panels[p + 1]!, h: b } }
  return { ...layout, cols }
}
