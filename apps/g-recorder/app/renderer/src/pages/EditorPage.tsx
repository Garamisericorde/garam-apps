import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppSettings, MediaInfo } from '../../../shared/types'
import { formatBytes, formatTime } from '../../../shared/time'
import {
  appendClip,
  EMPTY_TIMELINE,
  itemAt,
  itemDuration,
  moveItem,
  removeItem,
  sortLane,
  sourceTimeAt,
  splitAt,
  timelineDuration,
  trimItem,
  type LaneId,
  type Timeline as TimelineModel,
  type TimelineItem,
} from '../../../shared/timeline'
import VideoPlayer from '../components/VideoPlayer'
import type { VideoPlayerHandle } from '../components/VideoPlayer'
import Timeline from '../components/Timeline'
import type { PendingDrop, Selection, SourceAssets } from '../components/Timeline'
import TrimControls from '../components/TrimControls'
import { fitSpan, FIT_VIEW } from '../components/timelineView'
import type { TimelineView } from '../components/timelineView'
import PresetPicker from '../components/PresetPicker'
import MediaLibrary from '../components/MediaLibrary'
import type { ExportControl } from '../components/PresetPicker'
import { DEFAULT_EDITOR_KEYS } from '../../../shared/hotkeyDefaults'

/** null is a key the user has cleared, which is not the same as unset */
interface EditorKeys {
  editorKeyPlayPause: string | null
  editorKeyCutStart: string | null
  editorKeyCutEnd: string | null
  editorKeySplit: string | null
  editorKeyFullscreen: string | null
}

/**
 * Whether a keypress is the configured key.
 *
 * Case-insensitive, and "Space" names the key the spacebar sends — which is a
 * single space, and would be invisible in a settings field.
 */
function matches(event: KeyboardEvent, configured: string | null): boolean {
  const key = configured?.trim().toLowerCase() ?? ''
  if (key === '') return false
  if (key === 'space') return event.key === ' '
  return event.key.toLowerCase() === key
}

/**
 * Bars in the waveform strip.
 *
 * Roughly one per two pixels at a typical window width: fine enough that a
 * transient is visible, coarse enough that zooming in does not turn it into a
 * solid block.
 */
const WAVEFORM_BUCKETS = 600

/** Everything known about one source file the timeline references */
interface Source extends SourceAssets {
  url: string
  info: MediaInfo
}

interface EditorLocationState {
  clipPath?: string
}

