/**
 * The timeline's view transform — how much of the timeline the strip spans,
 * and where that window starts.
 *
 * Shared because the strip and the transport bar both drive it: the wheel
 * zooms around the cursor, the buttons step it, and neither can be the owner
 * of a value the other one changes.
 */
export interface TimelineView {
  /**
   * Seconds across the track, or null to fit whatever is on the timeline.
   *
   * Stored as a length rather than as a zoom factor because a factor is only
   * meaningful against the content's own length — so growing the timeline, or
   * dragging a clip to the right, silently rescaled the whole view underneath
   * the drag. A window measured in seconds holds still.
   */
  visible: number | null
  /** Seconds at the left edge of the strip */
  offset: number
}

/** Zoom bounds, as seconds across the track */
export const MIN_VISIBLE_SECONDS = 0.5
export const MAX_VISIBLE_SECONDS = 6 * 60 * 60

/** What one press of − or + does; the wheel steps finer than this. */
export const ZOOM_STEP = 1.6

/**
 * How much empty track to leave past the end of the content when fitting.
 *
 * Content ending flush with the right edge looks like it continues off screen,
 * and leaves nowhere to drop anything after it.
 */
export const TAIL_FACTOR = 1.12

/** What the track spans when there is nothing on it yet */
export const EMPTY_SPAN_SECONDS = 30

export const FIT_VIEW: TimelineView = { visible: null, offset: 0 }

/** Seconds across the track for a given timeline length */
export function fitSpan(duration: number): number {
  return duration > 0 ? duration * TAIL_FACTOR : EMPTY_SPAN_SECONDS
}
