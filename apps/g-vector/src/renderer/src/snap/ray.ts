/**
 * Snapping along a fixed direction.
 *
 * When Shift holds the angle, an ordinary two-axis snap is no use: any pull it
 * applies takes the point off the ray, which is the one thing the constraint
 * was asked to guarantee. So the direction stays fixed and the snap chooses the
 * DISTANCE instead — slide along the ray until it crosses a line something else
 * is already on.
 *
 * That is what makes "hold Shift, run out at 45 degrees, stop level with the
 * left edge" a single gesture rather than a guess.
 */
import type { Vec } from '../doc/geom'
import type { Guide, SnapCandidate, SnapTargets } from './types'
import { SNAP_PRIORITY } from './types'

export interface RaySnapRequest {
  /** Where the ray starts, in document space. */
  origin: Vec
  /** Unit vector along the ray. */
  direction: Vec
  /** How far along the ray the cursor currently is. */
  distance: number
  targets: SnapTargets
  zoom: number
  /** Screen pixels. */
  threshold: number
}

export interface RaySnapResult {
  /** The snapped distance along the ray. */
  distance: number
  guides: Guide[]
}

export function snapAlongRay(request: RaySnapRequest): RaySnapResult | null {
  const { origin, direction, distance, targets, zoom } = request
  const tolerance = request.threshold / zoom

  let bestDistance = Infinity
  let bestPriority = -1
  let best: { at: number; candidate: SnapCandidate; axis: 'x' | 'y' } | null = null

  const consider = (axis: 'x' | 'y', candidate: SnapCandidate): void => {
    const step = axis === 'x' ? direction.x : direction.y
    // A ray running straight down never crosses a given x, and dividing by that
    // zero would put the point at infinity.
    if (Math.abs(step) < 1e-6) return

    const start = axis === 'x' ? origin.x : origin.y
    const at = (candidate.value - start) / step
    // Behind the origin is not on the ray the user is drawing along.
    if (at <= 0) return

    const moved = Math.abs(at - distance)
    if (moved > tolerance) return

    const priority = SNAP_PRIORITY[candidate.kind]
    const better =
      moved < bestDistance - 0.001 || (moved <= bestDistance + 0.001 && priority > bestPriority)
    if (!better) return
    bestDistance = moved
    bestPriority = priority
    best = { at, candidate, axis }
  }

  for (const candidate of targets.x) consider('x', candidate)
  for (const candidate of targets.y) consider('y', candidate)
  if (!best) return null

  const winner: { at: number; candidate: SnapCandidate; axis: 'x' | 'y' } = best
  const point: Vec = {
    x: origin.x + direction.x * winner.at,
    y: origin.y + direction.y * winner.at,
  }

  /*
   * Every candidate the settled point now sits on, not just the winner — three
   * things sharing an edge should show one line touching all three, the same
   * rule the two-axis engine follows.
   */
  const epsilon = 0.5 / zoom
  const guides: Guide[] = []
  const seen = new Set<string>()
  for (const axis of ['x', 'y'] as const) {
    const value = point[axis]
    const across = axis === 'x' ? point.y : point.x
    for (const candidate of axis === 'x' ? targets.x : targets.y) {
      if (Math.abs(candidate.value - value) > epsilon) continue
      const key = `${axis}:${candidate.value.toFixed(3)}`
      if (seen.has(key)) continue
      seen.add(key)
      guides.push({
        axis,
        value: candidate.value,
        from: Math.min(candidate.from, across),
        to: Math.max(candidate.to, across),
        kind: candidate.kind,
      })
    }
  }

  return { distance: winner.at, guides }
}
