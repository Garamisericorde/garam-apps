import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../../../shared/time'
import ContextMenu from './ContextMenu'
import type { MenuPosition } from './ContextMenu'
import { MAX_ZOOM, MIN_ZOOM, TAIL_FACTOR } from './timelineView'
import type { TimelineView } from './timelineView'

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
  /** Where each lane's source zero sits on the timeline, in seconds */
  videoStart: number
  audioStart: number
  /** Slide a whole lane along the timeline */
  onLaneMove: (lane: Lane, start: number) => void
  /** Whether edges pull into line with each other while dragging */
  snap: boolean
  onSeek: (seconds: number) => void
  onTrimChange: (inPoint: number, outPoint: number) => void
  /* The view is held above this: the transport bar's zoom controls change the
     same window the wheel does, so neither can own it. */
  view: TimelineView
  onViewChange: (view: TimelineView) => void
}

type DragTarget = 'in' | 'out' | 'audio-in' | 'audio-out' | 'playhead' | 'video-body' | 'audio-body'

/**
 * How close two edges must come before one snaps to the other, in pixels.
 *
 * Pixels rather than seconds on purpose: it has to feel the same at every
 * zoom, and what "close" means is a property of the hand, not of the clip.
 */
const SNAP_PX = 8

/**
 * How far the pointer must travel before a press on a clip becomes a move.
 *
 * Below it the press is a click, and a click on a clip means "play from here"
 * — the thing you do far more often than rearranging. Without a threshold
 * every attempt to seek nudges the clip a few milliseconds instead.
 */
const DRAG_THRESHOLD_PX = 4
export type Lane = 'video' | 'audio'

