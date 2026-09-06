/**
 * What each kind of drag does, as pure functions.
 *
 * Every one takes the document as it was when the drag STARTED and returns a
 * fresh one, rather than accumulating deltas frame by frame. Accumulation is
 * what makes a shape creep away from the cursor over a long drag, and it makes
 * modifier keys — pressed halfway through — impossible to apply retroactively.
 */
import { localBounds, selectionFrame, type SelectionFrame } from '../doc/bounds'
import {
  applyMatrix,
  invertMatrix,
  rectFromCorners,
  round,
  type Matrix,
  type Rect,
  type Vec,
} from '../doc/geom'
import { rotateNodes, scaleNodes, setLocalBox, translateNodes } from '../doc/ops'
import { nodesById, type Doc, type NodeId } from '../doc/types'
import { snapBounds } from '../snap/engine'
import {
  NO_SNAP,
  type Guide,
  type RefKind,
  type SnapResult,
  type SnapTargets,
  type SpacingGuide,
} from '../snap/types'
import { handleAxes, type HandleId } from './handles'

export interface Modifiers {
  shift: boolean
  alt: boolean
  /** Held Ctrl suspends snapping — the escape hatch every editor needs. */
  ctrl: boolean
}

export interface DragContext {
  baseDoc: Doc
  targets: SnapTargets
  zoom: number
  snapEnabled: boolean
  grid: number | null
}

export interface DragOutput {
  doc: Doc
  guides: Guide[]
  spacing: SpacingGuide[]
  /** Text for the floating readout, or null for none. */
  readout: string | null
}

function snapping(ctx: DragContext, mods: Modifiers): boolean {
  return ctx.snapEnabled && !mods.ctrl
}

/** The smallest a shape may be resized to, in document units. */
const MIN_SIZE = 1

type Axes = { x: -1 | 0 | 1; y: -1 | 0 | 1 }

/* ── Move ────────────────────────────────────────────────────────────────── */

export interface MoveDrag {
  kind: 'move'
  ids: NodeId[]
  startDoc: Vec
  startBounds: Rect
}

export function stepMove(
  ctx: DragContext,
  drag: MoveDrag,
  cursor: Vec,
  mods: Modifiers,
): DragOutput {
  let dx = cursor.x - drag.startDoc.x
  let dy = cursor.y - drag.startDoc.y

  // Shift locks to whichever axis the drag has committed to most.
  if (mods.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }

  const proposed: Rect = {
    ...drag.startBounds,
    x: drag.startBounds.x + dx,
    y: drag.startBounds.y + dy,
  }
  const snap = snapping(ctx, mods)
    ? snapBounds({
        bounds: proposed,
        targets: ctx.targets,
        zoom: ctx.zoom,
        grid: ctx.grid,
        spacing: true,
      })
    : NO_SNAP

  // An axis Shift locked stays locked: a snap on it would undo the lock.
  const sdx = mods.shift && dx === 0 ? 0 : snap.dx
  const sdy = mods.shift && dy === 0 ? 0 : snap.dy

  return {
    doc: translateNodes(ctx.baseDoc, drag.ids, dx + sdx, dy + sdy),
    guides: snap.guides,
    spacing: snap.spacing,
    readout: `${round(proposed.x + sdx, 1)}, ${round(proposed.y + sdy, 1)}`,
  }
}

/* ── Resize ──────────────────────────────────────────────────────────────── */

export interface ResizeDrag {
  kind: 'resize'
  ids: NodeId[]
  handle: HandleId
  frame: SelectionFrame
  /**
   * Set when exactly one node is selected. A single node is resized in its OWN
   * space, which is exact whatever its rotation; a multi-selection has no such
   * space and falls back to scaling world bounds.
   */
  singleId: NodeId | null
  baseLocal: Rect | null
  inverse: Matrix | null
  /** True when nothing in the selection is rotated, so world snapping applies. */
  axisAligned: boolean
}

export function beginResize(doc: Doc, ids: NodeId[], handle: HandleId): ResizeDrag | null {
  const nodes = nodesById(doc, ids)
  const frame = selectionFrame(nodes)
  if (!frame) return null
  const single = nodes.length === 1 ? nodes[0] : null
  const axisAligned = nodes.every((n) => n.transform[1] === 0 && n.transform[2] === 0)
  return {
    kind: 'resize',
    ids,
    handle,
    frame,
    singleId: single?.id ?? null,
    baseLocal: single ? localBounds(single) : null,
    inverse: single ? invertMatrix(single.transform) : null,
    axisAligned,
  }
}

