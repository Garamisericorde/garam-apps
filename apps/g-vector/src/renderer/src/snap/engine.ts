/**
 * The snap engine.
 *
 * Given where a drag WANTS to put something, it answers with where it should
 * actually go and which guides to draw. Three rules run the whole thing:
 *
 *  1. The threshold is in SCREEN pixels, divided by zoom before use. A snap that
 *     is measured in document units grabs from half a screen away at 10% zoom
 *     and becomes unusable at 800%.
 *  2. One snap per axis. Two competing latches on the same axis cannot both be
 *     satisfied, and picking silently is how an editor starts to feel haunted.
 *  3. Alignment beats spacing. If an edge already lined up, the gap hint stays
 *     quiet instead of pulling the object off that edge by a pixel.
 */
import type { Rect } from '../doc/geom'
import { findSpacing } from './spacing'
import {
  ALL_REFS,
  NO_SNAP,
  SNAP_PRIORITY,
  type Guide,
  type RefKind,
  type SnapCandidate,
  type SnapResult,
  type SnapTargets,
  type SpacingGuide,
} from './types'

/** Distance, in screen pixels, at which a snap takes hold. */
export const DEFAULT_THRESHOLD = 6

export interface SnapRequest {
  /** Where the drag would put the moving object, in document space. */
  bounds: Rect
  targets: SnapTargets
  zoom: number
  /** Screen pixels; defaults to DEFAULT_THRESHOLD. */
  threshold?: number
  /**
   * Which points on the moving box may latch, per axis. A resize passes only
   * the edge it is dragging — otherwise pulling the right edge snaps the left
   * one and the shape jumps out from under the cursor.
   */
  refs?: { x?: readonly RefKind[]; y?: readonly RefKind[] }
  /** Grid pitch in document units, or null for no grid. */
  grid?: number | null
  /** Run the equal-spacing pass. Off during a resize, where it means nothing. */
  spacing?: boolean
}

interface AxisSnap {
  delta: number
  fromGrid: boolean
}

export function snapBounds(request: SnapRequest): SnapResult {
  const { bounds, targets, zoom } = request
  const tolerance = (request.threshold ?? DEFAULT_THRESHOLD) / zoom
  const refsX = request.refs?.x ?? ALL_REFS
  const refsY = request.refs?.y ?? ALL_REFS

  const x = snapAxis(refValues(bounds, 'x'), refsX, targets.x, tolerance, request.grid ?? null)
  const y = snapAxis(refValues(bounds, 'y'), refsY, targets.y, tolerance, request.grid ?? null)

  let dx = x?.delta ?? 0
  let dy = y?.delta ?? 0

  // Spacing only speaks on an axis alignment left alone.
  const spacing: SpacingGuide[] = []
  if (request.spacing !== false) {
    if (!x) {
      const match = findSpacing({ axis: 'x', moving: bounds, boxes: targets.boxes, tolerance })
      if (match) {
        dx = match.delta
        spacing.push(match.guide)
      }
    }
    if (!y) {
      const match = findSpacing({ axis: 'y', moving: bounds, boxes: targets.boxes, tolerance })
      if (match) {
        dy = match.delta
        spacing.push(match.guide)
      }
    }
  }

  // Guides are built against the FINAL position, so a line is only drawn where
  // the object actually ended up.
  const settled: Rect = { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
  const epsilon = 0.5 / zoom
  const guides: Guide[] = []
  if (x && !x.fromGrid) guides.push(...guidesFor('x', settled, refsX, targets.x, epsilon))
  if (y && !y.fromGrid) guides.push(...guidesFor('y', settled, refsY, targets.y, epsilon))

  if (dx === 0 && dy === 0 && guides.length === 0 && spacing.length === 0) return NO_SNAP
  return { dx, dy, guides, spacing }
}

function refValues(bounds: Rect, axis: 'x' | 'y'): Record<RefKind, number> {
  const start = axis === 'x' ? bounds.x : bounds.y
  const size = axis === 'x' ? bounds.width : bounds.height
  return { min: start, mid: start + size / 2, max: start + size }
}

function snapAxis(
  refs: Record<RefKind, number>,
  allowed: readonly RefKind[],
  candidates: readonly SnapCandidate[],
  tolerance: number,
  grid: number | null,
): AxisSnap | null {
  let bestDelta = 0
  let bestDistance = Infinity
  let bestPriority = -1

  for (const ref of allowed) {
    const from = refs[ref]
    for (const candidate of candidates) {
      const delta = candidate.value - from
      const distance = Math.abs(delta)
      if (distance > tolerance) continue
      const priority = SNAP_PRIORITY[candidate.kind]
      // A near-tie goes to the more meaningful kind: a centre over an edge.
      const better =
        distance < bestDistance - 0.001 ||
        (distance <= bestDistance + 0.001 && priority > bestPriority)
      if (better) {
        bestDelta = delta
        bestDistance = distance
        bestPriority = priority
      }
    }
  }

  if (bestPriority >= 0) return { delta: bestDelta, fromGrid: false }

  if (grid && grid > 0) {
    const target = Math.round(refs.min / grid) * grid
    const delta = target - refs.min
    if (Math.abs(delta) <= tolerance) return { delta, fromGrid: true }
  }
  return null
}

/**
 * Every candidate the settled position now sits on — not just the winner.
 *
 * Three objects sharing a centre line should show one line touching all three.
 * Drawing only the candidate that happened to win the comparison shows a line
 * to one of them and leaves the user guessing about the rest.
 */
function guidesFor(
  axis: 'x' | 'y',
  settled: Rect,
  allowed: readonly RefKind[],
  candidates: readonly SnapCandidate[],
  epsilon: number,
): Guide[] {
  const refs = refValues(settled, axis)
  const perpStart = axis === 'x' ? settled.y : settled.x
  const perpEnd = axis === 'x' ? settled.y + settled.height : settled.x + settled.width

  const out: Guide[] = []
  const seen = new Set<string>()
  for (const ref of allowed) {
    const value = refs[ref]
    for (const candidate of candidates) {
      if (Math.abs(candidate.value - value) > epsilon) continue
      const key = `${candidate.value.toFixed(3)}:${candidate.sourceId ?? 'artboard'}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        axis,
        value: candidate.value,
        from: Math.min(candidate.from, perpStart),
        to: Math.max(candidate.to, perpEnd),
        kind: candidate.kind,
      })
    }
  }

  // Merge lines that share an x (or y) into one span, so three aligned objects
  // produce one guide rather than three stacked on the same pixel.
  const merged = new Map<string, Guide>()
  for (const g of out) {
    const key = g.value.toFixed(3)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, g)
      continue
    }
    existing.from = Math.min(existing.from, g.from)
    existing.to = Math.max(existing.to, g.to)
    if (SNAP_PRIORITY[g.kind] > SNAP_PRIORITY[existing.kind]) existing.kind = g.kind
  }
  return [...merged.values()]
}