/** Smallest selection the user can drag down to */
const MIN_SELECTION_SECONDS = 0.1

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
  videoStart,
  audioStart,
  onLaneMove,
  snap,
  onAudioTrimChange,
  onRemoveLane,
  onResetLane,
  onSeek,
  onTrimChange,
  view,
  onViewChange,
}: TimelineProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragTarget | null>(null)

  const [menu, setMenu] = useState<{ at: MenuPosition; lane: Lane } | null>(null)
  const { zoom, offset } = view

  /** Where the grab landed inside the clip, so it does not jump to the cursor */
  const grabRef = useRef(0)
  /** The edge a move has snapped to, drawn while it holds */
  const [snapAt, setSnapAt] = useState<number | null>(null)

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
    const clamped = clamp(offset, 0, maxOffset)
    if (clamped !== offset) onViewChange({ zoom, offset: clamped })
  }, [maxOffset, offset, zoom, onViewChange])

  /** Keep the playhead in view while it plays past the right edge */
  useEffect(() => {
    if (zoom === 1 || duration <= 0) return
    if (currentTime >= offset && currentTime <= offset + visible) return
    onViewChange({ zoom, offset: clamp(currentTime - visible / 2, 0, maxOffset) })
  }, [currentTime, zoom, duration, offset, visible, maxOffset, onViewChange])

  /** Seconds in one pixel of track, for distances that are really gestures */
  const secondsPerPixel = useCallback((): number => {
    const width = trackRef.current?.getBoundingClientRect().width ?? 0
    return width > 0 ? visible / width : 0
  }, [visible])

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

  /**
   * Pull a moving lane into line with the other one.
   *
   * Both edges are candidates against both of the other lane's edges, and
   * against the timeline's own zero — the three places an edge is ever meant
   * to land. The smallest pull inside the threshold wins, so a clip dropped
   * near a boundary sits exactly on it rather than a frame off.
   */
  const snapStart = useCallback(
    (lane: Lane, start: number): { start: number; at: number | null } => {
      if (!snap) return { start, at: null }

      const tolerance = SNAP_PX * secondsPerPixel()
      if (tolerance <= 0) return { start, at: null }

      const [from, to] =
        lane === 'video' ? [inPoint, outPoint] : [audioIn, audioOut]
      const other =
        lane === 'video'
          ? [audioStart + audioIn, audioStart + audioOut]
          : [videoStart + inPoint, videoStart + outPoint]

      let best: { start: number; at: number } | null = null
      for (const edge of [start + from, start + to]) {
        for (const candidate of [...other, 0]) {
          const delta = candidate - edge
          if (Math.abs(delta) > tolerance) continue
          if (best && Math.abs(delta) >= Math.abs(best.start - start)) continue
          best = { start: start + delta, at: candidate }
        }
      }

      return best ?? { start, at: null }
    },
    [audioIn, audioOut, audioStart, inPoint, outPoint, secondsPerPixel, snap, videoStart],
  )

  const applyDrag = useCallback(
    (target: DragTarget, time: number) => {
      if (target === 'playhead') {
        onSeek(clamp(time - videoStart, inPoint, outPoint))
        return
      }

      if (target === 'video-body' || target === 'audio-body') {
        const lane: Lane = target === 'video-body' ? 'video' : 'audio'
        const snapped = snapStart(lane, time - grabRef.current)
        setSnapAt(snapped.at)
        onLaneMove(lane, snapped.start)
        return
      }

      if (target === 'in') {
        const local = time - videoStart
        onTrimChange(clamp(local, 0, outPoint - MIN_SELECTION_SECONDS), outPoint)
        return
      }

      if (target === 'out') {
        const local = time - videoStart
        onTrimChange(inPoint, clamp(local, inPoint + MIN_SELECTION_SECONDS, duration))
        return
      }

      if (target === 'audio-in') {
        const local = time - audioStart
        onAudioTrimChange(clamp(local, 0, audioOut - MIN_SELECTION_SECONDS), audioOut)
        return
      }

      const local = time - audioStart
      onAudioTrimChange(audioIn, clamp(local, audioIn + MIN_SELECTION_SECONDS, duration))
    },
    [
      audioIn,
      audioOut,
      audioStart,
      duration,
      inPoint,
      outPoint,
      onAudioTrimChange,
      onLaneMove,
      onSeek,
      onTrimChange,
      snapStart,
      videoStart,
    ],
  )

  /**
   * A press on a clip body: a click seeks, a drag moves.
   *
   * Which one it was cannot be known at pointerdown, so nothing happens until
   * the pointer either travels far enough to be a drag or is released without
   * having done so.
   */
  const beginBodyPress = useCallback(
    (lane: Lane, event: React.PointerEvent): void => {
      if (duration <= 0) return

      event.preventDefault()
      event.stopPropagation()

      const target: DragTarget = lane === 'video' ? 'video-body' : 'audio-body'
      const downX = event.clientX
      const downTime = timeFromEvent(event.clientX)
      grabRef.current = downTime - (lane === 'video' ? videoStart : audioStart)
      let moved = false

      const handleMove = (moveEvent: PointerEvent): void => {
        if (!moved) {
          if (Math.abs(moveEvent.clientX - downX) < DRAG_THRESHOLD_PX) return
          moved = true
          dragRef.current = target
        }
        applyDrag(target, timeFromEvent(moveEvent.clientX))
      }

      const handleUp = (): void => {
        if (!moved) applyDrag('playhead', downTime)
        dragRef.current = null
        setSnapAt(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [applyDrag, audioStart, duration, timeFromEvent, videoStart],
  )

  const beginDrag = useCallback(
    (target: DragTarget, event: React.PointerEvent): void => {
      if (duration <= 0) return

      event.preventDefault()
      event.stopPropagation()
      dragRef.current = target

      /*
       * A body drag keeps the grip where it was taken. Without this the clip
       * jumps so its source zero lands under the cursor, which throws away the
       * position the user was aiming from.
       */
      if (target === 'video-body' || target === 'audio-body') {
        const start = target === 'video-body' ? videoStart : audioStart
        grabRef.current = timeFromEvent(event.clientX) - start
      }

      applyDrag(target, timeFromEvent(event.clientX))

      const handleMove = (moveEvent: PointerEvent): void => {
        if (!dragRef.current) return
        applyDrag(dragRef.current, timeFromEvent(moveEvent.clientX))
      }

      const handleUp = (): void => {
        dragRef.current = null
        setSnapAt(null)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [applyDrag, audioStart, duration, timeFromEvent, videoStart],
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

      onViewChange({
        zoom: next,
        offset: clamp(anchor - fraction * nextVisible, 0, Math.max(span - nextVisible, 0)),
      })
    },
    [duration, offset, span, visible, zoom, onViewChange],
  )

  /** Fraction of the visible window a time sits at, or null when off-screen */
  const position = (seconds: number): number => ((seconds - offset) / visible) * 100

  const hasClip = duration > 0

  /**
   * One lane's body: what is kept, what is trimmed away, and the handles.
   *
   * Everything is drawn against the lane's own start, so the two lanes can sit
   * at different places on the timeline and still each describe their own clip.
   */
  const laneOverlay = (lane: Lane, start: number, from: number, to: number): JSX.Element => {
    const left = clamp(position(start + from), 0, 100)
    const right = clamp(position(start + to), 0, 100)

    return (
      <>
        <div
          className="timeline-shade"
          style={{
            left: `${clamp(position(start), 0, 100)}%`,
            width: `${Math.max(left - clamp(position(start), 0, 100), 0)}%`,
          }}
        />
        <div
          className="timeline-shade"
          style={{
            left: `${right}%`,
            // Stops at the end of the clip: past that there is nothing to
            // discard, and shading it would read as trimmed-away footage.
            width: `${clamp(position(start + duration) - right, 0, 100)}%`,
          }}
        />

        {/* The body is the grip. Dragging it slides the whole lane, which is
            the one gesture an editor has that a trimmer does not. */}
        <div
          className="timeline-body"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 0)}%` }}
          onPointerDown={(event) => {
            onSelectLane(lane)
            beginBodyPress(lane, event)
          }}
          title="Click to play from here · drag to move this clip"
        />

        {cuts.map((cut) => (
          <div key={cut} className="timeline-cut" style={{ left: `${position(start + cut)}%` }}>
            <span className="timeline-cut-mark" />
          </div>
        ))}

        <div
          className="timeline-handle"
          style={{ left: `calc(${left}% - 7px)` }}
          onPointerDown={(event) => beginDrag(lane === 'video' ? 'in' : 'audio-in', event)}
          title="Drag to set the start"
        />
        <div
          className="timeline-handle"
          style={{ left: `calc(${right}% - 7px)` }}
          onPointerDown={(event) => beginDrag(lane === 'video' ? 'out' : 'audio-out', event)}
          title="Drag to set the end"
        />
      </>
    )
  }

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
                style={{
                  width: `${(duration / visible) * 100}%`,
                  left: `${position(videoStart)}%`,
                }}
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

            {hasClip && laneOverlay('video', videoStart, inPoint, outPoint)}
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
                style={{
                  width: `${(duration / visible) * 100}%`,
                  left: `${position(audioStart)}%`,
                }}
              >
                {waveform.map((peak, index) => (
                  <span key={index} style={{ height: `${Math.max(peak * 100, 2)}%` }} />
                ))}
              </div>

              {hasClip && laneOverlay('audio', audioStart, audioIn, audioOut)}
            </div>
          )}

          {/* One playhead across both, because there is one moment in time. */}
          {hasClip && (
            <div
              className="lane-playhead"
              style={{ left: `${position(videoStart + currentTime)}%` }}
            />
          )}

          {/* The line a moving clip has locked onto, drawn only while it holds */}
          {snapAt !== null && (
            <div className="lane-snap" style={{ left: `${position(snapAt)}%` }} />
          )}
        </div>
      </div>
    </div>
  )
}
