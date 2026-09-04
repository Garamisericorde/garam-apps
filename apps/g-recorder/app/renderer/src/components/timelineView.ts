/**
 * The timeline's view transform — how much of the clip the strip spans, and
 * where that window starts.
 *
 * Shared because the strip and the transport bar both drive it: the wheel zooms
 * around the cursor, the buttons step it, and neither can be the owner of a
 * value the other one changes.
 */
export interface TimelineView {
  /** 1 fits the clip with its tail; higher shows less of it */
  zoom: number
  /** Seconds at the left edge of the strip */
  offset: number
}

/**
 * Zoom bounds. Below 1 the view keeps opening past the end, which is how room
 * is made for material that is not there yet.
 */
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 60

/** What one press of − or + does; the wheel steps finer than this. */
export const ZOOM_STEP = 1.6

/**
 * How much empty track to leave past the end of the clip at Fit.
 *
 * A clip ending flush with the right edge looks like it continues off screen,
 * and leaves nowhere to put anything after it.
 */
export const TAIL_FACTOR = 1.12

export const FIT_VIEW: TimelineView = { zoom: 1, offset: 0 }
