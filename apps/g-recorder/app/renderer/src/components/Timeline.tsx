import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../../../shared/time'
import {
  itemDuration,
  itemEnd,
  timelineDuration,
  type LaneId,
  type Timeline as TimelineModel,
  type TimelineItem,
} from '../../../shared/timeline'
import ContextMenu from './ContextMenu'
import type { MenuPosition } from './ContextMenu'
import { fitSpan, MAX_VISIBLE_SECONDS, MIN_VISIBLE_SECONDS } from './timelineView'
import type { TimelineView } from './timelineView'

/** What a source file looks like on the lanes, once it has been examined */
export interface SourceAssets {
  thumbnails: string[]
  waveform: number[]
  durationSeconds: number
}

export interface Selection {
  lane: LaneId
  id: string
}

/** A clip on its way in, drawn where it would land */
export interface PendingDrop {
  start: number
  durationSeconds: number | null
}

interface TimelineProps {
  timeline: TimelineModel
  /** Thumbnails and waveforms, by source path */
  assets: Record<string, SourceAssets>
  /** Playhead, in timeline seconds */
  currentTime: number
  selected: Selection | null
  loadingThumbnails: boolean
  /** Whether edges pull into line with each other while dragging */
  snap: boolean
  view: TimelineView
  drop: PendingDrop | null

  onSelect: (selection: Selection | null) => void
  onSeek: (seconds: number) => void
  onMove: (lane: LaneId, id: string, start: number) => void
  /** A gesture is about to start changing things, so it can be undone as one */
  onEditBegin: () => void
  onRemove: (lane: LaneId, id: string) => void
  /** Cut at the playhead; `bothLanes` false cuts only the lane clicked */
  onSplit: (lane: LaneId, bothLanes: boolean) => void
  onViewChange: (view: TimelineView) => void
}

interface Drag {
  lane: LaneId
  id: string
  /** Where inside the item the grab landed, so it does not jump to the cursor */
  grab: number
}

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
 * — the thing you do far more often than rearranging.
 */
const DRAG_THRESHOLD_PX = 4

/**
 * The editor's two lanes.
 *
 * Each lane holds its own list of clips, separate from the moment one is added
 * — no "detach audio" step. That is what lets a cut land on one lane without
 * touching the other, and what makes a split produce two clips rather than one
 * clip with a line drawn on it.
 */
