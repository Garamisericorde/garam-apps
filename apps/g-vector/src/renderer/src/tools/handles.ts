/**
 * The selection frame's handles.
 *
 * Positions are computed in SCREEN space and shared by the two places that must
 * agree about them: the overlay that draws them and the pointer code that hits
 * them. Computing each separately is how a handle ends up drawn two pixels from
 * where it can be grabbed.
 */
import type { SelectionFrame } from '../doc/bounds'
import { distVec, type Vec } from '../doc/geom'
import { docToScreen, type Viewport } from '../view/viewport'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface HandlePoint {
  id: HandleId
  /** Screen-space position. */
  p: Vec
}

/** Drawn size in CSS pixels. */
export const HANDLE_SIZE = 8
/** Grab radius — larger than the drawn square, because 8 px is a hard target. */
export const HANDLE_GRAB = 7
/** How far outside a corner the rotate zone reaches. */
export const ROTATE_GRAB = 18

/**
 * Corner order matches rectCorners(): top-left, top-right, bottom-right,
 * bottom-left — before rotation, so a rotated frame keeps naming the corner
 * that is top-left IN THE SHAPE, which is what a resize has to work from.
 */
export function handlePoints(frame: SelectionFrame, vp: Viewport): HandlePoint[] {
  const [tl, tr, br, bl] = frame.corners.map((c) => docToScreen(vp, c))
  const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return [
    { id: 'nw', p: tl },
    { id: 'n', p: mid(tl, tr) },
    { id: 'ne', p: tr },
    { id: 'e', p: mid(tr, br) },
    { id: 'se', p: br },
    { id: 's', p: mid(br, bl) },
    { id: 'sw', p: bl },
    { id: 'w', p: mid(bl, tl) },
  ]
}

export function hitHandle(points: readonly HandlePoint[], p: Vec): HandleId | null {
  for (const handle of points) {
    if (distVec(handle.p, p) <= HANDLE_GRAB) return handle.id
  }
  return null
}

/**
 * The ring just outside a corner where the cursor turns into a rotate arrow.
 * Only corners rotate: an edge rotate zone competes with the resize handle next
 * to it and makes the frame feel like it is guessing.
 */
export function hitRotateZone(points: readonly HandlePoint[], p: Vec): HandleId | null {
  for (const handle of points) {
    if (handle.id.length !== 2) continue
    const d = distVec(handle.p, p)
    if (d > HANDLE_GRAB && d <= ROTATE_GRAB) return handle.id
  }
  return null
}

/** Which local-box edges a handle moves. */
export function handleAxes(id: HandleId): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const x = id.includes('w') ? -1 : id.includes('e') ? 1 : 0
  const y = id.includes('n') ? -1 : id.includes('s') ? 1 : 0
  return { x, y }
}

const CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/**
 * The resize cursor for a handle, turned with the frame.
 *
 * A shape rotated 90° whose top handle still shows a vertical arrow is telling
 * the user the wrong thing, so the eight cursors are indexed by the handle's
 * actual on-screen direction rather than by its name.
 */
export function handleCursor(id: HandleId, frameRotation: number): string {
  const order: HandleId[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
  const index = order.indexOf(id)
  if (index < 0) return 'default'
  const steps = Math.round(((frameRotation % 360) + 360) / 45) % 8
  return CURSORS[order[(index + steps) % 8]]
}
