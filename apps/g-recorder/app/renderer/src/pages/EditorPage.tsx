import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { MediaInfo } from '../../../shared/types'
import { clamp, formatBytes, formatTime } from '../../../shared/time'
import VideoPlayer from '../components/VideoPlayer'
import type { VideoPlayerHandle } from '../components/VideoPlayer'
import Timeline from '../components/Timeline'
import type { Lane } from '../components/Timeline'
import TrimControls from '../components/TrimControls'
import { FIT_VIEW } from '../components/timelineView'
import type { TimelineView } from '../components/timelineView'
import PresetPicker from '../components/PresetPicker'
import MediaLibrary from '../components/MediaLibrary'
import type { ExportControl } from '../components/PresetPicker'

interface EditorKeys {
  editorKeyPlayPause: string
  editorKeyCutStart: string
  editorKeyCutEnd: string
  editorKeySplit: string
  editorKeyFullscreen: string
}

/** Used until settings arrive, and if a key is somehow blank */
const DEFAULT_EDITOR_KEYS: EditorKeys = {
  editorKeyPlayPause: 'Space',
  editorKeyCutStart: 'I',
  editorKeyCutEnd: 'O',
  editorKeySplit: 'S',
  editorKeyFullscreen: 'F',
}

/**
 * Whether a keypress is the configured key.
 *
 * Case-insensitive, and "Space" names the key the spacebar sends — which is a
 * single space, and would be invisible in a settings field.
 */
function matches(event: KeyboardEvent, configured: string): boolean {
  const key = configured.trim().toLowerCase()
  if (key === '') return false
  if (key === 'space') return event.key === ' '
  return event.key.toLowerCase() === key
}

/**
 * Bars in the waveform lane.
 *
 * Roughly one per two pixels at a typical window width: fine enough that a
 * transient is visible, coarse enough that zooming in does not turn it into a
 * solid block.
 */
const WAVEFORM_BUCKETS = 600

/** Shortest part a cut may create — below this it cannot be aimed at or seen */
const MIN_PART_SECONDS = 0.25

interface LoadedClip {
  path: string
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

  const [clip, setClip] = useState<LoadedClip | null>(null)
  const [duration, setDuration] = useState(0)
  const [inPoint, setInPoint] = useState(0)
  /**
   * Split points inside the selection, in seconds.
   *
   * A cut on its own removes nothing: it divides the selection into parts, and
   * discarding a part is a separate, reversible act. That keeps S free to be
   * pressed while scrubbing without destroying anything.
   */
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
  const [cuts, setCuts] = useState<number[]>([])
  /** Parts the export should leave out, keyed by their start time */
  const [discarded, setDiscarded] = useState<number[]>([])
  const [outPoint, setOutPoint] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [waveform, setWaveform] = useState<number[]>([])
  /*
   * The audio lane's own window. It starts matching the video, and only parts
   * company when the audio's handles are dragged — so the ordinary case still
   * exports through the fast single-pass path.
   */
  const [audioIn, setAudioIn] = useState(0)
  const [audioOut, setAudioOut] = useState(0)
  const [selectedLane, setSelectedLane] = useState<Lane>('video')
  /*
   * Audio dropped from the timeline. Kept as a flag rather than by clearing the
   * waveform: the lane has to be able to come back, and the footage still has
   * the track — the export is simply told to leave it out.
   */
  const [audioRemoved, setAudioRemoved] = useState(false)
  const [keys, setKeys] = useState<EditorKeys>(DEFAULT_EDITOR_KEYS)

  useEffect(() => {
    window.api.settings.get().then(setKeys).catch(() => undefined)
    return window.api.settings.onChange(setKeys)
  }, [])
  const [loadingThumbnails, setLoadingThumbnails] = useState(false)

  const [busy, setBusy] = useState<'save' | 'record' | 'open' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* How much of the clip the strip spans. Held here because the strip's wheel
     and the transport's buttons both move it. */
  const [view, setView] = useState<TimelineView>(FIT_VIEW)
  /* Which region is under the cursor, so only that one lights up */
  const [dragOver, setDragOver] = useState<'stage' | 'timeline' | null>(null)

