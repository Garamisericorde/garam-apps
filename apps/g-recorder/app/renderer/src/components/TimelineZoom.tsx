import { clamp } from '../../../shared/time'
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from './timelineView'
import type { TimelineView } from './timelineView'

/**
 * The timeline's zoom, as three small controls.
 *
 * It rides in the transport bar rather than in a row of its own under the
 * strip: it is three buttons and a number, and a full row of the window's
 * height for that is a poor trade against seeing more of the clip.
 */
export default function TimelineZoom({
  view,
  disabled,
  onChange,
  snap,
  onSnapChange,
}: {
  view: TimelineView
  disabled: boolean
  onChange: (view: TimelineView) => void
  /** Whether dragged edges pull into line with each other */
  snap: boolean
  onSnapChange: (snap: boolean) => void
}): JSX.Element {
  const step = (factor: number): void =>
    onChange({ ...view, zoom: clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM) })

  return (
    <div className="timeline-zoom">
      <button
        className="zoom-btn"
        disabled={disabled || view.zoom <= MIN_ZOOM}
        onClick={() => step(1 / ZOOM_STEP)}
        title="Zoom out (scroll down on the strip)"
      >
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="9" cy="9" r="5.2" />
          <path d="M12.9 12.9 16.5 16.5M6.6 9h4.8" />
        </svg>
      </button>

      {/* Clicking the readout is the fastest way back to the whole clip */}
      <button
        className="zoom-readout mono"
        disabled={disabled || view.zoom === 1}
        onClick={() => onChange({ zoom: 1, offset: 0 })}
        title="Fit the whole clip"
      >
        {view.zoom > 1 ? `${view.zoom.toFixed(1)}×` : 'Fit'}
      </button>

      <button
        className="zoom-btn"
        disabled={disabled || view.zoom >= MAX_ZOOM}
        onClick={() => step(ZOOM_STEP)}
        title="Zoom in (scroll up on the strip)"
      >
        <svg viewBox="0 0 20 20" aria-hidden>
          <circle cx="9" cy="9" r="5.2" />
          <path d="M12.9 12.9 16.5 16.5M6.6 9h4.8M9 6.6v4.8" />
        </svg>
      </button>

      {/* A magnet, the way every editor draws this, and it stays lit while on
          so the state is readable without hovering for a tooltip. */}
      <button
        className={`zoom-btn${snap ? ' is-on' : ''}`}
        onClick={() => onSnapChange(!snap)}
        title={snap ? 'Snapping on — edges pull into line' : 'Snapping off'}
      >
        <svg viewBox="0 0 20 20" aria-hidden>
          <path d="M6 4v6a4 4 0 0 0 8 0V4" />
          <path d="M4 4h4M12 4h4M4 9h4M12 9h4" />
        </svg>
      </button>
    </div>
  )
}
