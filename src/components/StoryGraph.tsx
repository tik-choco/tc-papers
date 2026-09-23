import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { StoryEdge, StoryKind, StoryNode } from '../types'
import { GAP_Y, NODE_H, NODE_W, layoutStory } from '../lib/study'

const PAD = 16

/**
 * Scrolls `container` (only it — unlike scrollIntoView, never the page) so `el` is visible. A container that
 * does not scroll is left alone, which is what keeps narrow screens from jumping around.
 */
export function scrollWithin(container: HTMLElement, el: HTMLElement, align: 'start' | 'nearest') {
  const c = container.getBoundingClientRect(), r = el.getBoundingClientRect()
  let top = container.scrollTop, left = container.scrollLeft
  if (container.scrollHeight > container.clientHeight) {
    if (align === 'start' || r.top < c.top) top += r.top - c.top - 8
    else if (r.bottom > c.bottom) top += Math.min(r.bottom - c.bottom + 8, r.top - c.top - 8)
  }
  if (container.scrollWidth > container.clientWidth) {
    if (r.left < c.left) left += r.left - c.left - 8
    else if (r.right > c.right) left += r.right - c.right + 8
  }
  if (top !== container.scrollTop || left !== container.scrollLeft) container.scrollTo({ top, left, behavior: 'smooth' })
}

/** Nodes are HTML buttons over an SVG edge layer: text wraps naturally and every node is keyboard reachable. */
export function StoryGraph({ nodes, edges, selected, fresh, kinds, onSelect }: {
  nodes: StoryNode[]; edges: StoryEdge[]; selected: string; fresh: { nodes: Set<string>; edges: Set<string> }; kinds: Record<StoryKind, string>; onSelect: (id: string) => void
}) {
  const layout = useMemo(() => layoutStory(nodes, edges), [nodes, edges])
  const scroller = useRef<HTMLDivElement>(null)
  // Picking a node from the tree brings it into view inside the graph panel.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('.story-node.selected')
    if (el) scrollWithin(scroller.current!, el, 'nearest')
  }, [selected, layout])
  const at = new Map(layout.nodes.map(n => [n.node.id, n]))
  // Back edges bulge out to the right of the widest row.
  const width = layout.width + PAD * 2 + (layout.back.size ? 48 : 0), height = layout.height + PAD * 2
  return <div class="graph-scroll" ref={scroller}>
    <div class="graph" style={{ width: width + 'px', height: height + 'px' }}>
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" /></marker>
        </defs>
        {edges.map(edge => {
          const a = at.get(edge.from), b = at.get(edge.to)
          if (!a || !b) return null
          const related = edge.from === selected || edge.to === selected
          let d: string, lx: number, ly: number
          if (layout.back.has(edge)) {
            // Back edges loop around the right-hand side so they never cross the main flow.
            const x1 = a.x + NODE_W + PAD, y1 = a.y + NODE_H / 2 + PAD, x2 = b.x + NODE_W + PAD, y2 = b.y + NODE_H / 2 + PAD
            const bulge = Math.max(x1, x2) + 36
            d = `M${x1} ${y1} C${bulge} ${y1} ${bulge} ${y2} ${x2} ${y2}`
            lx = bulge - 6; ly = (y1 + y2) / 2
          } else {
            const x1 = a.x + NODE_W / 2 + PAD, y1 = a.y + NODE_H + PAD, x2 = b.x + NODE_W / 2 + PAD, y2 = b.y + PAD
            const bend = Math.max(GAP_Y * 0.6, (y2 - y1) / 2)
            d = `M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`
            lx = (x1 + x2) / 2; ly = y2 - GAP_Y / 2
          }
          return <g key={edge.from + edge.to} class={`edge ${related ? 'related' : ''} ${layout.back.has(edge) ? 'back' : ''} ${fresh.edges.has(edge.from + '>' + edge.to) ? 'fresh' : ''}`}>
            <path d={d} marker-end="url(#arrow)" />
            {edge.label && <text x={lx} y={ly} text-anchor="middle" dominant-baseline="middle">{edge.label}</text>}
          </g>
        })}
      </svg>
      {layout.nodes.map(({ node, x, y }) => <button key={node.id} type="button"
        class={`story-node k-${node.kind} ${node.id === selected ? 'selected' : ''} ${fresh.nodes.has(node.id) ? 'fresh' : ''}`}
        style={{ left: x + PAD + 'px', top: y + PAD + 'px', width: NODE_W + 'px', height: NODE_H + 'px' }}
        aria-pressed={node.id === selected} title={node.summary} onClick={() => onSelect(node.id)}>
        <small>{kinds[node.kind]}</small>
        <span>{node.label}</span>
      </button>)}
    </div>
  </div>
}