  // ── Clip loading ───────────────────────────────────────────────────────────

  /** Let go of the loaded clip, leaving the editor as it opens */
  const clearClip = useCallback(() => {
    setClip(null)
    setDuration(0)
    setInPoint(0)
    setOutPoint(0)
    setAudioIn(0)
    setAudioOut(0)
    setAudioRemoved(false)
    setThumbnails([])
    setWaveform([])
    setCuts([])
    setDiscarded([])
    setView(FIT_VIEW)
  }, [])

  const loadClip = useCallback(async (clipPath: string) => {
    setError(null)
    setThumbnails([])
    setWaveform([])

    try {
      const opened = await window.api.media.loadPath(clipPath)
      const nextDuration = opened.info.durationSeconds

      setClip({ path: opened.clipPath, url: opened.clipUrl, info: opened.info })
      setDuration(nextDuration)
      setInPoint(0)
      setOutPoint(nextDuration)
      setAudioIn(0)
      setAudioOut(nextDuration)
      setAudioRemoved(false)
      setView(FIT_VIEW)
      setCurrentTime(0)

      // Both strips are nice-to-haves — never block the preview on them.
      setLoadingThumbnails(true)
      window.api.media
        .thumbnails(opened.clipPath, nextDuration)
        .then((strip) => setThumbnails(strip.frames))
        .catch(() => setThumbnails([]))
        .finally(() => setLoadingThumbnails(false))

      if (opened.info.hasAudio) {
        window.api.media
          .waveform(opened.clipPath, WAVEFORM_BUCKETS)
          .then(setWaveform)
          .catch(() => setWaveform([]))
      }
    } catch (err) {
      setError(cleanError(err))
    }
  }, [])

  // A replay saved from the tray or a hotkey lands here
  useEffect(() => {
    return window.api.recorder.onReplaySaved((saved) => {
      void loadClip(saved.clipPath)
    })
  }, [loadClip])