export default function Timeline({
  timeline,
  assets,
  currentTime,
  selected,
  loadingThumbnails,
  snap,
  view,
  drop,
  onSelect,
  onSeek,
  onMove,
  onEditBegin,
  onRemove,
  onSplit,
  onViewChange,
}: TimelineProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  const [menu, setMenu] = useState<{ at: MenuPosition; target: Selection } | null>(null)
  /** The edge a moving clip has locked onto, drawn while it holds */
  const [snapAt, setSnapAt] = useState<number | null>(null)

  const { offset } = view
  const duration = timelineDuration(timeline)

  /*
   * The scale is frozen for the length of a drag.
   *
   * While fitting, the span follows the content — and dragging a clip to the
   * right makes the content longer, so the view was rescaling under the pointer
   * as it moved. Clips appeared to shrink and the other lane appeared to slide
   * the other way, all while the model was only changing one number.
   */
  const frozenSpan = useRef<number | null>(null)
  const span = frozenSpan.current ?? fitSpan(duration)

  /*
   * Track, view and content are three different lengths. Keeping them apart is
   * what lets the wheel pull back into empty track instead of stopping dead at
   * the last frame, and what leaves room to drop a clip after the end.
   */
  const visible = view.visible ?? span
  const maxOffset = Math.max(span - visible, 0)

  // A shorter timeline, or a zoom-out, can leave the window hanging past the end.
  useEffect(() => {
    const clamped = clamp(offset, 0, maxOffset)
    if (clamped !== offset) onViewChange({ visible: view.visible, offset: clamped })
  }, [maxOffset, offset, view.visible, onViewChange])

  /** Keep the playhead in view while it plays past the right edge */
  useEffect(() => {
    if (view.visible === null || duration <= 0) return
    if (currentTime >= offset && currentTime <= offset + visible) return
    onViewChange({ visible: view.visible, offset: clamp(currentTime - visible / 2, 0, maxOffset) })
  }, [currentTime, duration, offset, view.visible, visible, maxOffset, onViewChange])

  /** Fraction of the visible window a time sits at */
  const position = useCallback(
    (seconds: number): number => ((seconds - offset) / visible) * 100,
    [offset, visible],
  )

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const element = trackRef.current
      if (!element) return 0
      const rect = element.getBoundingClientRect()
      return offset + ((clientX - rect.left) / rect.width) * visible
    },
    [offset, visible],
  )

  /** Seconds in one pixel of track, for distances that are really gestures */
  const secondsPerPixel = useCallback((): number => {
    const width = trackRef.current?.getBoundingClientRect().width ?? 0
    return width > 0 ? visible / width : 0
  }, [visible])

  /**
   * Every edge a dragged clip is allowed to land on.
   *
   * Both lanes, not only its own: lining audio up with a picture edge is the
   * whole reason snapping exists here. The clip being dragged is left out, or
   * it would snap to where it already is.
   */
  const snapTargets = useCallback(
    (exclude: string): number[] => {
      const edges: number[] = [0, currentTime]
      for (const lane of ['video', 'audio'] as LaneId[]) {
        for (const item of timeline[lane]) {
          if (item.id === exclude) continue
          edges.push(item.start, itemEnd(item))
        }
      }
      return edges
    },
    [currentTime, timeline],
  )

  /** Pull a value onto the nearest edge, when one is close enough */
  const pull = useCallback(
    (values: number[], exclude: string): { delta: number; at: number | null } => {
      if (!snap) return { delta: 0, at: null }

      const tolerance = SNAP_PX * secondsPerPixel()
      if (tolerance <= 0) return { delta: 0, at: null }

      let best: { delta: number; at: number } | null = null
      for (const value of values) {
        for (const candidate of snapTargets(exclude)) {
          const delta = candidate - value
          if (Math.abs(delta) > tolerance) continue
          if (best && Math.abs(delta) >= Math.abs(best.delta)) continue
          best = { delta, at: candidate }
        }
      }

      return best ?? { delta: 0, at: null }
    },
    [secondsPerPixel, snap, snapTargets],
  )

  const applyDrag = useCallback(
    (drag: Drag, time: number): void => {
      const item = timeline[drag.lane].find((candidate) => candidate.id === drag.id)
      if (!item) return

      const start = Math.max(0, time - drag.grab)
      const { delta, at } = pull([start, start + itemDuration(item)], item.id)
      setSnapAt(at)
      onMove(drag.lane, drag.id, Math.max(0, start + delta))
    },
    [onMove, pull, timeline],
  )

  /** Follow the pointer until it is released, then clean up after it */
  const follow = useCallback(
    (onPointerMove: (event: PointerEvent) => void, onDone?: () => void): void => {
      // Hold the scale still for the length of the gesture, so what is under
      // the pointer stays under the pointer.
      frozenSpan.current = span

      const handleMove = (event: PointerEvent): void => onPointerMove(event)
      const handleUp = (): void => {
        dragRef.current = null
        frozenSpan.current = null
        setSnapAt(null)
        onDone?.()
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [span],
  )

  /**
   * A press on a clip: a click seeks, a drag moves.
   *
   * Which one it is cannot be known at pointerdown, so nothing happens until
   * the pointer either travels far enough to be a drag or is released without
   * having done so.
   */
  const pressItem = useCallback(
    (lane: LaneId, item: TimelineItem, event: React.PointerEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      onSelect({ lane, id: item.id })

      const downX = event.clientX
      const downTime = timeFromEvent(event.clientX)
      const drag: Drag = { lane, id: item.id, grab: downTime - item.start }
      let moved = false

      follow(
        (moveEvent) => {
          if (!moved) {
            if (Math.abs(moveEvent.clientX - downX) < DRAG_THRESHOLD_PX) return
            moved = true
            dragRef.current = drag
            // One entry for the whole drag, not one per pointer move.
            onEditBegin()
          }
          applyDrag(drag, timeFromEvent(moveEvent.clientX))
        },
        () => {
          if (!moved) onSeek(Math.max(0, downTime))
        },
      )
    },
    [applyDrag, follow, onEditBegin, onSeek, onSelect, timeFromEvent],
  )

  /** Scrubbing on empty track, which is also how you seek past the last clip */
  const pressTrack = useCallback(
    (event: React.PointerEvent): void => {
      onSelect(null)
      onSeek(Math.max(0, timeFromEvent(event.clientX)))
      follow((moveEvent) => onSeek(Math.max(0, timeFromEvent(moveEvent.clientX))))
    },
    [follow, onSeek, onSelect, timeFromEvent],
  )

  /**
   * Wheel zooms around the cursor, so the frame under the pointer stays put —
   * the same gesture every timeline and map uses, and the only one that does
   * not require re-finding your place after every step.
   */
  const handleWheel = useCallback(
    (event: React.WheelEvent): void => {
      event.preventDefault()

      const element = trackRef.current
      if (!element) return

      const rect = element.getBoundingClientRect()
      const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1)
      const anchor = offset + fraction * visible

      const nextVisible = clamp(
        visible * (event.deltaY < 0 ? 0.8 : 1.25),
        MIN_VISIBLE_SECONDS,
        MAX_VISIBLE_SECONDS,
      )

      onViewChange({
        visible: nextVisible,
        offset: clamp(anchor - fraction * nextVisible, 0, Math.max(span - nextVisible, 0)),
      })
    },
    [offset, span, visible, onViewChange],
  )

  const menuItems = menu
    ? [
        {
          label: 'Split at the playhead',
          onSelect: () => onSplit(menu.target.lane, true),
        },
        {
          label: menu.target.lane === 'audio' ? 'Split audio only' : 'Split video only',
          onSelect: () => onSplit(menu.target.lane, false),
        },
        {
          label: menu.target.lane === 'audio' ? 'Remove audio clip' : 'Remove clip',
          destructive: true,
          onSelect: () => onRemove(menu.target.lane, menu.target.id),
        },
      ]
    : []

  const renderItem = (lane: LaneId, item: TimelineItem): JSX.Element => {
    const asset = assets[item.path]
    const length = itemDuration(item)
    const isSelected = selected?.lane === lane && selected.id === item.id

    /*
     * The strip covers the whole source and is clipped to the item. Trimming
     * then slides the picture behind a narrower window rather than rebuilding
     * thumbnails, so the frames stay put under the pointer.
     */
    const sourceWidth = asset ? (asset.durationSeconds / Math.max(length, 0.001)) * 100 : 100
    const sourceLeft = asset
      ? (-item.sourceIn / Math.max(asset.durationSeconds, 0.001)) * sourceWidth
      : 0

    return (
      <div
        key={item.id}
        className={`clip${isSelected ? ' is-selected' : ''}`}
        style={{ left: `${position(item.start)}%`, width: `${(length / visible) * 100}%` }}
        onPointerDown={(event) => pressItem(lane, item, event)}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSelect({ lane, id: item.id })
          setMenu({ at: { x: event.clientX, y: event.clientY }, target: { lane, id: item.id } })
        }}
        title="Click to play from here · drag to move"
      >
        <div className="clip-inner">
          {lane === 'video' &&
            (asset && asset.thumbnails.length > 0 ? (
              <div
                className="clip-thumbs"
                style={{ width: `${sourceWidth}%`, left: `${sourceLeft}%` }}
              >
                {asset.thumbnails.map((frame, index) => (
                  <img key={index} src={frame} alt="" draggable={false} />
                ))}
              </div>
            ) : (
              <span className="clip-label">
                {loadingThumbnails ? 'Building preview…' : baseName(item.path)}
              </span>
            ))}

          {lane === 'audio' &&
            (asset && asset.waveform.length > 0 ? (
              <div
                className="clip-wave"
                style={{ width: `${sourceWidth}%`, left: `${sourceLeft}%` }}
              >
                {asset.waveform.map((peak, index) => (
                  <span key={index} style={{ height: `${Math.max(peak * 100, 2)}%` }} />
                ))}
              </div>
            ) : (
              <span className="clip-label">{baseName(item.path)}</span>
            ))}
        </div>
      </div>
    )
  }

  const isEmpty = timeline.video.length === 0 && timeline.audio.length === 0

  return (
    <div className="timeline-wrap">
      <ContextMenu position={menu?.at ?? null} items={menuItems} onClose={() => setMenu(null)} />

      <div className="lanes" onWheel={handleWheel}>
        <div className="lane-gutter">
          <span className="lane-badge" title="Video">
            🎞
          </span>
          <span className="lane-badge" title="Audio">
            🔊
          </span>
        </div>

        <div className="lane-stack" ref={trackRef}>
          <div className="lane lane-video" onPointerDown={pressTrack}>
            {timeline.video.map((item) => renderItem('video', item))}
            {isEmpty && <div className="timeline-empty">No clip loaded</div>}
          </div>

          <div className="lane lane-audio" onPointerDown={pressTrack}>
            {timeline.audio.map((item) => renderItem('audio', item))}
          </div>

          {/* Where a dropped clip would land, and how much room it would take */}
          {drop && (
            <div
              className={`drop-ghost${drop.durationSeconds === null ? ' is-thin' : ''}`}
              style={{
                left: `${position(drop.start)}%`,
                width:
                  drop.durationSeconds !== null
                    ? `${(drop.durationSeconds / visible) * 100}%`
                    : undefined,
              }}
            />
          )}

          {/* One playhead across both, because there is one moment in time. */}
          <div className="lane-playhead" style={{ left: `${position(currentTime)}%` }} />

          {snapAt !== null && <div className="lane-snap" style={{ left: `${position(snapAt)}%` }} />}
        </div>
      </div>
    </div>
  )
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
