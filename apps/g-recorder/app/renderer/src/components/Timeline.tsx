import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../../../shared/time'
import ContextMenu from './ContextMenu'
import type { MenuPosition } from './ContextMenu'

interface TimelineProps {
  duration: number
  inPoint: number
  outPoint: number
  currentTime: number
  /** Split points, in seconds, that carve the clip into parts */
  cuts: number[]
  thumbnails: string[]
  loadingThumbnails: boolean
  /** Peak levels across the clip's audio; empty when it has none */
  waveform: number[]
  /** The audio lane's own window, which can be trimmed away from the video */
  audioIn: number
  audioOut: number
  selectedLane: Lane
  onSelectLane: (lane: Lane) => void
  onAudioTrimChange: (inPoint: number, outPoint: number) => void
  /** Drop a lane's content: the audio is silenced, the video cleared */
  onRemoveLane: (lane: Lane) => void
  onResetLane: (lane: Lane) => void
  onSeek: (seconds: number) => void
  onTrimChange: (inPoint: number, outPoint: number) => void
}

type DragTarget = 'in' | 'out' | 'audio-in' | 'audio-out' | 'playhead'
export type Lane = 'video' | 'audio'

/** Smallest selection the user can drag down to */
const MIN_SELECTION_SECONDS = 0.1

/**
 * Zoom bounds. 1 fits the clip with its tail; below that the view keeps opening
 * past the end, which is how room is made for material that is not there yet.
 */
const MIN_ZOOM = 0.2
const MAX_ZOOM = 60

/**
 * How much empty track to leave past the end of the clip at Fit.
 *
 * A clip ending flush with the right edge looks like it continues off screen,
 * and leaves nowhere to put anything after it.
 */