export function stepResize(
  ctx: DragContext,
  drag: ResizeDrag,
  cursor: Vec,
  mods: Modifiers,
): DragOutput {
  const axes = handleAxes(drag.handle)
  const refs: { x?: RefKind[]; y?: RefKind[] } = {
    x: axes.x === -1 ? ['min'] : axes.x === 1 ? ['max'] : [],
    y: axes.y === -1 ? ['min'] : axes.y === 1 ? ['max'] : [],
  }

  if (drag.singleId && drag.baseLocal && drag.inverse) {
    const node = ctx.baseDoc.nodes.find((n) => n.id === drag.singleId)
    const local = edgesFromCursor(drag.baseLocal, applyMatrix(drag.inverse, cursor), axes, mods)

    // Snapping happens in world space, so it only applies while the node is
    // unrotated. On a rotated shape the guides would be measuring the axis
    // aligned box around it, not the box being dragged — worse than no guides.
    let snap: SnapResult = NO_SNAP
    let box = local
    if (node && drag.axisAligned && snapping(ctx, mods)) {
      const world: Rect = {
        x: local.x + node.transform[4],
        y: local.y + node.transform[5],
        width: local.width,
        height: local.height,
      }
      snap = snapBounds({
        bounds: world,
        targets: ctx.targets,
        zoom: ctx.zoom,
        grid: ctx.grid,
        refs,
        spacing: false,
      })
      box = applyEdgeSnap(local, axes, snap.dx, snap.dy)
    }
    return {
      doc: setLocalBox(ctx.baseDoc, drag.singleId, box),
      guides: snap.guides,
      spacing: [],
      readout: `${round(box.width, 1)} × ${round(box.height, 1)}`,
    }
  }

  // A multi-selection has no local space to work in, so its world bounds are
  // scaled about the corner opposite the handle.
  const base = drag.frame.bounds
  const world = edgesFromCursor(base, cursor, axes, mods)
  let box = world
  let snap: SnapResult = NO_SNAP
  if (drag.axisAligned && snapping(ctx, mods)) {
    snap = snapBounds({
      bounds: world,
      targets: ctx.targets,
      zoom: ctx.zoom,
      grid: ctx.grid,
      refs,
      spacing: false,
    })
    box = applyEdgeSnap(world, axes, snap.dx, snap.dy)
  }

  const sx = base.width > MIN_SIZE ? box.width / base.width : 1
  const sy = base.height > MIN_SIZE ? box.height / base.height : 1
  const pivot: Vec = {
    x: axes.x === -1 ? base.x + base.width : base.x,
    y: axes.y === -1 ? base.y + base.height : base.y,
  }
  return {
    doc: scaleNodes(ctx.baseDoc, drag.ids, pivot, sx, sy),
    guides: snap.guides,
    spacing: [],
    readout: `${round(box.width, 1)} × ${round(box.height, 1)}`,
  }
}