  // Navigating in with a clip already chosen
  useEffect(() => {
    if (requestedPath && requestedPath !== clip?.path) void loadClip(requestedPath)
    // Only react to a genuinely new requested path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPath])

  // ── Actions ────────────────────────────────────────────────────────────────

  const runAction = useCallback(
    async (kind: 'save' | 'record' | 'open', work: () => Promise<void>) => {
      setBusy(kind)
      setError(null)
      try {
        await work()
      } catch (err) {
        setError(cleanError(err))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const handleOpenFile = useCallback(
    () =>
      runAction('open', async () => {
        const opened = await window.api.media.openFile()
        if (opened) await loadClip(opened.clipPath)
      }),
    [loadClip, runAction],
  )

  const handleTrimChange = useCallback(
    (nextIn: number, nextOut: number) => {
      setInPoint(nextIn)
      setOutPoint(nextOut)

      // Keep the playhead inside the new selection so the preview matches the export
      const clamped = clamp(currentTime, nextIn, nextOut)
      if (Math.abs(clamped - currentTime) > 0.001) playerRef.current?.seek(clamped)
    },
    [currentTime],
  )

  const handleSeek = useCallback((seconds: number) => {
    playerRef.current?.seek(seconds)
  }, [])

  /**
   * Fullscreen the stage rather than the video element.
   *
   * The element that goes fullscreen is the only thing on screen, so making it
   * the container leaves room for anything drawn over the picture. Handing the
   * <video> to the browser instead would give away that option, and with it the
   * app's own controls.
   */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void stageRef.current?.requestFullscreen().catch(() => undefined)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!clip) return

    const frameStep = 1 / (clip.info.fps > 0 ? clip.info.fps : 30)

    const splitAtPlayhead = (): void => {
      // A cut on top of an existing one, or hard against an edge, would make a
      // part too short to see or select.
      const tooClose = (a: number, b: number): boolean => Math.abs(a - b) < MIN_PART_SECONDS
      if (tooClose(currentTime, inPoint) || tooClose(currentTime, outPoint)) return
      if (cuts.some((cut) => tooClose(cut, currentTime))) return

      setCuts((previous) => [...previous, currentTime].sort((a, b) => a - b))
    }

    const handleKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      // Matched against the configured keys rather than hard-coded letters:
      // S for split is a convention, not everyone's convention.
      if (matches(event, keys.editorKeyPlayPause)) {
        event.preventDefault()
        playerRef.current?.togglePlay()
        return
      }
      if (matches(event, keys.editorKeyCutStart)) {
        setInPoint(clamp(currentTime, 0, outPoint - 0.1))
        return
      }
      if (matches(event, keys.editorKeyCutEnd)) {
        setOutPoint(clamp(currentTime, inPoint + 0.1, duration))
        return
      }
      if (matches(event, keys.editorKeySplit)) {
        splitAtPlayhead()
        return
      }
      if (matches(event, keys.editorKeyFullscreen)) {
        toggleFullscreen()
        return
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          playerRef.current?.nudge(event.shiftKey ? -1 : -frameStep)
          break
        case 'ArrowRight':
          event.preventDefault()
          playerRef.current?.nudge(event.shiftKey ? 1 : frameStep)
          break
        case 'Home':
          playerRef.current?.seek(inPoint)
          break
        case 'End':
          playerRef.current?.seek(outPoint)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [clip, cuts, currentTime, duration, inPoint, keys, outPoint, toggleFullscreen])

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragOver(null)

      // The library drags a path; Explorer drags a file. Check ours first —
      // an internal drag carries no File at all.
      const fromLibrary = event.dataTransfer.getData('application/x-grecorder-clip')
      if (fromLibrary) {
        void loadClip(fromLibrary)
        return
      }

      const file = event.dataTransfer.files[0]
      if (!file) return

      const path = window.api.media.pathForFile(file)
      if (path) void loadClip(path)
    },
    [loadClip],
  )

  /*
   * A drop is a drop wherever it lands. The stage and the timeline are the two
   * places a clip visibly belongs, so both take the same handlers rather than
   * the picture being the only thing that accepts one.
   */
  const dropZone = useCallback(
    (zone: 'stage' | 'timeline') => ({
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault()
        // Explorer defaults to "link"; without this the cursor says no.
        event.dataTransfer.dropEffect = 'copy'
        setDragOver(zone)
      },
      onDragLeave: () => setDragOver(null),
      onDrop: handleDrop,
    }),
    [handleDrop],
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  /*
   * Parts are derived, never stored: cuts and the trim are the only state, so
   * moving a handle cannot leave a stale part behind.
   *
   * Memoised because the kept ranges are handed to the export, which reports a
   * control back up — a fresh array on every render would make those two chase
   * each other indefinitely.
   */
  const parts = useMemo(() => {
    const bounds = [inPoint, ...cuts.filter((c) => c > inPoint && c < outPoint), outPoint]
    return bounds.slice(0, -1).map((start, index) => ({
      start,
      end: bounds[index + 1] ?? outPoint,
      kept: !discarded.some((d) => Math.abs(d - start) < 0.001),
    }))
  }, [cuts, discarded, inPoint, outPoint])

  const hasCuts = parts.length > 1
  const keptRanges = useMemo(
    () =>
      hasCuts ? parts.filter((p) => p.kept).map(({ start, end }) => ({ start, end })) : undefined,
    [hasCuts, parts],
  )
  const visibleCuts = useMemo(
    () => cuts.filter((c) => c > inPoint && c < outPoint),
    [cuts, inPoint, outPoint],
  )

  return (
    <div className={`editor-layout${libraryOpen ? '' : ' is-collapsed'}`}>
      <MediaLibrary
        busy={busy === 'open'}
        activePath={clip?.path ?? null}
        onOpen={(clipPath) => void loadClip(clipPath)}
        onImport={() => void handleOpenFile()}
        onRemoved={(removed) => {
          // A clip that is gone cannot stay loaded — the editor would be
          // holding a picture of a file that no longer exists.
          if (clip?.path === removed) clearClip()
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
              <h1>{clip ? baseName(clip.path) : 'Edit'}</h1>
            {clip && (
              <span className="muted small mono">
                  {clip.info.width}×{clip.info.height} · {formatTime(duration)}
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
              disabled={!clip || exportControl?.isExporting}
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
          {...dropZone('stage')}
        >
          {clip ? (
            <VideoPlayer
              ref={playerRef}
              src={clip.url}
              inPoint={inPoint}
              outPoint={outPoint}
              onTimeUpdate={setCurrentTime}
              onDurationChange={(value) => {
                // Trust the container metadata over ffprobe when they disagree
                if (!Number.isFinite(value) || value <= 0) return
                setDuration((previous) => (Math.abs(previous - value) > 0.25 ? value : previous))
                setOutPoint((previous) => (previous <= 0 ? value : previous))
              }}
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
          className={`timeline-drop${dragOver === 'timeline' ? ' drag-over' : ''}`}
          {...dropZone('timeline')}
        >
          <Timeline
            duration={duration}
            inPoint={inPoint}
            outPoint={outPoint}
            currentTime={currentTime}
            thumbnails={thumbnails}
            waveform={audioRemoved ? [] : waveform}
            audioIn={audioIn}
            audioOut={audioOut}
            selectedLane={selectedLane}
            onSelectLane={setSelectedLane}
            onAudioTrimChange={(nextIn, nextOut) => {
              setAudioIn(nextIn)
              setAudioOut(nextOut)
            }}
            onRemoveLane={(lane) => {
              if (lane === 'audio') setAudioRemoved(true)
              else clearClip()
            }}
            onResetLane={(lane) => {
              if (lane === 'audio') {
                setAudioIn(0)
                setAudioOut(duration)
                setAudioRemoved(false)
              } else {
                handleTrimChange(0, duration)
              }
            }}
            loadingThumbnails={loadingThumbnails}
            cuts={visibleCuts}
            onSeek={handleSeek}
            onTrimChange={handleTrimChange}
            view={view}
            onViewChange={setView}
          />
        </div>

        {hasCuts && (
          <div className="parts">
            <span className="parts-label">Parts</span>
            {parts.map((part) => (
              <button
                key={part.start}
                className={`part${part.kept ? '' : ' is-dropped'}`}
                title={part.kept ? 'Click to drop this part' : 'Click to keep this part'}
                onClick={() =>
                  setDiscarded((previous) =>
                    part.kept
                      ? [...previous, part.start]
                      : previous.filter((d) => Math.abs(d - part.start) >= 0.001),
                  )
                }
              >
                <span className="mono">{formatTime(part.end - part.start)}</span>
              </button>
            ))}
            <button
              className="btn btn-ghost small"
              onClick={() => {
                setCuts([])
                setDiscarded([])
              }}
            >
              Clear cuts
            </button>
          </div>
        )}

        <TrimControls
          duration={duration}
          currentTime={currentTime}
          inPoint={inPoint}
          outPoint={outPoint}
          isPlaying={isPlaying}
          disabled={!clip}
          onTogglePlay={() => playerRef.current?.togglePlay()}
          onSetIn={() => setInPoint(clamp(currentTime, 0, outPoint - 0.1))}
          onSetOut={() => setOutPoint(clamp(currentTime, inPoint + 0.1, duration))}
          onReset={() => {
            handleTrimChange(0, duration)
            setCuts([])
            setDiscarded([])
          }}
          view={view}
          onViewChange={setView}
          onNudge={(delta) => playerRef.current?.nudge(delta)}
        onToggleFullscreen={toggleFullscreen}
        />

        <PresetPicker
          clipPath={clip?.path ?? null}
          inPoint={inPoint}
          outPoint={outPoint}
          ranges={keptRanges}
          audio={{ inPoint: audioIn, outPoint: audioOut }}
          hasAudio={(clip?.info.hasAudio ?? false) && !audioRemoved}
          disabled={!clip}
          onControlChange={setExportControl}
          open={exportOpen}
          onClose={() => setExportOpen(false)}
        />

        {clip && (
          <p className="small faint">
            {clip.info.width}×{clip.info.height} · {clip.info.fps} fps ·{' '}
            {formatBytes(clip.info.sizeBytes)} · {clip.path}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

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