const TAIL_FACTOR = 1.12

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
  waveform,
  audioIn,
  audioOut,
  selectedLane,
  onSelectLane,
  onAudioTrimChange,
  onRemoveLane,
  onResetLane,
  onSeek,
  onTrimChange,
}: TimelineProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget | null>(null)

  const [menu, setMenu] = useState<{ at: MenuPosition; lane: Lane } | null>(null)
  const [zoom, setZoom] = useState(1)
  /** Seconds at the left edge of the strip */
  const [offset, setOffset] = useState(0)

  /*
   * Track, view and clip are three different lengths. Keeping them apart is
   * what lets the wheel pull back into empty track instead of stopping dead at
   * the last frame.
   */
  const span = duration > 0 ? duration * TAIL_FACTOR : 1
  const visible = span / zoom
  const maxOffset = Math.max(span - visible, 0)

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

      if (target === 'out') {
        onTrimChange(inPoint, clamp(time, inPoint + MIN_SELECTION_SECONDS, duration))
        return
      }

      if (target === 'audio-in') {
        onAudioTrimChange(clamp(time, 0, audioOut - MIN_SELECTION_SECONDS), audioOut)
        return
      }

      onAudioTrimChange(audioIn, clamp(time, audioIn + MIN_SELECTION_SECONDS, duration))
    },
    [audioIn, audioOut, duration, inPoint, outPoint, onAudioTrimChange, onSeek, onTrimChange],
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
      const nextVisible = span / next

      setZoom(next)
      setOffset(clamp(anchor - fraction * nextVisible, 0, Math.max(span - nextVisible, 0)))
    },
    [duration, offset, span, visible, zoom],
  )

  /** Fraction of the visible window a time sits at, or null when off-screen */
  const position = (seconds: number): number => ((seconds - offset) / visible) * 100

  const hasClip = duration > 0
  const zoomed = zoom > 1

  /** One lane's shading, selection, handles and cuts — the two differ only in
   *  which window they draw and which lane a drag edits. */
  const laneOverlay = (lane: Lane, from: number, to: number): JSX.Element => (
    <>
      <div
        className="timeline-shade"
        style={{ left: 0, width: `${clamp(position(from), 0, 100)}%` }}
      />
      <div
        className="timeline-shade"
        style={{
          left: `${clamp(position(to), 0, 100)}%`,
          // Stops at the end of the clip: past that there is nothing to
          // discard, and shading it would read as trimmed-away footage.
          width: `${clamp(position(duration) - position(to), 0, 100)}%`,
        }}
      />

      <div
        className="timeline-selection"
        style={{
          left: `${clamp(position(from), 0, 100)}%`,
          width: `${clamp(position(to) - position(from), 0, 100)}%`,
        }}
      />

      {cuts.map((cut) => (
        <div key={cut} className="timeline-cut" style={{ left: `${position(cut)}%` }} />
      ))}

      <div
        className="timeline-handle"
        style={{ left: `calc(${clamp(position(from), 0, 100)}% - 7px)` }}
        onPointerDown={(event) => beginDrag(lane === 'video' ? 'in' : 'audio-in', event)}
        title="Drag to set the start"
      />
      <div
        className="timeline-handle"
        style={{ left: `calc(${clamp(position(to), 0, 100)}% - 7px)` }}
        onPointerDown={(event) => beginDrag(lane === 'video' ? 'out' : 'audio-out', event)}
        title="Drag to set the end"
      />
    </>
  )

  const laneMenu = menu
    ? [
        {
          label: menu.lane === 'audio' ? 'Reset audio trim' : 'Reset trim',
          onSelect: () => onResetLane(menu.lane),
        },
        {
          label: menu.lane === 'audio' ? 'Remove audio' : 'Remove clip',
          destructive: true,
          onSelect: () => onRemoveLane(menu.lane),
        },
      ]
    : []

  return (
    <div className="timeline-wrap">
      <ContextMenu position={menu?.at ?? null} items={laneMenu} onClose={() => setMenu(null)} />
      {/*
        * Two lanes, not one strip with a waveform painted into it. They carry
        * the same seconds but are edited apart, and a lane you can select is
        * the only way that difference is visible before it is exported.
        */}
      <div className="lanes" onWheel={handleWheel}>
        <div className="lane-gutter">
          <button
            className={`lane-badge${selectedLane === 'video' ? ' is-selected' : ''}`}
            onClick={() => onSelectLane('video')}
            title="Video lane"
          >
            🎞
          </button>
          {waveform.length > 0 && (
            <button
              className={`lane-badge${selectedLane === 'audio' ? ' is-selected' : ''}`}
              onClick={() => onSelectLane('audio')}
              title="Audio lane"
            >
              🔊
            </button>
          )}
        </div>

        <div className="lane-stack" ref={trackRef}>
          <div
            className={`lane lane-video${selectedLane === 'video' ? ' is-selected' : ''}`}
            onPointerDown={(event) => {
              onSelectLane('video')
              beginDrag('playhead', event)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onSelectLane('video')
              setMenu({ at: { x: event.clientX, y: event.clientY }, lane: 'video' })
            }}
          >
            {thumbnails.length > 0 && (
              <div
                className="timeline-thumbs"
                /* The strip covers the clip, not the whole track: zooming scales
                   and slides it rather than re-rendering thumbnails, and the
                   space past the end stays deliberately empty. */
                style={{ width: `${(duration / visible) * 100}%`, left: `${position(0)}%` }}
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

            {hasClip && laneOverlay('video', inPoint, outPoint)}
          </div>

          {waveform.length > 0 && (
            <div
              className={`lane lane-audio${selectedLane === 'audio' ? ' is-selected' : ''}`}
              onPointerDown={(event) => {
                onSelectLane('audio')
                beginDrag('playhead', event)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                onSelectLane('audio')
                setMenu({ at: { x: event.clientX, y: event.clientY }, lane: 'audio' })
              }}
            >
              <div
                className="timeline-audio"
                style={{ width: `${(duration / visible) * 100}%`, left: `${position(0)}%` }}
              >
                {waveform.map((peak, index) => (
                  <span key={index} style={{ height: `${Math.max(peak * 100, 2)}%` }} />
                ))}
              </div>

              {hasClip && laneOverlay('audio', audioIn, audioOut)}
            </div>
          )}

          {/* One playhead across both, because there is one moment in time. */}
          {hasClip && (
            <div className="lane-playhead" style={{ left: `${position(currentTime)}%` }} />
          )}
        </div>
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