/** Moves the edges a handle controls onto the cursor, honouring Shift and Alt. */
function edgesFromCursor(base: Rect, cursor: Vec, axes: Axes, mods: Modifiers): Rect {
  let left = base.x
  let top = base.y
  let right = base.x + base.width
  let bottom = base.y + base.height

  if (axes.x === -1) left = cursor.x
  if (axes.x === 1) right = cursor.x
  if (axes.y === -1) top = cursor.y
  if (axes.y === 1) bottom = cursor.y

  // Shift keeps the original proportions, on corner handles only — an edge
  // handle has no second axis for a ratio to act on.
  if (mods.shift && axes.x !== 0 && axes.y !== 0 && base.height > 0) {
    const ratio = base.width / base.height
    const w = right - left
    const h = bottom - top
    if (Math.abs(w) > Math.abs(h * ratio)) {
      const fixed = Math.abs(w / ratio) * Math.sign(h || 1)
      if (axes.y === -1) top = bottom - fixed
      else bottom = top + fixed
    } else {
      const fixed = Math.abs(h * ratio) * Math.sign(w || 1)
      if (axes.x === -1) left = right - fixed
      else right = left + fixed
    }
  }

  // Alt resizes about the centre: the opposite edge mirrors the dragged one.
  if (mods.alt) {
    const cx = base.x + base.width / 2
    const cy = base.y + base.height / 2
    if (axes.x === -1) right = 2 * cx - left
    if (axes.x === 1) left = 2 * cx - right
    if (axes.y === -1) bottom = 2 * cy - top
    if (axes.y === 1) top = 2 * cy - bottom
  }

  // No flipping yet: a negative box has to mirror the geometry, and a path
  // mirrored by a sign in the width is a squash, not a reflection.
  if (right - left < MIN_SIZE) {
    if (axes.x === -1) left = right - MIN_SIZE
    else right = left + MIN_SIZE
  }
  if (bottom - top < MIN_SIZE) {
    if (axes.y === -1) top = bottom - MIN_SIZE
    else bottom = top + MIN_SIZE
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Applies a snap delta to the dragged edge only, leaving the anchored one put. */
function applyEdgeSnap(box: Rect, axes: Axes, dx: number, dy: number): Rect {
  let { x, y, width, height } = box
  if (axes.x === -1) {
    x += dx
    width -= dx
  } else if (axes.x === 1) {
    width += dx
  }
  if (axes.y === -1) {
    y += dy
    height -= dy
  } else if (axes.y === 1) {
    height += dy
  }
  return { x, y, width: Math.max(MIN_SIZE, width), height: Math.max(MIN_SIZE, height) }
}

/* ── Rotate ──────────────────────────────────────────────────────────────── */

export interface RotateDrag {
  kind: 'rotate'
  ids: NodeId[]
  pivot: Vec
  /** The angle from pivot to cursor when the drag began, in degrees. */
  startAngle: number
  /** The frame's rotation at the start, so the readout shows a total. */
  startRotation: number
}

export function angleTo(pivot: Vec, p: Vec): number {
  return (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI
}

export function stepRotate(
  ctx: DragContext,
  drag: RotateDrag,
  cursor: Vec,
  mods: Modifiers,
): DragOutput {
  let degrees = angleTo(drag.pivot, cursor) - drag.startAngle
  if (mods.shift) degrees = Math.round(degrees / 15) * 15

  return {
    doc: rotateNodes(ctx.baseDoc, drag.ids, degrees, drag.pivot),
    guides: [],
    spacing: [],
    readout: `${round(normalizeAngle(drag.startRotation + degrees), 1)}°`,
  }
}

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360
  if (wrapped > 180) return wrapped - 360
  if (wrapped < -180) return wrapped + 360
  return wrapped
}

/* ── Draw ────────────────────────────────────────────────────────────────── */

export interface DrawDrag {
  kind: 'draw'
  shape: 'rect' | 'ellipse'
  startDoc: Vec
}

export interface DrawOutput {
  rect: Rect
  guides: Guide[]
  readout: string
}

/**
 * The rectangle a shape drag currently describes.
 *
 * Only the CURSOR corner snaps. Snapping the whole box would drag the corner
 * that was already placed, which turns "start here" into a suggestion.
 */
export function stepDraw(
  ctx: DragContext,
  drag: DrawDrag,
  cursor: Vec,
  mods: Modifiers,
): DrawOutput {
  let corner = cursor
  let guides: Guide[] = []

  if (snapping(ctx, mods)) {
    const snap = snapBounds({
      bounds: { x: cursor.x, y: cursor.y, width: 0, height: 0 },
      targets: ctx.targets,
      zoom: ctx.zoom,
      grid: ctx.grid,
      refs: { x: ['min'], y: ['min'] },
      spacing: false,
    })
    corner = { x: cursor.x + snap.dx, y: cursor.y + snap.dy }
    guides = snap.guides
  }

  if (mods.shift) {
    // A square, in whichever direction the drag is heading. The snap is dropped
    // rather than fought with: it cannot hold both constraints at once.
    const dx = corner.x - drag.startDoc.x
    const dy = corner.y - drag.startDoc.y
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    corner = {
      x: drag.startDoc.x + Math.sign(dx || 1) * size,
      y: drag.startDoc.y + Math.sign(dy || 1) * size,
    }
    guides = []
  }

  const origin = mods.alt
    ? { x: 2 * drag.startDoc.x - corner.x, y: 2 * drag.startDoc.y - corner.y }
    : drag.startDoc

  const rect = rectFromCorners(origin, corner)
  return { rect, guides, readout: `${round(rect.width, 1)} × ${round(rect.height, 1)}` }
}
