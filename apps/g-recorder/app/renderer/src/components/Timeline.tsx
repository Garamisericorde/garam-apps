import { useCallback, useRef } from 'react'
import { clamp } from '../../../shared/time'

interface TimelineProps {
  duration: number
  inPoint: number
  outPoint: number
  currentTime: number
  thumbnails: string[]
  loadingThumbnails: boolean
  onSeek: (seconds: number) => void
  onTrimChange: (inPoint: number, outPoint: number) => void
}

type DragTarget = 'in' | 'out' | 'playhead'

/** Smallest selection the user can drag down to */
const MIN_SELECTION_SECONDS = 0.1

/**
 * Scrubbing strip with draggable IN/OUT handles.
 *
 * Everything is expressed as a fraction of the clip duration, so the same
 * component works for a 10-second clip and a 30-minute replay.
 */
export default function Timeline({
  duration,
  inPoint,
  outPoint,
  currentTime,
  thumbnails,
  loadingThumbnails,
  onSeek,
  onTrimChange,
}: TimelineProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget | null>(null)

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration <= 0) return 0

      const rect = track.getBoundingClientRect()
      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1)
      return fraction * duration
    },
    [duration],
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

  const percent = (seconds: number): string =>
    `${duration > 0 ? clamp((seconds / duration) * 100, 0, 100) : 0}%`

  const hasClip = duration > 0

  return (
    <div
      ref={trackRef}
      className="timeline"
      onPointerDown={(event) => beginDrag('playhead', event)}
    >
      {thumbnails.length > 0 && (
        <div className="timeline-thumbs">
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
          {/* Dim everything outside the selection */}
          <div className="timeline-shade" style={{ left: 0, width: percent(inPoint) }} />
          <div
            className="timeline-shade"
            style={{ left: percent(outPoint), right: 0, width: 'auto' }}
          />

          <div
            className="timeline-selection"
            style={{
              left: percent(inPoint),
              width: `${clamp(((outPoint - inPoint) / duration) * 100, 0, 100)}%`,
            }}
          />

          <div
            className="timeline-handle"
            style={{ left: `calc(${percent(inPoint)} - 6px)` }}
            onPointerDown={(event) => beginDrag('in', event)}
            title="Drag to set the start"
          />
          <div
            className="timeline-handle"
            style={{ left: `calc(${percent(outPoint)} - 6px)` }}
            onPointerDown={(event) => beginDrag('out', event)}
            title="Drag to set the end"
          />

          <div className="timeline-playhead" style={{ left: percent(currentTime) }} />
        </>
      )}
    </div>
  )
}
