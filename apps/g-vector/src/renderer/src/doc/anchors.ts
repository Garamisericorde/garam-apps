/**
 * Anchor-level edits.
 *
 * Anchors live in the node's LOCAL space, so every world-space gesture has to
 * come through `worldToLocalDelta` first. The transforms are rigid, so that is
 * only an un-rotation — but skipping it makes a rotated path move sideways when
 * you drag an anchor down, which is the sort of bug that takes an hour to see.
 */
import { applyMatrix, invertMatrix, lenVec, type Vec } from './geom'
import { insertAnchor, type Anchor, type SubPath } from './path'
import { refitCurvature } from './curvature'
import { toPathNode } from './defaults'
import { isVectorNode, type Doc, type NodeId, type PathNode, type SceneNode } from './types'

export interface AnchorRef {
  nodeId: NodeId
  subpath: number
  index: number
}

export type HandleSide = 'in' | 'out'

export function sameAnchor(a: AnchorRef, b: AnchorRef): boolean {
  return a.nodeId === b.nodeId && a.subpath === b.subpath && a.index === b.index
}

export function pathNodeOf(doc: Doc, id: NodeId): PathNode | null {
  const node = doc.nodes.find((n) => n.id === id)
  return node && node.type === 'path' ? node : null
}

export function anchorAt(doc: Doc, ref: AnchorRef): Anchor | null {
  return pathNodeOf(doc, ref.nodeId)?.subpaths[ref.subpath]?.anchors[ref.index] ?? null
}

/** An anchor's position in document space. */
export function anchorWorld(node: SceneNode, anchor: Anchor): Vec {
  return applyMatrix(node.transform, anchor.p)
}

/** A handle's tip in document space. */
export function handleWorld(node: SceneNode, anchor: Anchor, side: HandleSide): Vec {
  const h = anchor[side]
  return applyMatrix(node.transform, { x: anchor.p.x + h.x, y: anchor.p.y + h.y })
}

/** A document-space point in the node's own space. */
export function worldToLocalPoint(node: SceneNode, p: Vec): Vec {
  return applyMatrix(invertMatrix(node.transform), p)
}

/**
 * Turns a document-space movement into a local-space one.
 *
 * Only the rotation of the transform matters for a delta; the translation
 * cancels, which is why this applies the inverse to a vector rather than to a
 * point.
 */
export function worldToLocalDelta(node: SceneNode, delta: Vec): Vec {
  const inverse = invertMatrix(node.transform)
  return { x: inverse[0] * delta.x + inverse[2] * delta.y, y: inverse[1] * delta.x + inverse[3] * delta.y }
}

/**
 * Whether the two handles are collinear, which is what "smooth" means here.
 *
 * Dragging one handle of a smooth anchor should swing the other; dragging one
 * of an anchor whose handles were deliberately broken must not silently
 * re-align them.
 */
export function isSmooth(anchor: Anchor): boolean {
  const a = anchor.in
  const b = anchor.out
  if (lenVec(a) < 1e-6 || lenVec(b) < 1e-6) return false
  const cross = a.x * b.y - a.y * b.x
  const scale = lenVec(a) * lenVec(b)
  return Math.abs(cross) / scale < 0.02
}

/* ── Editing ─────────────────────────────────────────────────────────────── */

function mapPath(doc: Doc, id: NodeId, fn: (subpaths: SubPath[]) => SubPath[]): Doc {
  let changed = false
  const nodes = doc.nodes.map((node) => {
    if (node.id !== id || node.type !== 'path' || node.locked) return node
    const subpaths = fn(node.subpaths)
    if (subpaths === node.subpaths) return node
    changed = true
    return { ...node, subpaths }
  })
  return changed ? { ...doc, nodes } : doc
}

function mapSubPath(doc: Doc, id: NodeId, index: number, fn: (sp: SubPath) => SubPath): Doc {
  return mapPath(doc, id, (subpaths) => {
    if (index < 0 || index >= subpaths.length) return subpaths
    const next = subpaths.map((sp, i) => (i === index ? fn(sp) : sp))
    return next[index] === subpaths[index] ? subpaths : next
  })
}

/**
 * Replaces a primitive with the equivalent editable path.
 *
 * A rectangle has no anchors to drag until it becomes one. Illustrator makes
 * you find "Object > Expand"; here it happens the moment a path tool touches
 * the shape, keeping the id so selection and undo carry across unbroken.
 */
export function ensurePath(doc: Doc, id: NodeId): Doc {
  const node = doc.nodes.find((n) => n.id === id)
  if (!node || node.type === 'path' || node.locked || !isVectorNode(node)) return doc
  const converted = toPathNode(node)
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? converted : n)) }
}

