/**
 * The path-editing surface: what the anchor chrome shows, and what a click on
 * it means.
 *
 * The view model and the hit-test are built from the SAME structure on purpose.
 * When they are derived separately, an anchor ends up drawn a pixel or two from
 * where it can be grabbed, and no amount of staring at either half explains it.
 */
import {
  anchorWorld,
  handleWorld,
  type AnchorRef,
  type HandleSide,
} from '../doc/anchors'
import { applyMatrix, distVec, invertMatrix, lenVec, type Rect, type Vec } from '../doc/geom'
import { toPathNode } from '../doc/defaults'
import { nearestOnPath } from '../doc/path'
import { isEditable, isShown, isVectorNode, type Doc, type NodeId, type PathNode } from '../doc/types'
import { docToScreen, screenToDoc, type Viewport } from '../view/viewport'

/* ── View model ──────────────────────────────────────────────────────────── */

export interface AnchorView {
  ref: AnchorRef
  /** Document space. */
  p: Vec
  /** Handle tips in document space; null when the handle has no length. */
  inTip: Vec | null
  outTip: Vec | null
  /** No handles at all — drawn as a square rather than a circle. */
  corner: boolean
  selected: boolean
  /** Whether this anchor's handles are on screen and therefore grabbable. */
  showHandles: boolean
}

export interface SubPathView {
  closed: boolean
  anchors: AnchorView[]
}

export interface PathView {
  nodeId: NodeId
  subpaths: SubPathView[]
}

/**
 * Handles are shown for the selected anchors AND their immediate neighbours.
 *
 * Selecting one point and seeing only its own handles hides the two handles
 * that actually shape the segments either side of it, so the obvious next drag
 * needs a second selection first. Illustrator reveals the neighbours for the
 * same reason.
 */
function handleVisibility(count: number, closed: boolean, selected: Set<number>): Set<number> {
  const visible = new Set<number>()
  for (const i of selected) {
    visible.add(i)
    for (const j of [i - 1, i + 1]) {
      if (closed) visible.add((j + count) % count)
      else if (j >= 0 && j < count) visible.add(j)
    }
  }
  return visible
}

/**
 * The anchor chrome for a set of nodes.
 *
 * A rectangle that has not been converted yet still gets anchors here, from a
 * throwaway `toPathNode`. Converting on SELECTION would take the corner-radius
 * field away from anyone who only wanted a closer look; converting on the first
 * anchor edit keeps the live shape until the moment it stops being one. The
 * conversion is deterministic, so the indices shown now are the indices the
 * real path will have.
 */
export function buildPathViews(
  doc: Doc,
  ids: readonly NodeId[],
  anchorSelection: readonly AnchorRef[],
): PathView[] {
  const wanted = new Set(ids)
  const views: PathView[] = []

  for (const node of doc.nodes) {
    if (!wanted.has(node.id) || !isShown(doc, node) || !isVectorNode(node)) continue
    views.push(viewOf(node.type === 'path' ? node : toPathNode(node), anchorSelection))
  }
  return views
}

function viewOf(node: PathNode, anchorSelection: readonly AnchorRef[]): PathView {
  return {
    nodeId: node.id,
    subpaths: node.subpaths.map((sp, s) => {
      const selected = new Set(
        anchorSelection
          .filter((ref) => ref.nodeId === node.id && ref.subpath === s)
          .map((ref) => ref.index),
      )
      const visible = handleVisibility(sp.anchors.length, sp.closed, selected)

      return {
        closed: sp.closed,
        anchors: sp.anchors.map((anchor, index) => ({
          ref: { nodeId: node.id, subpath: s, index },
          p: anchorWorld(node, anchor),
          inTip: lenVec(anchor.in) > 1e-6 ? handleWorld(node, anchor, 'in') : null,
          outTip: lenVec(anchor.out) > 1e-6 ? handleWorld(node, anchor, 'out') : null,
          corner: lenVec(anchor.in) < 1e-6 && lenVec(anchor.out) < 1e-6,
          selected: selected.has(index),
          showHandles: visible.has(index),
        })),
      }
    }),
  }
}

/* ── Picking ─────────────────────────────────────────────────────────────── */

/** Grab radii, in screen pixels. */
export const ANCHOR_GRAB = 7
export const HANDLE_GRAB = 6
export const SEGMENT_GRAB = 5

export interface AnchorPick {
  kind: 'anchor'
  ref: AnchorRef
}

export interface HandlePick {
  kind: 'handle'
  ref: AnchorRef
  side: HandleSide
}

