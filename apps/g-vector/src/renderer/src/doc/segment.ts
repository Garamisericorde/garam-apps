/**
 * The line between two points, as a length and an angle you can type into.
 *
 * A path's bounding box tells you almost nothing about a straight run: a line
 * from one corner to another reports a width, a height and a rotation of zero,
 * none of which is the number anyone wants. The number they want is the angle
 * of the segment itself, and until you can read it you certainly cannot set it.
 */
import { moveAnchors, type AnchorRef } from './anchors'
import { applyMatrix, type Vec } from './geom'
import { segmentCount } from './path'
import type { Doc, NodeId, PathNode } from './types'

export interface SegmentRef {
  nodeId: NodeId
  subpath: number
  /** Index of the anchor the segment leaves from. */
  from: number
  /** Index of the anchor it arrives at — the one an edit moves. */
  to: number
}

export interface SegmentMeasure {
  /** Both ends in document space. */
  from: Vec
  to: Vec
  length: number
  /** Degrees, 0 pointing right and growing clockwise — as everywhere else here. */
  angle: number
}

function pathOf(doc: Doc, id: NodeId): PathNode | null {
  const node = doc.nodes.find((entry) => entry.id === id)
  return node && node.type === 'path' ? node : null
}

export function measureSegment(doc: Doc, ref: SegmentRef): SegmentMeasure | null {
  const node = pathOf(doc, ref.nodeId)
  const anchors = node?.subpaths[ref.subpath]?.anchors
  if (!node || !anchors || !anchors[ref.from] || !anchors[ref.to]) return null

  const from = applyMatrix(node.transform, anchors[ref.from].p)
  const to = applyMatrix(node.transform, anchors[ref.to].p)
  const dx = to.x - from.x
  const dy = to.y - from.y
  return {
    from,
    to,
    length: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  }
}

/**
 * Puts the far end of the segment somewhere, in document space.
 *
 * `from` stays put and `to` moves. Something has to be the pivot — swinging
 * about the midpoint would move a point the user was not talking about — and
 * which one it is comes from the SELECTION ORDER, so it is the user's choice
 * rather than a consequence of the direction the path was drawn in.
 *
 * The moving anchor's handles travel with it unrotated, because a handle is a
 * relative vector: what moved is the point.
 */
function placeFarEnd(doc: Doc, ref: SegmentRef, target: Vec): Doc {
  const measured = measureSegment(doc, ref)
  if (!measured) return doc
  const anchor: AnchorRef = { nodeId: ref.nodeId, subpath: ref.subpath, index: ref.to }
  return moveAnchors(doc, [anchor], {
    x: target.x - measured.to.x,
    y: target.y - measured.to.y,
  })
}

export function setSegmentAngle(doc: Doc, ref: SegmentRef, degrees: number): Doc {
  const measured = measureSegment(doc, ref)
  if (!measured || measured.length < 1e-9) return doc
  const radians = (degrees * Math.PI) / 180
  return placeFarEnd(doc, ref, {
    x: measured.from.x + Math.cos(radians) * measured.length,
    y: measured.from.y + Math.sin(radians) * measured.length,
  })
}

export function setSegmentLength(doc: Doc, ref: SegmentRef, length: number): Doc {
  const measured = measureSegment(doc, ref)
  if (!measured || measured.length < 1e-9 || length <= 0) return doc
  const scale = length / measured.length
  return placeFarEnd(doc, ref, {
    x: measured.from.x + (measured.to.x - measured.from.x) * scale,
    y: measured.from.y + (measured.to.y - measured.from.y) * scale,
  })
}

/* ── Finding one to edit ─────────────────────────────────────────────────── */

/**
 * The segment two selected anchors describe, if they are next to each other.
 *
 * The ORDER of the two is kept: the first is the pivot, the second is the end
 * that moves. Deriving it from path order instead would mean the answer to
 * "which point does this field move" depends on the direction the path happened
 * to be drawn in — invisible, arbitrary, and the reason to hand it to the user.
 */
export function segmentFromAnchors(doc: Doc, refs: readonly AnchorRef[]): SegmentRef | null {
  if (refs.length !== 2) return null
  const [a, b] = refs
  if (a.nodeId !== b.nodeId || a.subpath !== b.subpath) return null

  const sp = pathOf(doc, a.nodeId)?.subpaths[a.subpath]
  if (!sp) return null

  const count = sp.anchors.length
  const wraps =
    sp.closed &&
    ((a.index === 0 && b.index === count - 1) || (a.index === count - 1 && b.index === 0))
  // A closed path joins its last anchor back to its first, and that join is a
  // segment like any other.
  if (Math.abs(a.index - b.index) !== 1 && !wraps) return null

  return { nodeId: a.nodeId, subpath: a.subpath, from: a.index, to: b.index }
}

/**
 * The one segment a node consists of, when it consists of exactly one.
 *
 * A plain two-point line is the case where the angle matters most and where
 * selecting the two ends first would be pure ceremony: there is nothing else it
 * could mean.
 */
export function loneSegment(doc: Doc, ids: readonly NodeId[]): SegmentRef | null {
  if (ids.length !== 1) return null
  const node = pathOf(doc, ids[0])
  if (!node || node.subpaths.length !== 1) return null
  const sp = node.subpaths[0]
  if (segmentCount(sp) !== 1) return null
  return { nodeId: node.id, subpath: 0, from: 0, to: 1 }
}
