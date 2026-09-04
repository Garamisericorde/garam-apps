import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppSettings, MediaInfo } from '../../../shared/types'
import { formatBytes, formatTime } from '../../../shared/time'
import {
  appendClip,
  EMPTY_TIMELINE,
  itemAt,
  itemDuration,
  itemEnd,
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
import { emptyHistory, record, redo, undo } from '../state/history'
import type { History } from '../state/history'

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
  const [, setHistory] = useState<History<TimelineModel>>(emptyHistory)
  /*
   * The timeline as it is right now, for the edit helpers.
   *
   * They have to read the current value and write a history entry in the same
   * breath, and a state updater is not the place for that: React may call one
   * twice, which would push the same step onto the stack twice.
   */
  const latestTimeline = useRef(timeline)
  latestTimeline.current = timeline
  const [sources, setSources] = useState<Record<string, Source>>({})
  const [selected, setSelected] = useState<Selection | null>(null)

  /** Playhead, in timeline seconds */
  const [playhead, setPlayhead] = useState(0)
  /*
   * The item the preview is showing, by id.
   *
   * Explicit rather than "whatever is under the playhead", because the player
   * reports a position in its SOURCE and that has to be mapped back — and with
   * the same file on the timeline more than once, a source position does not
   * say which clip it belongs to. Deriving the item from the playhead and the
   * playhead from the item made each answer depend on the other: clicking one
   * clip moved the playhead into whichever clip happened to be mounted.
   */
  const [activeId, setActiveId] = useState<string | null>(null)
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

  /*
   * Keep the preview pointing at something real. Removing the clip it was
   * showing, or loading the first one, has to move it — and the item under the
   * playhead is the right guess in both cases.
   */
  useEffect(() => {
    setActiveId((current) => {
      if (current && timeline.video.some((item) => item.id === current)) return current
      const under = timeline.video.find(
        (item) => playhead >= item.start && playhead < itemEnd(item),
      )
      return under?.id ?? timeline.video[0]?.id ?? null
    })
  }, [playhead, timeline.video])

  // ── Editing, with history ──────────────────────────────────────────────────

  /** Make a change that can be undone */
  const edit = useCallback((change: (timeline: TimelineModel) => TimelineModel) => {
    const previous = latestTimeline.current
    const next = change(previous)
    if (next === previous) return

    setHistory((current) => record(current, previous))
    setTimeline(next)
  }, [])

  /**
   * Make a change that is part of one already recorded.
   *
   * A drag reports every pointer move, and each one is the same edit still
   * happening — recording them all would mean pressing undo two hundred times
   * to put one clip back.
   */
  const apply = useCallback((change: (timeline: TimelineModel) => TimelineModel) => {
    setTimeline((previous) => change(previous))
  }, [])

  /** A gesture is about to start changing things */
  const beginEdit = useCallback(() => {
    setHistory((current) => record(current, latestTimeline.current))
  }, [])

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

      edit((previous) =>
        appendClip(
          previous,
          {
            path: opened.clipPath,
            durationSeconds: info.durationSeconds,
            hasAudio: info.hasAudio,
          },
          start,
        ),
      )

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
  }, [edit])

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
    edit(() => EMPTY_TIMELINE)
    setSelected(null)
    setPlayhead(0)
    setView(FIT_VIEW)
  }, [edit])

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
   * The clip the preview is showing. It plays one item at a time and hands over
   * at its edge, which is what lets a timeline of several files play as one
   * piece without stitching anything first.
   */
  const activeItem = useMemo(
    () => timeline.video.find((item) => item.id === activeId) ?? null,
    [activeId, timeline.video],
  )
  const activeSource = activeItem ? sources[activeItem.path] : undefined

  /*
   * A seek waiting for the player to be told which clip it is showing.
   *
   * It cannot be done inline: the player clamps to the bounds it was last
   * rendered with, so seeking into a different clip before those props reach it
   * lands on the old clip's edge instead. The effect below runs after the
   * render that carries them.
   */
  const pendingSeek = useRef<number | null>(null)
  /** Whether to carry on playing once that seek lands */
  const resumeAfterSeek = useRef(false)
  const [seekTick, setSeekTick] = useState(0)

  const requestSeek = useCallback((sourceSeconds: number, resume = false) => {
    pendingSeek.current = sourceSeconds
    resumeAfterSeek.current = resume
    setSeekTick((tick) => tick + 1)
  }, [])

  useEffect(() => {
    const target = pendingSeek.current
    if (target === null) return
    pendingSeek.current = null

    playerRef.current?.seek(target)

    if (resumeAfterSeek.current) {
      resumeAfterSeek.current = false
      playerRef.current?.play()
    }
  }, [seekTick])

  const handleSeek = useCallback(
    (seconds: number) => {
      const time = Math.max(0, seconds)
      setPlayhead(time)

      // Landing in a gap leaves the last frame up rather than blanking the
      // stage — there is nothing there to show instead.
      const item = itemAt(timeline, 'video', time)
      if (!item) return

      setActiveId(item.id)
      requestSeek(sourceTimeAt(item, time))
    },
    [requestSeek, timeline],
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
          setActiveId(next.id)
          setPlayhead(next.start)
          // The player has already paused itself at this clip's end, so handing
          // over is not enough: without this, playback stopped at every cut.
          requestSeek(next.sourceIn, true)
        }
      }
    },
    [activeItem, isPlaying, requestSeek, timeline.video],
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

  const handleMove = useCallback(
    (lane: LaneId, id: string, start: number) => {
      apply((previous) => moveItem(previous, lane, id, start))
    },
    [apply],
  )

  const handleTrim = useCallback(
    (lane: LaneId, id: string, edge: 'start' | 'end', seconds: number) => {
      edit((previous) => {
        const item = previous[lane].find((candidate) => candidate.id === id)
        const sourceDuration = item ? (sources[item.path]?.durationSeconds ?? 0) : 0
        return trimItem(previous, lane, id, edge, seconds, sourceDuration)
      })
    },
    [edit, sources],
  )

  const handleRemove = useCallback(
    (lane: LaneId, id: string) => {
      edit((previous) => removeItem(previous, lane, id))
      setSelected((previous) => (previous?.id === id ? null : previous))
    },
    [edit],
  )

  /**
   * Cut at a moment.
   *
   * Both lanes by default: the sound under a clip belongs to it, and a cut that
   * left the audio whole is a cut you have to make twice. Cutting one lane on
   * its own is still there, in the clip's own menu, for when the two are meant
   * to come apart.
   */
  const handleSplit = useCallback(
    (time: number, lanes?: LaneId[]) => {
      edit((previous) => splitAt(previous, time, lanes))
    },
    [edit],
  )

  /** Walk the history one step and put the timeline back to what it held */
  const stepHistory = useCallback(
    (step: typeof undo<TimelineModel>) => {
      setHistory((current) => {
        const stepped = step(current, latestTimeline.current)
        if (!stepped) return current

        setTimeline(stepped.present)
        // A clip that is no longer there cannot stay selected.
        setSelected((selection) =>
          selection &&
          stepped.present[selection.lane].some((item) => item.id === selection.id)
            ? selection
            : null,
        )
        return stepped.history
      })
    },
    [],
  )

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const frameStep = 1 / (activeSource?.info.fps || 30)

    const handleKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        // Both spellings of redo, because both are muscle memory somewhere.
        if (key === 'z' && event.shiftKey) {
          event.preventDefault()
          stepHistory(redo)
          return
        }
        if (key === 'z') {
          event.preventDefault()
          stepHistory(undo)
          return
        }
        if (key === 'y') {
          event.preventDefault()
          stepHistory(redo)
          return
        }
        return
      }

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
        handleSplit(playhead)
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
    stepHistory,
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

  /**
   * Where on the timeline the cursor is, and how much of a second a pixel is
   * worth there. Snapping is a gesture, so its reach has to be measured on the
   * screen: as a fraction of the timeline's length it grew with the timeline,
   * and on a seven-minute one nothing could be dropped except on an edge.
   */
  const dropPosition = useCallback(
    (clientX: number): { time: number; perPixel: number } => {
      const lanes = timelineRef.current?.querySelector('.lane-stack')
      if (!lanes) return { time: duration, perPixel: 0 }

      const rect = lanes.getBoundingClientRect()
      const visible = view.visible ?? fitSpan(duration)
      const perPixel = rect.width > 0 ? visible / rect.width : 0
      return {
        time: Math.max(0, view.offset + (clientX - rect.left) * perPixel),
        perPixel,
      }
    },
    [duration, view],
  )

  /** Where a clip dropped at this cursor position would start */
  const dropStart = useCallback(
    (clientX: number): number => {
      const { time, perPixel } = dropPosition(clientX)
      return snapDropTo(timeline, time, snapEnabled ? DROP_SNAP_PX * perPixel : 0)
    },
    [dropPosition, snapEnabled, timeline],
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

      setPendingDrop({ start: dropStart(event.clientX), durationSeconds: known ?? null })
    },
    onDragLeave: () => {
      setDragOver(null)
      setPendingDrop(null)
    },
    onDrop: (event: React.DragEvent) => handleDrop(event, dropStart(event.clientX)),
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
          edit((previous) => ({
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
            onEditBegin={beginEdit}
            onRemove={handleRemove}
            onSplit={(lane, both) => handleSplit(playhead, both ? undefined : [lane])}
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
          onSplit={() => handleSplit(playhead)}
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

/** How close a drop must come to an edge to land on it, in pixels */
const DROP_SNAP_PX = 10

/**
 * Pull an incoming clip onto the nearest clip edge.
 *
 * A drop meant as "right after this one" should butt up against it exactly, so
 * the reach is given in seconds converted from pixels by the caller. Zero turns
 * snapping off.
 */
function snapDropTo(timeline: TimelineModel, time: number, reach: number): number {
  if (reach <= 0) return time

  const edges = [0]
  for (const lane of ['video', 'audio'] as LaneId[]) {
    for (const item of timeline[lane]) {
      edges.push(item.start, item.start + itemDuration(item))
    }
  }

  let best = time
  let bestGap = reach
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
