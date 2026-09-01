import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../../../shared/time'

interface TimelineProps {
  duration: number
  inPoint: number
  outPoint: number
  currentTime: number
  /** Split points, in seconds, that carve the clip into parts */
  cuts: number[]
  thumbnails: string[]
  loadingThumbnails: boolean
  onSeek: (seconds: number) => void
  onTrimChange: (inPoint: number, outPoint: number) => void
}

type DragTarget = 'in' | 'out' | 'playhead'

/** Smallest selection the user can drag down to */
const MIN_SELECTION_SECONDS = 0.1

/** Zoom bounds: 1 = whole clip in view, 60 = about a second across the strip */
const MIN_ZOOM = 1
const MAX_ZOOM = 60

/**
 * Scrubbing strip with draggable IN/OUT handles and a zoom.
 *
 * Zooming exists because the strip is the only place a cut can be placed by
 * hand, and at whole-clip scale a five-minute replay puts about two seconds
 * under every pixel — fine enough to see, far too coarse to aim at. Zoom is a
 * pure view transform: it changes which slice of the clip the strip spans, and
 * nothing about the clip itself.
 */
export default function Timeline({
  duration,
  inPoint,
  outPoint,
  currentTime,
  cuts,
  thumbnails,
  loadingThumbnails,
  onSeek,
  onTrimChange,
}: TimelineProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget | null>(null)

  const [zoom, setZoom] = useState(1)
  /** Seconds at the left edge of the strip */
  const [offset, setOffset] = useState(0)

  const visible = duration / zoom
  const maxOffset = Math.max(duration - visible, 0)

  // A shorter clip, or a zoom-out, can leave the window hanging past the end.
  useEffect(() => {
    setOffset((previous) => clamp(previous, 0, maxOffset))
  }, [maxOffset])

  /** Keep the playhead in view while it plays past the right edge */
  useEffect(() => {
    if (zoom === 1 || duration <= 0) return
    if (currentTime >= offset && currentTime <= offset + visible) return
    setOffset(clamp(currentTime - visible / 2, 0, maxOffset))
  }, [currentTime, zoom, duration, offset, visible, maxOffset])

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0

      const rect = track.getBoundingClientRect()
      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1)
      return offset + fraction * visible
    },
    [duration, offset, visible],
  )

  const applyDrag = useCallback(
    (target: DragTarget, time: number) => {
      if (target === 'playhead') {
        onSeek(clamp(time, inPoint, outPoint))
        return
      }

      if (target === 'in') {
        onTrimChange(clamp(time, 0, outPoint - MIN_SELECTION_SECONDS), outPoint)
        return
      }

      onTrimChange(inPoint, clamp(time, inPoint + MIN_SELECTION_SECONDS, duration))
    },
    [duration, inPoint, outPoint, onSeek, onTrimChange],
  )

  const beginDrag = useCallback(
    (target: DragTarget, event: React.PointerEvent): void => {
      if (duration <= 0) return

      event.preventDefault()
      event.stopPropagation()
      dragRef.current = target
      applyDrag(target, timeFromEvent(event.clientX))

      const handleMove = (moveEvent: PointerEvent): void => {
        if (!dragRef.current) return
        applyDrag(dragRef.current, timeFromEvent(moveEvent.clientX))
      }

      const handleUp = (): void => {
        dragRef.current = null
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [applyDrag, duration, timeFromEvent],
  )

  /**
   * Wheel zooms around the cursor, so the frame under the pointer stays put —
   * the same gesture every timeline and map uses, and the only one that does
   * not require re-finding your place after every step.
   */
  const handleWheel = useCallback(
    (event: React.WheelEvent): void => {
      if (duration <= 0) return
      event.preventDefault()

      const track = trackRef.current
      if (!track) return

      const rect = track.getBoundingClientRect()
      const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1)
      const anchor = offset + fraction * visible

      const next = clamp(zoom * (event.deltaY < 0 ? 1.25 : 0.8), MIN_ZOOM, MAX_ZOOM)
      const nextVisible = duration / next

      setZoom(next)
      setOffset(clamp(anchor - fraction * nextVisible, 0, Math.max(duration - nextVisible, 0)))
    },
    [duration, offset, visible, zoom],
  )

  /** Fraction of the visible window a time sits at, or null when off-screen */
  const position = (seconds: number): number => ((seconds - offset) / visible) * 100

  const hasClip = duration > 0
  const zoomed = zoom > 1

  return (
    <div className="timeline-wrap">
      <div
        ref={trackRef}
        className="timeline"
        onPointerDown={(event) => beginDrag('playhead', event)}
        onWheel={handleWheel}
      >
        {thumbnails.length > 0 && (
          <div
            className="timeline-thumbs"
            /* The strip is one image of the whole clip; zooming scales and
               slides it rather than re-rendering thumbnails at every step. */
            style={{ width: `${zoom * 100}%`, left: `${-(offset / duration) * zoom * 100}%` }}
          >
            {thumbnails.map((frame, index) => (
              <img key={index} src={frame} alt="" draggable={false} />
            ))}
          </div>
        )}

        {thumbnails.length === 0 && (
          <div className="timeline-empty">
            {!hasClip
              ? 'No clip loaded'
              : loadingThumbnails
                ? 'Building preview…'
                : 'Drag the handles to trim'}
          </div>
        )}

        {hasClip && (
          <>
            {/* What the export will leave out */}
            <div
              className="timeline-shade"
              style={{ left: 0, width: `${clamp(position(inPoint), 0, 100)}%` }}
            />
            <div
              className="timeline-shade"
              style={{ left: `${clamp(position(outPoint), 0, 100)}%`, right: 0, width: 'auto' }}
            />

            <div
              className="timeline-selection"
              style={{
                left: `${clamp(position(inPoint), 0, 100)}%`,
                width: `${clamp(position(outPoint) - position(inPoint), 0, 100)}%`,
              }}
            />

            {cuts.map((cut) => (
              <div key={cut} className="timeline-cut" style={{ left: `${position(cut)}%` }} />
            ))}

            <div
              className="timeline-handle"
              style={{ left: `calc(${clamp(position(inPoint), 0, 100)}% - 7px)` }}
              onPointerDown={(event) => beginDrag('in', event)}
              title="Drag to set the start"
            />
            <div
              className="timeline-handle"
              style={{ left: `calc(${clamp(position(outPoint), 0, 100)}% - 7px)` }}
              onPointerDown={(event) => beginDrag('out', event)}
              title="Drag to set the end"
            />

            <div className="timeline-playhead" style={{ left: `${position(currentTime)}%` }} />
          </>
        )}
      </div>

      <div className="timeline-zoom">
        <button
          className="btn btn-icon btn-ghost"
          disabled={!hasClip || zoom <= MIN_ZOOM}
          onClick={() => setZoom((z) => clamp(z / 1.6, MIN_ZOOM, MAX_ZOOM))}
          title="Zoom out (scroll down on the strip)"
        >
          −
        </button>
        <span className="small muted mono" style={{ minWidth: 46, textAlign: 'center' }}>
          {zoomed ? `${zoom.toFixed(1)}×` : 'Fit'}
        </span>
        <button
          className="btn btn-icon btn-ghost"
          disabled={!hasClip || zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => clamp(z * 1.6, MIN_ZOOM, MAX_ZOOM))}
          title="Zoom in (scroll up on the strip)"
        >
          +
        </button>
        {zoomed && (
          <button
            className="btn btn-ghost small"
            onClick={() => {
              setZoom(1)
              setOffset(0)
            }}
          >
            Fit
          </button>
        )}
      </div>
    </div>
  )
}