/** Moves a set of anchors by one document-space delta. */
export function moveAnchors(doc: Doc, refs: readonly AnchorRef[], delta: Vec): Doc {
  if (refs.length === 0 || (delta.x === 0 && delta.y === 0)) return doc

  const byNode = new Map<NodeId, AnchorRef[]>()
  for (const ref of refs) {
    const list = byNode.get(ref.nodeId)
    if (list) list.push(ref)
    else byNode.set(ref.nodeId, [ref])
  }

  let next = doc
  for (const [id, group] of byNode) {
    const node = next.nodes.find((n) => n.id === id)
    if (!node) continue
    const local = worldToLocalDelta(node, delta)
    next = mapPath(next, id, (subpaths) =>
      subpaths.map((sp, s) => {
        const moving = group.filter((ref) => ref.subpath === s).map((ref) => ref.index)
        if (moving.length === 0) return sp
        const wanted = new Set(moving)
        return {
          closed: sp.closed,
          // Handles are stored relative to the point, so they come along for
          // free — which is the whole reason they are stored that way.
          anchors: sp.anchors.map((anchor, i) =>
            wanted.has(i)
              ? { ...anchor, p: { x: anchor.p.x + local.x, y: anchor.p.y + local.y } }
              : anchor,
          ),
        }
      }),
    )
  }
  return next
}

export interface SetHandleOptions {
  /** Swing the opposite handle to stay collinear. Alt turns this off. */
  mirror: boolean
  /**
   * Make the opposite handle the exact negation of this one.
   *
   * What a pen drag does when it pulls a handle out of a point that had none:
   * there is no existing length on the far side to preserve, so the pair starts
   * out symmetric and can be broken later.
   */
  symmetric?: boolean
}

/** Sets one handle, in the node's local space. */
export function setHandle(
  doc: Doc,
  ref: AnchorRef,
  side: HandleSide,
  vector: Vec,
  options: SetHandleOptions,
): Doc {
  return mapSubPath(doc, ref.nodeId, ref.subpath, (sp) => {
    const anchor = sp.anchors[ref.index]
    if (!anchor) return sp
    const other: HandleSide = side === 'in' ? 'out' : 'in'
    const updated: Anchor = { ...anchor, [side]: vector }

    // The opposite handle keeps its own LENGTH and takes the new direction.
    // Mirroring the length as well is the other common choice and it is wrong:
    // it silently undoes any asymmetry the user set up on the far side.
    const otherLength = lenVec(anchor[other])
    if (options.symmetric) {
      updated[other] = { x: -vector.x, y: -vector.y }
    } else if (options.mirror && isSmooth(anchor) && otherLength > 1e-6) {
      const length = lenVec(vector)
      updated[other] =
        length < 1e-6
          ? anchor[other]
          : { x: (-vector.x / length) * otherLength, y: (-vector.y / length) * otherLength }
    }

    const anchors = sp.anchors.map((a, i) => (i === ref.index ? updated : a))
    return { closed: sp.closed, anchors }
  })
}

/**
 * Deletes anchors, dropping any subpath left with nothing to draw and any node
 * left with no subpaths.
 */
export function removeAnchors(doc: Doc, refs: readonly AnchorRef[]): Doc {
  if (refs.length === 0) return doc
  const ids = new Set(refs.map((r) => r.nodeId))
  let next = doc

  for (const id of ids) {
    next = mapPath(next, id, (subpaths) => {
      const kept = subpaths.map((sp, s) => {
        const doomed = new Set(
          refs.filter((r) => r.nodeId === id && r.subpath === s).map((r) => r.index),
        )
        if (doomed.size === 0) return sp
        return { closed: sp.closed, anchors: sp.anchors.filter((_, i) => !doomed.has(i)) }
      })
      return kept.filter((sp) => sp.anchors.length >= 2)
    })
  }

  return {
    ...next,
    nodes: next.nodes.filter((n) => n.type !== 'path' || n.subpaths.length > 0),
  }
}

/** Splits a segment, leaving the curve exactly where it was. */
export function insertAnchorAt(
  doc: Doc,
  id: NodeId,
  subpath: number,
  segment: number,
  t: number,
): Doc {
  return mapSubPath(doc, id, subpath, (sp) => insertAnchor(sp, segment, t))
}

/** Adds an anchor to the end of an open subpath — the pen's normal step. */
export function appendAnchor(doc: Doc, id: NodeId, subpath: number, anchor: Anchor): Doc {
  return mapSubPath(doc, id, subpath, (sp) => ({
    closed: sp.closed,
    anchors: [...sp.anchors, anchor],
  }))
}

/** Replaces one anchor outright — how a pen drag sets the handles it just made. */
export function replaceAnchor(doc: Doc, ref: AnchorRef, anchor: Anchor): Doc {
  return mapSubPath(doc, ref.nodeId, ref.subpath, (sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a, i) => (i === ref.index ? anchor : a)),
  }))
}

export function closeSubPath(doc: Doc, id: NodeId, subpath: number): Doc {
  return mapSubPath(doc, id, subpath, (sp) =>
    sp.closed || sp.anchors.length < 2 ? sp : { closed: true, anchors: sp.anchors },
  )
}

/** Toggles a curvature point between smooth and sharp, then refits around it. */
export function toggleCornerAt(doc: Doc, id: NodeId, subpath: number, index: number): Doc {
  return mapSubPath(doc, id, subpath, (sp) => {
    const anchors = sp.anchors.map((a, i) => (i === index ? { ...a, corner: !a.corner } : a))
    return refitCurvature({ closed: sp.closed, anchors })
  })
}

/** Refits one subpath — run after every curvature edit. */
export function refitSubPath(doc: Doc, id: NodeId, subpath: number): Doc {
  return mapSubPath(doc, id, subpath, refitCurvature)
}