export default function EditorPage(): JSX.Element {
  const location = useLocation()
  const requestedPath = (location.state as EditorLocationState | null)?.clipPath

  const playerRef = useRef<VideoPlayerHandle>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  /*
   * The timeline is the document. Everything else on this page either shows it
   * or edits it — there is no second copy of "what is being edited" for the two
   * to disagree about.
   */
  const [timeline, setTimeline] = useState<TimelineModel>(EMPTY_TIMELINE)
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [selected, setSelected] = useState<Selection | null>(null)

  /** Playhead, in timeline seconds */
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loadingThumbnails, setLoadingThumbnails] = useState(false)

  const [keys, setKeys] = useState<EditorKeys>(DEFAULT_EDITOR_KEYS)
  const [snapEnabled, setSnapEnabled] = useState(true)

  const [exportControl, setExportControl] = useState<ExportControl | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(true)
  /*
   * Absolute rotation, not a flip.
   *
   * A transform toggled between two values animates whichever way the browser
   * decides. Accumulating the angle instead means the sign of the change picks
   * the direction: collapsing winds clockwise, opening unwinds the same way it
   * came, which is what makes the button feel like a hinge rather than a state.
   */
  const [chevron, setChevron] = useState(0)

  const [busy, setBusy] = useState<'open' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* How much of the timeline the strip spans. Held here because the strip's
     wheel and the transport's buttons both move it. */
  const [view, setView] = useState<TimelineView>(FIT_VIEW)
  const [dragOver, setDragOver] = useState<'stage' | 'timeline' | null>(null)
  /** Where an incoming clip would land, drawn while it is over the lanes */
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null)

  const duration = timelineDuration(timeline)

  // ── Sources ────────────────────────────────────────────────────────────────

  /**
   * Load a file and put it on both lanes.
   *
   * Added rather than replacing what is there: a library that swapped the
   * timeline out on every click would make a second clip impossible to reach.
   */
  const addClip = useCallback(async (clipPath: string, start?: number): Promise<void> => {
    setError(null)

    try {
      const opened = await window.api.media.loadPath(clipPath)
      const { info } = opened

      setSources((previous) => ({
        ...previous,
        [opened.clipPath]: {
          url: opened.clipUrl,
          info,
          thumbnails: previous[opened.clipPath]?.thumbnails ?? [],
          waveform: previous[opened.clipPath]?.waveform ?? [],
          durationSeconds: info.durationSeconds,
        },
      }))

      setTimeline((previous) => {
        const appended = appendClip(previous, {
          path: opened.clipPath,
          durationSeconds: info.durationSeconds,
          hasAudio: info.hasAudio,
        })
        if (start === undefined) return appended

        // Placed where it was dropped, which is the whole point of dropping it
        // somewhere in particular. appendClip puts it last on each lane.
        const place = (items: TimelineItem[]): TimelineItem[] =>
          items.map((item, index) =>
            index === items.length - 1 ? { ...item, start: Math.max(0, start) } : item,
          )
        return { video: place(appended.video), audio: place(appended.audio) }
      })

      // Both strips are nice-to-haves — never block the preview on them.
      setLoadingThumbnails(true)
      window.api.media
        .thumbnails(opened.clipPath, info.durationSeconds)
        .then((strip) => patchSource(setSources, opened.clipPath, { thumbnails: strip.frames }))
        .catch(() => undefined)
        .finally(() => setLoadingThumbnails(false))

      if (info.hasAudio) {
        window.api.media
          .waveform(opened.clipPath, WAVEFORM_BUCKETS)
          .then((waveform) => patchSource(setSources, opened.clipPath, { waveform }))
          .catch(() => undefined)
      }
    } catch (err) {
      setError(cleanError(err))
    }
  }, [])

  const handleImport = useCallback(async () => {
    setBusy('open')
    setError(null)
    try {
      const opened = await window.api.media.openFile()
      if (opened) await addClip(opened.clipPath)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(null)
    }
  }, [addClip])

  /** Empty the timeline, leaving the editor as it opens */
  const clearTimeline = useCallback(() => {
    setTimeline(EMPTY_TIMELINE)
    setSelected(null)
    setPlayhead(0)
    setView(FIT_VIEW)
  }, [])

  // A replay saved from the tray or a hotkey lands here
  useEffect(() => {
    return window.api.recorder.onReplaySaved((saved) => void addClip(saved.clipPath))
  }, [addClip])

  // Navigating in with a clip already chosen
  useEffect(() => {
    if (requestedPath) void addClip(requestedPath)
    // Only react to a genuinely new requested path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPath])

  useEffect(() => {
    const apply = (settings: AppSettings): void => {
      setKeys(settings)
      setSnapEnabled(settings.editorSnap)
    }

    window.api.settings.get().then(apply).catch(() => undefined)
    return window.api.settings.onChange(apply)
  }, [])

  // ── Playback ───────────────────────────────────────────────────────────────

  /*
   * The clip under the playhead. The preview plays one item at a time and hands
   * over at its edge, which is what lets a timeline of several files play as
   * one piece without stitching anything first.
   */
  const activeItem = useMemo(() => itemAt(timeline, 'video', playhead), [timeline, playhead])
  const activeSource = activeItem ? sources[activeItem.path] : undefined

  const handleSeek = useCallback(
    (seconds: number) => {
      const time = Math.max(0, seconds)
      setPlayhead(time)

      const item = itemAt(timeline, 'video', time)
      if (item) playerRef.current?.seek(sourceTimeAt(item, time))
    },
    [timeline],
  )

  /** Player time is a position in one source; the timeline wants where that is */
  const handlePlayerTime = useCallback(
    (sourceSeconds: number) => {
      if (!activeItem) return
      setPlayhead(activeItem.start + (sourceSeconds - activeItem.sourceIn))

      // Hand over at the edge, so a run of clips plays through rather than
      // stopping at the first boundary.
      if (isPlaying && sourceSeconds >= activeItem.sourceOut - 0.02) {
        const next = sortLane(timeline.video).find((item) => item.start > activeItem.start)
        if (next) {
          setPlayhead(next.start)
          playerRef.current?.seek(next.sourceIn)
        }
      }
    },
    [activeItem, isPlaying, timeline.video],
  )

  /**
   * Fullscreen the stage rather than the video element.
   *
   * The element that goes fullscreen is the only thing on screen, so making it
   * the container leaves room for anything drawn over the picture. Handing the
   * <video> to the browser instead would give away that option.
   */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void stageRef.current?.requestFullscreen().catch(() => undefined)
  }, [])

  // ── Editing ────────────────────────────────────────────────────────────────

  const handleMove = useCallback((lane: LaneId, id: string, start: number) => {
    setTimeline((previous) => moveItem(previous, lane, id, start))
  }, [])

  const handleTrim = useCallback(
    (lane: LaneId, id: string, edge: 'start' | 'end', seconds: number) => {
      setTimeline((previous) => {
        const item = previous[lane].find((candidate) => candidate.id === id)
        const sourceDuration = item ? (sources[item.path]?.durationSeconds ?? 0) : 0
        return trimItem(previous, lane, id, edge, seconds, sourceDuration)
      })
    },
    [sources],
  )

  const handleRemove = useCallback((lane: LaneId, id: string) => {
    setTimeline((previous) => removeItem(previous, lane, id))
    setSelected((previous) => (previous?.id === id ? null : previous))
  }, [])

  /**
   * Cut one lane at a moment.
   *
   * One lane, not both: the lanes are independent everywhere else, and a split
   * that always took the audio with it would be a decision made on the user's
   * behalf every single time.
   */
  const handleSplit = useCallback((lane: LaneId, time: number) => {
    setTimeline((previous) => splitAt(previous, time, [lane]))
  }, [])

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const frameStep = 1 / (activeSource?.info.fps || 30)

    const handleKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      if (matches(event, keys.editorKeyPlayPause)) {
        event.preventDefault()
        playerRef.current?.togglePlay()
        return
      }
      if (matches(event, keys.editorKeyCutStart)) {
        if (selected) handleTrim(selected.lane, selected.id, 'start', playhead)
        return
      }
      if (matches(event, keys.editorKeyCutEnd)) {
        if (selected) handleTrim(selected.lane, selected.id, 'end', playhead)
        return
      }
      if (matches(event, keys.editorKeySplit)) {
        // The selected lane, or the picture when nothing is selected — the lane
        // you are working on is the one you meant.
        handleSplit(selected?.lane ?? 'video', playhead)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (selected) handleRemove(selected.lane, selected.id)
        return
      }
      if (matches(event, keys.editorKeyFullscreen)) {
        toggleFullscreen()
        return
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          handleSeek(playhead - (event.shiftKey ? 1 : frameStep))
          break
        case 'ArrowRight':
          event.preventDefault()
          handleSeek(playhead + (event.shiftKey ? 1 : frameStep))
          break
        case 'Home':
          handleSeek(0)
          break
        case 'End':
          handleSeek(duration)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    activeSource,
    duration,
    handleRemove,
    handleSeek,
    handleSplit,
    handleTrim,
    keys,
    playhead,
    selected,
    toggleFullscreen,
  ])

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (event: React.DragEvent, at?: number) => {
      event.preventDefault()
      setDragOver(null)
      setPendingDrop(null)

      // The library drags a path; Explorer drags a file. Check ours first — an
      // internal drag carries no File at all.
      const fromLibrary = event.dataTransfer.getData('application/x-grecorder-clip')
      if (fromLibrary) {
        void addClip(fromLibrary, at)
        return
      }

      const file = event.dataTransfer.files[0]
      if (!file) return

      const path = window.api.media.pathForFile(file)
      if (path) void addClip(path, at)
    },
    [addClip],
  )

  /** Where on the timeline the cursor is, in seconds */
  const dropTimeFrom = useCallback(
    (clientX: number): number => {
      const lanes = timelineRef.current?.querySelector('.lane-stack')
      if (!lanes) return duration

      const rect = lanes.getBoundingClientRect()
      const visible = view.visible ?? fitSpan(duration)
      return Math.max(0, view.offset + ((clientX - rect.left) / rect.width) * visible)
    },
    [duration, view],
  )

  /*
   * A drop is a drop wherever it lands. The stage takes one at the end; the
   * lanes take one where the cursor is, which is how a clip goes before or
   * after what is already there rather than on top of it.
   */
  const stageDrop = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      // Explorer defaults to "link"; without this the cursor says no.
      event.dataTransfer.dropEffect = 'copy'
      setDragOver('stage')
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (event: React.DragEvent) => handleDrop(event),
  }

  const timelineDrop = {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragOver('timeline')

      /*
       * Explorer will not reveal a path until the drop itself, so a file from
       * outside can only be drawn as a line. One of ours is already known, and
       * if it has been loaded before its length is too — which is what lets the
       * ghost show how much room it will take.
       */
      const path = event.dataTransfer.types.includes('application/x-grecorder-clip')
        ? event.dataTransfer.getData('application/x-grecorder-clip')
        : ''
      const known = path ? sources[path]?.durationSeconds : undefined

      setPendingDrop({
        start: snapDropTo(timeline, dropTimeFrom(event.clientX), snapEnabled),
        durationSeconds: known ?? null,
      })
    },
    onDragLeave: () => {
      setDragOver(null)
      setPendingDrop(null)
    },
    onDrop: (event: React.DragEvent) =>
      handleDrop(event, snapDropTo(timeline, dropTimeFrom(event.clientX), snapEnabled)),
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  /**
   * The timeline as the exporter wants it: sources by index, and every item
   * pointing at one. Memoised because the picker reports a control back up, and
   * a fresh object every render would make the two chase each other.
   */
  const exportTimeline = useMemo(() => {
    const paths = [...new Set([...timeline.video, ...timeline.audio].map((item) => item.path))]
    const toItems = (
      items: TimelineItem[],
    ): { input: number; start: number; sourceIn: number; sourceOut: number }[] =>
      sortLane(items).map((item) => ({
        input: paths.indexOf(item.path),
        start: item.start,
        sourceIn: item.sourceIn,
        sourceOut: item.sourceOut,
      }))

    return { sources: paths, video: toItems(timeline.video), audio: toItems(timeline.audio), duration }
  }, [duration, timeline])

  const firstSource = timeline.video[0] ? sources[timeline.video[0].path] : undefined

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`editor-layout${libraryOpen ? '' : ' is-collapsed'}`}>
      <MediaLibrary
        busy={busy === 'open'}
        activePath={activeItem?.path ?? null}
        onOpen={(clipPath) => void addClip(clipPath)}
        onImport={() => void handleImport()}
        onRemoved={(removed) => {
          // A file that is gone cannot stay on the timeline — the editor would
          // be holding a picture of something that no longer exists.
          setTimeline((previous) => ({
            video: previous.video.filter((item) => item.path !== removed),
            audio: previous.audio.filter((item) => item.path !== removed),
          }))
        }}
      />

      <div className="editor">
        <div className="row-between editor-head">
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <button
              className="btn btn-icon library-toggle"
              onClick={() => {
                setChevron((angle) => angle + (libraryOpen ? 180 : -180))
                setLibraryOpen((open) => !open)
              }}
              title={libraryOpen ? 'Hide the clip list' : 'Show the clip list'}
              aria-expanded={libraryOpen}
            >
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                aria-hidden
                style={{ transform: `rotate(${chevron}deg)` }}
              >
                <path
                  d="M10 3 L5 8 L10 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div className="stack">
              <h1>{activeItem ? baseName(activeItem.path) : 'Edit'}</h1>
              {duration > 0 && (
                <span className="muted small mono">
                  {timeline.video.length} clip{timeline.video.length === 1 ? '' : 's'} ·{' '}
                  {formatTime(duration)}
                </span>
              )}
            </div>
          </div>

          <div className="row">
            {/* Export sits with the other things you do to a clip, not under the
              settings that shape it. */}
            <button
              className="btn btn-primary"
              onClick={() => setExportOpen(true)}
              disabled={duration <= 0 || exportControl?.isExporting}
            >
              {exportControl?.isExporting
                ? `Exporting ${exportControl.percent.toFixed(0)}%`
                : 'Export'}
            </button>

            {exportControl?.isExporting && (
              <button className="btn" onClick={() => exportControl.cancel()}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="banner banner-error">
            <span style={{ flex: 1 }}>{error}</span>
            <button className="btn btn-ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div
          ref={stageRef}
          className={`stage${dragOver === 'stage' ? ' drag-over' : ''}`}
          {...stageDrop}
        >
          {activeItem && activeSource ? (
            <VideoPlayer
              ref={playerRef}
              src={activeSource.url}
              inPoint={activeItem.sourceIn}
              outPoint={activeItem.sourceOut}
              onTimeUpdate={handlePlayerTime}
              onDurationChange={() => undefined}
              onPlayingChange={setIsPlaying}
              onError={setError}
            />
          ) : (
            <div className="stage-empty">
              {/* The library beside this holds the clips and the way to add
                  more, so the empty state points at it rather than repeating
                  its buttons. */}
              <p>Pick a clip from the left, or drop a video here.</p>
            </div>
          )}
        </div>

        <div
          ref={timelineRef}
          className={`timeline-drop${dragOver === 'timeline' ? ' drag-over' : ''}`}
          {...timelineDrop}
        >
          <Timeline
            timeline={timeline}
            assets={sources}
            currentTime={playhead}
            selected={selected}
            loadingThumbnails={loadingThumbnails}
            snap={snapEnabled}
            view={view}
            drop={dragOver === 'timeline' ? pendingDrop : null}
            onSelect={setSelected}
            onSeek={handleSeek}
            onMove={handleMove}
            onRemove={handleRemove}
            onSplit={(lane) => handleSplit(lane, playhead)}
            onViewChange={setView}
          />
        </div>

        <TrimControls
          duration={duration}
          currentTime={playhead}
          isPlaying={isPlaying}
          disabled={duration <= 0}
          canRemove={selected !== null}
          onTogglePlay={() => playerRef.current?.togglePlay()}
          onSplit={() => handleSplit(selected?.lane ?? 'video', playhead)}
          onRemove={() => selected && handleRemove(selected.lane, selected.id)}
          onClear={clearTimeline}
          onSeek={handleSeek}
          view={view}
          span={fitSpan(duration)}
          onViewChange={setView}
          snap={snapEnabled}
          onSnapChange={(next) => {
            setSnapEnabled(next)
            void window.api.settings.set({ editorSnap: next })
          }}
          onToggleFullscreen={toggleFullscreen}
        />

        <PresetPicker
          timeline={exportTimeline}
          hasAudio={timeline.audio.length > 0}
          disabled={duration <= 0}
          onControlChange={setExportControl}
          open={exportOpen}
          onClose={() => setExportOpen(false)}
        />

        {firstSource && (
          <p className="small faint">
            {firstSource.info.width}×{firstSource.info.height} · {firstSource.info.fps} fps ·{' '}
            {formatBytes(firstSource.info.sizeBytes)}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Update one source's assets without disturbing the others */
function patchSource(
  set: React.Dispatch<React.SetStateAction<Record<string, Source>>>,
  path: string,
  patch: Partial<SourceAssets>,
): void {
  set((previous) => {
    const source = previous[path]
    if (!source) return previous
    return { ...previous, [path]: { ...source, ...patch } }
  })
}

/**
 * Pull an incoming clip onto the nearest clip edge.
 *
 * Judged in seconds against the content rather than in pixels against the
 * pointer: a drop meant as "right after this one" should butt up against it
 * exactly, and the pointer is nowhere near the edge it is aiming for.
 */
function snapDropTo(timeline: TimelineModel, time: number, snap: boolean): number {
  if (!snap) return time

  const edges = [0]
  for (const lane of ['video', 'audio'] as LaneId[]) {
    for (const item of timeline[lane]) {
      edges.push(item.start, item.start + itemDuration(item))
    }
  }

  let best = time
  let bestGap = Math.max(timelineDuration(timeline) * 0.02, 0.25)
  for (const edge of edges) {
    const gap = Math.abs(edge - time)
    if (gap < bestGap) {
      best = edge
      bestGap = gap
    }
  }
  return best
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}

/** File name without its directory, for the editor's title */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
