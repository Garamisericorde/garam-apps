/**
 * Dragging anchors and handles.
 *
 * Same contract as `tools/drag.ts`: each step works from the document as it was
 * when the drag began, so modifier keys apply the moment they are pressed
 * rather than only to whatever movement comes after.
 */
import {
  moveAnchors,
  refitSubPath,
  setHandle,
  worldToLocalDelta,
  type AnchorRef,
  type HandleSide,
} from '../doc/anchors'
import { lenVec, round, type Vec } from '../doc/geom'
import { snapBounds } from '../snap/engine'
import { NO_SNAP } from '../snap/types'
import type { DragContext, DragOutput, Modifiers } from './drag'

/** Angle step the Shift key constrains a handle to, in degrees. */
const ANGLE_STEP = 15

/* ── Moving anchors ──────────────────────────────────────────────────────── */

export interface AnchorMoveDrag {
  kind: 'anchorMove'
  refs: AnchorRef[]
  /** Document-space position of the anchor under the cursor at drag start. */
  lead: Vec
  startDoc: Vec
  /**
   * Refit the subpath after every move — the curvature tool's whole point is
   * that the curve reshapes itself while the point is still under the cursor.
   */
  refit?: boolean
}

export function stepAnchorMove(
  ctx: DragContext,
  drag: AnchorMoveDrag,
  cursor: Vec,
  mods: Modifiers,
): DragOutput {
  let dx = cursor.x - drag.startDoc.x
  let dy = cursor.y - drag.startDoc.y
  if (mods.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }

  /*
   * The anchor under the cursor is what snaps, as a point rather than a box.
   * Snapping the bounding box of a multi-anchor selection would line up a
   * rectangle that is not on screen and has no edges anyone can see.
   */
  const proposed = { x: drag.lead.x + dx, y: drag.lead.y + dy }
  const snap =
    ctx.snapEnabled && !mods.ctrl
      ? snapBounds({
          bounds: { x: proposed.x, y: proposed.y, width: 0, height: 0 },
          targets: ctx.targets,
          zoom: ctx.zoom,
          grid: ctx.grid,
          refs: { x: ['min'], y: ['min'] },
          spacing: false,
        })
      : NO_SNAP

  const sdx = mods.shift && dx === 0 ? 0 : snap.dx
  const sdy = mods.shift && dy === 0 ? 0 : snap.dy

  let doc = moveAnchors(ctx.baseDoc, drag.refs, { x: dx + sdx, y: dy + sdy })
  if (drag.refit) {
    // Every subpath with a point in the move gets refitted, once each however
    // many of its points went along.
    const touched = new Map<string, AnchorRef>()
    for (const ref of drag.refs) touched.set(`${ref.nodeId}/${ref.subpath}`, ref)
    for (const ref of touched.values()) doc = refitSubPath(doc, ref.nodeId, ref.subpath)
  }

  return {
    doc,
    guides: snap.guides,
    spacing: [],
    readout: `${round(proposed.x + sdx, 1)}, ${round(proposed.y + sdy, 1)}`,
  }
}

/* ── Moving handles ──────────────────────────────────────────────────────── */

export interface HandleMoveDrag {
  kind: 'handleMove'
  ref: AnchorRef
  side: HandleSide
  /** The anchor the handle belongs to, in document space. */
  anchor: Vec
  /**
   * True when the drag is CREATING the pair, as a pen drag does — the far
   * handle has no length of its own to preserve, so it mirrors exactly.
   */
  symmetric: boolean
}

export function stepHandleMove(
  ctx: DragContext,
  drag: HandleMoveDrag,
  cursor: Vec,
  mods: Modifiers,
): DragOutput {
  // Handles do not snap to other objects. A handle is a direction, not a
  // position, and lining one up with a neighbour's edge means nothing — the
  // guides would fire constantly and say nothing.
  const tip = mods.shift ? constrainAngle(drag.anchor, cursor, ANGLE_STEP) : cursor
  const world: Vec = { x: tip.x - drag.anchor.x, y: tip.y - drag.anchor.y }

  const node = ctx.baseDoc.nodes.find((n) => n.id === drag.ref.nodeId)
  if (!node) return { doc: ctx.baseDoc, guides: [], spacing: [], readout: null }

  const local = worldToLocalDelta(node, world)
  const doc = setHandle(ctx.baseDoc, drag.ref, drag.side, local, {
    // Alt breaks the pair — the standard way to put a cusp in a smooth curve.
    mirror: !mods.alt,
    symmetric: drag.symmetric && !mods.alt,
  })

  const degrees = (Math.atan2(world.y, world.x) * 180) / Math.PI
  return {
    doc,
    guides: [],
    spacing: [],
    readout: `${round(lenVec(world), 1)} · ${round(degrees, 1)}°`,
  }
}

/** Rounds the direction from `from` to `to` onto the nearest step, keeping length. */
export function constrainAngle(from: Vec, to: Vec, step: number): Vec {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return to
  const radians = (Math.round(Math.atan2(dy, dx) / ((step * Math.PI) / 180)) * (step * Math.PI)) / 180
  return { x: from.x + Math.cos(radians) * length, y: from.y + Math.sin(radians) * length }
}
