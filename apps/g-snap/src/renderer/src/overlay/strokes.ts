import type { Rect } from '@shared/types'
import type { Point } from './types'

/**
 * Geometry for the drawing tools: modifier-aware shape building, and the
 * smoothing that turns a shaky mouse path into a line worth keeping.
 */

/** Modifier keys, read live while a drag is in progress. */
export interface Modifiers {
  /** Constrain: square, circle, or a segment snapped to 45 degrees. */
  shift: boolean
  /** Grow from the start point as the CENTRE rather than a corner. */
  alt: boolean
}

export const NO_MODIFIERS: Modifiers = { shift: false, alt: false }

/**
 * Builds a rectangle (or an ellipse's bounding box) from a drag.
 *
 * Plain drag is corner-to-corner, which is what you want for framing something
 * you can see the edges of. Alt makes the start point the centre, which is what
 * you want for ringing something you are pointing AT: put the cursor on the
 * target, hold Alt, pull outwards, and the circle stays centred on it.
 *
 * Alt CONSTRAINS as well as centres. Ringing something is the whole reason to
 * draw from the centre, and a ring is a circle — a centred ellipse was a shape
 * nobody was reaching for, and getting one by accident was the common outcome.
 * So the only thing Alt can produce is a square or a true circle.
 */
export function boxFrom(start: Point, p: Point, mods: Modifiers): Rect {
  let dx = p.x - start.x
  let dy = p.y - start.y

  if (mods.shift || mods.alt) {
    // Equal on both axes. The LARGER travel wins so the shape never shrinks
    // away from the pointer; taking the smaller one makes the corner lag.
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * size
    dy = (dy < 0 ? -1 : 1) * size
  }

  if (mods.alt) {
    return {
      x: start.x - Math.abs(dx),
      y: start.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    }
  }

  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  }
}

/** Eight directions, so a shift-drag snaps to the nearest 45 degrees. */
const SNAP_STEP = Math.PI / 4

/**
 * End point of a line or arrow.
 *
 * Shift snaps the direction to 45 degree steps while keeping the length the
 * user has actually dragged, so a horizontal line stays exactly horizontal.
 */
export function segmentTo(start: Point, p: Point, mods: Modifiers): Point {
  if (!mods.shift) return p

  const dx = p.x - start.x
  const dy = p.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return p

  const angle = Math.round(Math.atan2(dy, dx) / SNAP_STEP) * SNAP_STEP
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length }
}

// ── Freehand smoothing ─────────────────────────────────────────────────────

/**
 * Points closer together than this are not recorded.
 *
 * A mouse reports far more often than a hand can meaningfully move, so a slow
 * stroke collects dozens of points inside a couple of pixels. Those points are
 * pure tremor, and they are what made the pen look shaky: the curve has to pass
 * through every one of them.
 */
const MIN_STEP = 2.4

/**
 * How much of the raw pointer position is taken, 0..1.
 *
 * A low-pass filter on the input. Lower is smoother but lags further behind the
 * cursor; at 0.55 the lag is under a pixel at normal drawing speed and the
 * tremor is visibly gone.
 */
const FOLLOW = 0.55

/**
 * Adds a pointer sample to a stroke, or rejects it.
 *
 * Returns the same array when the sample is too close to be worth keeping, so
 * the caller can skip the re-render entirely.
 */
export function appendPoint(points: number[], p: Point): number[] {
  const n = points.length
  if (n < 2) return [p.x, p.y]

  const lastX = points[n - 2]
  const lastY = points[n - 1]
  if (Math.hypot(p.x - lastX, p.y - lastY) < MIN_STEP) return points

  return [...points, lastX + (p.x - lastX) * FOLLOW, lastY + (p.y - lastY) * FOLLOW]
}

/** Perpendicular distance from a point to the line through a and b. */
function distanceToLine(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay)

  // Project onto the segment, clamped to its ends.
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Ramer-Douglas-Peucker: drops every point that does not change the path's
 * shape by more than `epsilon`.
 *
 * Iterative rather than recursive — a long stroke can hold thousands of points
 * and the recursive form is a stack overflow waiting to happen.
 */
export function simplify(points: number[], epsilon: number): number[] {
  const count = points.length / 2
  if (count < 3) return points

  const keep = new Uint8Array(count)
  keep[0] = 1
  keep[count - 1] = 1

  const stack: Array<[number, number]> = [[0, count - 1]]

  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    if (last <= first + 1) continue

    let worst = 0
    let worstAt = -1
    for (let i = first + 1; i < last; i++) {
      const d = distanceToLine(
        points[i * 2],
        points[i * 2 + 1],
        points[first * 2],
        points[first * 2 + 1],
        points[last * 2],
        points[last * 2 + 1],
      )
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }

    if (worst > epsilon && worstAt > 0) {
      keep[worstAt] = 1
      stack.push([first, worstAt], [worstAt, last])
    }
  }

  const out: number[] = []
  for (let i = 0; i < count; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1])
  }
  return out
}

/** How far a point may be dropped from the path when a stroke is finished. */
const SIMPLIFY_EPSILON = 0.9

/**
 * Cleans up a finished stroke.
 *
 * Konva draws a Line with `tension` as a Catmull-Rom spline through EVERY
 * point, so a dense path produces a curve that faithfully reproduces the shake.
 * Thinning first is what lets the spline do its job — the surviving points are
 * the ones that carry the shape, and the curve between them comes out smooth.
 */
export function smoothStroke(points: number[]): number[] {
  return simplify(points, SIMPLIFY_EPSILON)
}
