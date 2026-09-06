/**
 * What a click means to the pen and the curvature tool.
 *
 * Kept out of the canvas component because these are the rules of the tools,
 * not of the pointer: where the click lands in the document, whether it closes
 * the path, whether it starts a handle drag. The canvas decides what was under
 * the cursor; this decides what to do about it.
 */
import {
  appendAnchor,
  closeSubPath,
  pathNodeOf,
  replaceAnchor,
  refitSubPath,
  worldToLocalPoint,
  type AnchorRef,
} from '../doc/anchors'
import { refitCurvature } from '../doc/curvature'
import { createDrawnPath } from '../doc/defaults'
import { applyMatrix, type Vec } from '../doc/geom'
import { corner, segmentCount, segmentCubic, type Cubic } from '../doc/path'
import { addNodes } from '../doc/ops'
import type { Doc, LayerId, NodeId } from '../doc/types'
import type { PenDraft } from '../store/editor'

export interface DrawClickResult {
  doc: Doc
  /** The path still being drawn, or null when this click finished it. */
  draft: PenDraft | null
  selection: NodeId[]
  /**
   * Set when the click should continue into a handle drag — the pen's
   * click-and-pull that turns a corner into a curve.
   */
  handle: { ref: AnchorRef; anchor: Vec } | null
}

export interface DrawClickInput {
  doc: Doc
  /** The layer a newly started path is created on. */
  layer: LayerId
  draft: PenDraft | null
  /** Where the click landed, in document space, already snapped. */
  point: Vec
  /** An anchor of the draft under the cursor, if the click was on one. */
  onAnchor: AnchorRef | null
}

/* ── Pen ─────────────────────────────────────────────────────────────────── */

export function penClick(input: DrawClickInput): DrawClickResult {
  const { doc, draft, point, onAnchor } = input

  if (!draft) return startPath(doc, input.layer, point, false)

  const node = pathNodeOf(doc, draft.nodeId)
  const sp = node?.subpaths[draft.subpath]
  if (!node || !sp) return startPath(doc, input.layer, point, false)

  const last = sp.anchors.length - 1
  if (onAnchor && onAnchor.nodeId === draft.nodeId && onAnchor.subpath === draft.subpath) {
    if (onAnchor.index === 0 && sp.anchors.length >= 2) {
      return {
        doc: closeSubPath(doc, draft.nodeId, draft.subpath),
        draft: null,
        selection: [node.id],
        handle: null,
      }
    }
    if (onAnchor.index === last) {
      /*
       * Clicking the point you just made retracts its outgoing handle, so the
       * next segment leaves in a straight line. It is how you get a sharp
       * corner in the middle of a curve without stopping and starting again.
       */
      const anchor = sp.anchors[last]
      return {
        doc: replaceAnchor(doc, onAnchor, { ...anchor, out: { x: 0, y: 0 } }),
        draft,
        selection: [node.id],
        handle: null,
      }
    }
  }

  const local = worldToLocalPoint(node, point)
  return {
    doc: appendAnchor(doc, draft.nodeId, draft.subpath, corner(local.x, local.y)),
    draft,
    selection: [node.id],
    handle: {
      ref: { nodeId: draft.nodeId, subpath: draft.subpath, index: last + 1 },
      anchor: point,
    },
  }
}

/* ── Curvature ───────────────────────────────────────────────────────────── */

/**
 * The curvature tool has no drag: every click is a point the curve must pass
 * through, and the whole subpath is refitted around it. That is the entire
 * interface, which is the point of the tool.
 */
export function curvatureClick(input: DrawClickInput): DrawClickResult {
  const { doc, draft, point, onAnchor } = input

  if (!draft) return startPath(doc, input.layer, point, true)

  const node = pathNodeOf(doc, draft.nodeId)
  const sp = node?.subpaths[draft.subpath]
  if (!node || !sp) return startPath(doc, input.layer, point, true)

  if (
    onAnchor &&
    onAnchor.nodeId === draft.nodeId &&
    onAnchor.subpath === draft.subpath &&
    onAnchor.index === 0 &&
    sp.anchors.length >= 2
  ) {
    const closed = closeSubPath(doc, draft.nodeId, draft.subpath)
    return {
      doc: refitSubPath(closed, draft.nodeId, draft.subpath),
      draft: null,
      selection: [node.id],
      handle: null,
    }
  }

  const local = worldToLocalPoint(node, point)
  const appended = appendAnchor(doc, draft.nodeId, draft.subpath, corner(local.x, local.y))
  return {
    doc: refitSubPath(appended, draft.nodeId, draft.subpath),
    draft,
    selection: [node.id],
    handle: null,
  }
}

