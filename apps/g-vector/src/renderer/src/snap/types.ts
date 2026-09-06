import type { NodeId } from '../doc/types'
import type { Rect } from '../doc/geom'

/**
 * What a snap latched onto. The order here is the tie-break order: when two
 * candidates sit the same distance away, the later one wins, because a centre
 * is a more deliberate alignment than an edge that merely happens to be there.
 */
export type SnapKind = 'grid' | 'edge' | 'center' | 'anchor'

export const SNAP_PRIORITY: Record<SnapKind, number> = {
  grid: 0,
  edge: 1,
  center: 2,
  anchor: 3,
}

/** One coordinate the moving object may latch onto, on one axis. */
export interface SnapCandidate {
  /** The coordinate itself, in document space. */
  value: number
  kind: SnapKind
  /**
   * The source's extent along the OTHER axis. The guide line is drawn from
   * here to the moving object, so it visibly connects the two rather than
   * floating across the whole canvas.
   */
  from: number
  to: number
  sourceId?: NodeId
}

export interface SnapTargets {
  /** Candidates for a vertical guide — a constant x. */
  x: SnapCandidate[]
  y: SnapCandidate[]
  /** World bounds of everything static, for the equal-spacing pass. */
  boxes: { id: NodeId; rect: Rect }[]
  artboard: Rect
}

export const EMPTY_TARGETS: SnapTargets = { x: [], y: [], boxes: [], artboard: { x: 0, y: 0, width: 0, height: 0 } }

/** A line the overlay draws while a snap is active. */
export interface Guide {
  axis: 'x' | 'y'
  /** Where the line sits, in document space. */
  value: number
  /** The line's span along the other axis, in document space. */
  from: number
  to: number
  kind: SnapKind
}

/** An equal-spacing hint: two or more gaps of the same size, drawn as bars. */
export interface SpacingGuide {
  axis: 'x' | 'y'
  /** The measured gap, in document units. */
  distance: number
  /** Each bar: a span on the axis, drawn at `at` on the other axis. */
  bars: { start: number; end: number; at: number }[]
}

export interface SnapResult {
  /** How far the proposal has to move to land on the snap. */
  dx: number
  dy: number
  guides: Guide[]
  spacing: SpacingGuide[]
}

export const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [], spacing: [] }

/** Which points on the moving box are allowed to latch. */
export type RefKind = 'min' | 'mid' | 'max'

export const ALL_REFS: RefKind[] = ['min', 'mid', 'max']