export interface SegmentPick {
  kind: 'segment'
  nodeId: NodeId
  subpath: number
  segment: number
  t: number
  /** Where on the curve, in document space. */
  point: Vec
}

export type PathPick = AnchorPick | HandlePick | SegmentPick

interface Candidate {
  pick: AnchorPick | HandlePick
  /** Document space. */
  at: Vec
}

function closest(
  candidates: readonly Candidate[],
  vp: Viewport,
  screen: Vec,
  grab: number,
): AnchorPick | HandlePick | null {
  let best: Candidate | null = null
  let bestDistance = grab
  for (const candidate of candidates) {
    const d = distVec(docToScreen(vp, candidate.at), screen)
    if (d <= bestDistance) {
      bestDistance = d
      best = candidate
    }
  }
  return best?.pick ?? null
}

/**
 * What is under the cursor, in priority order.
 *
 * Handles first: they stick out past the anchor they belong to, and an anchor
 * that steals its own handle's click is the single most infuriating thing a
 * path editor can do. Anchors second.
 */
export function pickPath(
  views: readonly PathView[],
  vp: Viewport,
  screen: Vec,
): AnchorPick | HandlePick | null {
  const handles: Candidate[] = []
  const anchors: Candidate[] = []

  for (const view of views) {
    for (const sp of view.subpaths) {
      for (const anchor of sp.anchors) {
        anchors.push({ pick: { kind: 'anchor', ref: anchor.ref }, at: anchor.p })
        if (!anchor.showHandles) continue
        if (anchor.inTip) {
          handles.push({ pick: { kind: 'handle', ref: anchor.ref, side: 'in' }, at: anchor.inTip })
        }
        if (anchor.outTip) {
          handles.push({ pick: { kind: 'handle', ref: anchor.ref, side: 'out' }, at: anchor.outTip })
        }
      }
    }
  }

  return closest(handles, vp, screen, HANDLE_GRAB) ?? closest(anchors, vp, screen, ANCHOR_GRAB)
}

/**
 * The nearest point on a path's outline, if the cursor is close enough.
 *
 * Searched in the node's LOCAL space and compared after scaling by the zoom:
 * the transforms are rigid, so a local distance is a document distance, and a
 * document distance times the zoom is what the user sees.
 */
export function pickSegment(
  doc: Doc,
  ids: readonly NodeId[],
  vp: Viewport,
  screen: Vec,
  grab = SEGMENT_GRAB,
): SegmentPick | null {
  const point = screenToDoc(vp, screen)
  const wanted = new Set(ids)
  let best: SegmentPick | null = null
  let bestDistance = grab

  for (const node of doc.nodes) {
    if (!wanted.has(node.id) || !isEditable(doc, node) || !isVectorNode(node)) continue
    const asPath = node.type === 'path' ? node : toPathNode(node)
    const local = applyMatrix(invertMatrix(node.transform), point)
    const hit = nearestOnPath(asPath.subpaths, local)
    if (!hit) continue
    const onScreen = hit.distance * vp.zoom
    if (onScreen > bestDistance) continue
    bestDistance = onScreen
    best = {
      kind: 'segment',
      nodeId: node.id,
      subpath: hit.subpath,
      segment: hit.segment,
      t: hit.t,
      point: applyMatrix(node.transform, hit.point),
    }
  }
  return best
}

/** Every anchor a rubber band caught, for a direct-select marquee. */
export function anchorsInRect(views: readonly PathView[], rect: Rect): AnchorRef[] {
  const out: AnchorRef[] = []
  for (const view of views) {
    for (const sp of view.subpaths) {
      for (const anchor of sp.anchors) {
        const { x, y } = anchor.p
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
          out.push(anchor.ref)
        }
      }
    }
  }
  return out
}

/**
 * Every anchor in the document, as snap candidates for a path tool.
 *
 * The anchors being dragged are left out: their own starting positions would
 * otherwise be the closest targets on screen, and the point would stick to
 * where it began.
 */
export function anchorPoints(doc: Doc, exclude: readonly AnchorRef[] = []): Vec[] {
  const skip = new Set(exclude.map((r) => `${r.nodeId}:${r.subpath}:${r.index}`))
  const out: Vec[] = []
  for (const node of doc.nodes) {
    if (!isShown(doc, node) || node.type !== 'path') continue
    node.subpaths.forEach((sp, s) => {
      sp.anchors.forEach((anchor, index) => {
        if (skip.has(`${node.id}:${s}:${index}`)) return
        out.push(anchorWorld(node, anchor))
      })
    })
  }
  return out
}
