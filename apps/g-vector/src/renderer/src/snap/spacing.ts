/**
 * Equal-spacing detection — the guide that says "this gap matches that gap".
 *
 * It is the one smart guide people actually miss when it is absent, because
 * eyeballing equal gaps is the thing the eye is worst at. Alignment beats it:
 * if an edge or a centre already latched on this axis, spacing stays quiet
 * rather than fighting it for the same pixel.
 */
import type { Rect } from '../doc/geom'
import type { NodeId } from '../doc/types'
import type { SpacingGuide } from './types'

export interface SpacingRequest {
  axis: 'x' | 'y'
  /** The moving object's proposed world bounds. */
  moving: Rect
  boxes: readonly { id: NodeId; rect: Rect }[]
  /** Snap distance, in DOCUMENT units. */
  tolerance: number
}

export interface SpacingMatch {
  /** How far to move along the axis to make the gaps equal. */
  delta: number
  guide: SpacingGuide
}

interface Span {
  start: number
  end: number
  perpStart: number
  perpEnd: number
}

function spanOf(r: Rect, axis: 'x' | 'y'): Span {
  return axis === 'x'
    ? { start: r.x, end: r.x + r.width, perpStart: r.y, perpEnd: r.y + r.height }
    : { start: r.y, end: r.y + r.height, perpStart: r.x, perpEnd: r.x + r.width }
}

/** Where a bar between two boxes should be drawn on the other axis. */
function barPosition(a: Span, b: Span): number {
  const lo = Math.max(a.perpStart, b.perpStart)
  const hi = Math.min(a.perpEnd, b.perpEnd)
  // They overlap by construction, but a zero-height overlap is still possible.
  return hi >= lo ? (lo + hi) / 2 : (a.perpStart + a.perpEnd + b.perpStart + b.perpEnd) / 4
}

export function findSpacing(req: SpacingRequest): SpacingMatch | null {
  const moving = spanOf(req.moving, req.axis)
  const size = moving.end - moving.start

  // Only objects that actually sit beside the moving one on the other axis.
  // Spacing between two shapes on opposite sides of the canvas is a number, not
  // a relationship, and showing it as one is noise.
  const neighbours = req.boxes
    .map((b) => spanOf(b.rect, req.axis))
    .filter((s) => s.perpEnd > moving.perpStart && s.perpStart < moving.perpEnd)
    .sort((a, b) => a.start - b.start)

  if (neighbours.length === 0) return null

  const before = neighbours.filter((s) => s.end <= moving.start + req.tolerance)
  const after = neighbours.filter((s) => s.start >= moving.end - req.tolerance)
  const left = before.length > 0 ? before[before.length - 1] : null
  const right = after.length > 0 ? after[0] : null

  // Every gap that already exists in the chain, so a new one can match it.
  const existing: { gap: number; a: Span; b: Span }[] = []
  for (let i = 0; i < neighbours.length - 1; i++) {
    const gap = neighbours[i + 1].start - neighbours[i].end
    if (gap > 0.5) existing.push({ gap, a: neighbours[i], b: neighbours[i + 1] })
  }

  interface Proposal {
    start: number
    gap: number
    /** The existing pairs that share this gap, for extra bars. */
    matches: { a: Span; b: Span }[]
  }
  const proposals: Proposal[] = []

  // Centred between the two neighbours — the commonest thing anyone wants.
  if (left && right) {
    const gap = (right.start - left.end - size) / 2
    if (gap > 0.5) proposals.push({ start: left.end + gap, gap, matches: [] })
  }

  // Or repeating a gap that is already in the row.
  for (const { gap } of existing) {
    // Every pair already showing this gap gets a bar too, so the guide reads as
    // "these three are equal" rather than as one lonely measurement.
    const twins = existing
      .filter((e) => Math.abs(e.gap - gap) < 0.5)
      .map((e) => ({ a: e.a, b: e.b }))
    if (left) proposals.push({ start: left.end + gap, gap, matches: twins })
    if (right) proposals.push({ start: right.start - gap - size, gap, matches: twins })
  }

  let best: Proposal | null = null
  let bestDistance = req.tolerance
  for (const p of proposals) {
    const d = Math.abs(p.start - moving.start)
    if (d <= bestDistance) {
      bestDistance = d
      best = p
    }
  }
  if (!best) return null

  const delta = best.start - moving.start
  const snapped: Span = {
    ...moving,
    start: best.start,
    end: best.start + size,
  }

  const bars: SpacingGuide['bars'] = []
  const addBar = (a: Span, b: Span): void => {
    bars.push({ start: a.end, end: b.start, at: barPosition(a, b) })
  }
  if (left && Math.abs(snapped.start - left.end - best.gap) < 0.5) addBar(left, snapped)
  if (right && Math.abs(right.start - snapped.end - best.gap) < 0.5) addBar(snapped, right)
  for (const m of best.matches) addBar(m.a, m.b)

  if (bars.length < 2) return null

  return {
    delta,
    guide: { axis: req.axis, distance: best.gap, bars },
  }
}