/* ── Shared ──────────────────────────────────────────────────────────────── */

function startPath(
  doc: Doc,
  layer: LayerId,
  point: Vec,
  curvature: boolean,
): DrawClickResult {
  // A new node has an identity transform, so the document point is already the
  // local one.
  const node = createDrawnPath(layer, [{ closed: false, anchors: [corner(point.x, point.y)] }])
  return {
    doc: addNodes(doc, [node]),
    draft: { nodeId: node.id, subpath: 0 },
    selection: [node.id],
    handle: curvature ? null : { ref: { nodeId: node.id, subpath: 0, index: 0 }, anchor: point },
  }
}

/* ── The rubber band ─────────────────────────────────────────────────────── */

export interface DrawGhost {
  /** Cubic segments in document space. */
  segments: Cubic[]
  /**
   * The subpath whose committed outline this ghost stands in for.
   *
   * A curvature refit changes EVERY segment, not just the new one, so drawing
   * the ghost over the old outline would show two different curves at once and
   * neither of them the one you are about to get.
   */
  replaces: { nodeId: NodeId; subpath: number } | null
}

/** The last point placed, in document space — what Shift constrains against. */
export function lastAnchorWorld(doc: Doc, draft: PenDraft): Vec | null {
  const node = pathNodeOf(doc, draft.nodeId)
  const anchors = node?.subpaths[draft.subpath]?.anchors
  if (!node || !anchors || anchors.length === 0) return null
  return applyMatrix(node.transform, anchors[anchors.length - 1].p)
}

/**
 * How long the segment before this one is, in document units.
 *
 * The number a drawing tool can offer that no alignment guide can: "make this
 * one the same". Evenly spaced points are the whole game when you are laying
 * out a symmetrical shape, and they are the thing the eye is worst at.
 */
export function previousSegmentLength(doc: Doc, draft: PenDraft): number | null {
  const node = pathNodeOf(doc, draft.nodeId)
  const anchors = node?.subpaths[draft.subpath]?.anchors
  if (!node || !anchors || anchors.length < 2) return null
  const a = applyMatrix(node.transform, anchors[anchors.length - 2].p)
  const b = applyMatrix(node.transform, anchors[anchors.length - 1].p)
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * What the next click would draw.
 *
 * The pen previews only the new segment, because that is all a click changes:
 * the curve leaves along the handle that already exists and arrives straight at
 * the cursor. The curvature tool refits the whole subpath on every click, so it
 * previews the whole subpath — anything less shows a curve the click will not
 * produce, which is what makes the tool feel like it is arguing with you.
 */
export function drawGhost(
  doc: Doc,
  draft: PenDraft,
  cursor: Vec,
  curvature: boolean,
): DrawGhost | null {
  const node = pathNodeOf(doc, draft.nodeId)
  const sp = node?.subpaths[draft.subpath]
  if (!node || !sp || sp.anchors.length === 0 || sp.closed) return null

  const local = worldToLocalPoint(node, cursor)
  const fitted = curvature
    ? refitCurvature({ closed: false, anchors: [...sp.anchors, corner(local.x, local.y)] })
    : { closed: false, anchors: [...sp.anchors, corner(local.x, local.y)] }

  const toWorld = (p: Vec): Vec => applyMatrix(node.transform, p)
  const count = segmentCount(fitted)
  const segments: Cubic[] = []
  for (let i = curvature ? 0 : count - 1; i < count; i++) {
    const c = segmentCubic(fitted, i)
    segments.push({ p0: toWorld(c.p0), c1: toWorld(c.c1), c2: toWorld(c.c2), p1: toWorld(c.p1) })
  }

  return {
    segments,
    replaces: curvature ? { nodeId: node.id, subpath: draft.subpath } : null,
  }
}
