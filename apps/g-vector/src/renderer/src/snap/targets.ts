/**
 * Builds the set of coordinates a drag may latch onto.
 *
 * Rebuilt when the document or the selection changes — NOT on every pointer
 * move. A move then costs one pass over a flat array of numbers, which is what
 * keeps the guides feeling instant rather than arriving a frame late.
 */
import { worldBounds } from '../doc/bounds'
import type { Rect, Vec } from '../doc/geom'
import { isShown, type Doc, type NodeId } from '../doc/types'
import type { SnapCandidate, SnapTargets } from './types'

export interface CollectOptions {
  /** Usually the selection: a node must not snap to itself. */
  exclude?: readonly NodeId[]
  /** Include the artboard's edges and centre lines. */
  artboard?: boolean
  /** Extra points, in document space — path anchors while the pen is active. */
  points?: readonly Vec[]
}

export function collectTargets(doc: Doc, options: CollectOptions = {}): SnapTargets {
  const excluded = new Set(options.exclude ?? [])
  const x: SnapCandidate[] = []
  const y: SnapCandidate[] = []
  const boxes: { id: NodeId; rect: Rect }[] = []

  for (const node of doc.nodes) {
    if (excluded.has(node.id) || !isShown(doc, node)) continue
    const r = worldBounds(node)
    boxes.push({ id: node.id, rect: r })
    pushBoxCandidates(x, y, r, node.id)
  }

  const artboard: Rect = { x: 0, y: 0, width: doc.artboard.width, height: doc.artboard.height }
  if (options.artboard !== false) {
    pushBoxCandidates(x, y, artboard, undefined)
  }

  for (const p of options.points ?? []) {
    x.push({ value: p.x, kind: 'anchor', from: p.y, to: p.y })
    y.push({ value: p.y, kind: 'anchor', from: p.x, to: p.x })
  }

  return { x, y, boxes, artboard }
}

function pushBoxCandidates(
  x: SnapCandidate[],
  y: SnapCandidate[],
  r: Rect,
  sourceId: NodeId | undefined,
): void {
  const right = r.x + r.width
  const bottom = r.y + r.height
  // For a vertical guide the span is the box's vertical extent, and the other
  // way round — that is what makes the line touch the object it came from.
  x.push(
    { value: r.x, kind: 'edge', from: r.y, to: bottom, sourceId },
    { value: r.x + r.width / 2, kind: 'center', from: r.y, to: bottom, sourceId },
    { value: right, kind: 'edge', from: r.y, to: bottom, sourceId },
  )
  y.push(
    { value: r.y, kind: 'edge', from: r.x, to: right, sourceId },
    { value: r.y + r.height / 2, kind: 'center', from: r.x, to: right, sourceId },
    { value: bottom, kind: 'edge', from: r.x, to: right, sourceId },
  )
}
