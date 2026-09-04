import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { MediaInfo } from '../../../shared/types'
import { clamp, formatBytes, formatTime } from '../../../shared/time'
import VideoPlayer from '../components/VideoPlayer'
import type { VideoPlayerHandle } from '../components/VideoPlayer'
import Timeline from '../components/Timeline'
import TrimControls from '../components/TrimControls'
import PresetPicker from '../components/PresetPicker'
import MediaLibrary from '../components/MediaLibrary'
import type { ExportControl } from '../components/PresetPicker'

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
  const navigate = useNavigate()
  const requestedPath = (location.state as EditorLocationState | null)?.clipPath

  const playerRef = useRef<VideoPlayerHandle>(null)

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
  const [cuts, setCuts] = useState<number[]>([])
  /** Parts the export should leave out, keyed by their start time */
  const [discarded, setDiscarded] = useState<number[]>([])
  const [outPoint, setOutPoint] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [loadingThumbnails, setLoadingThumbnails] = useState(false)

  const [busy, setBusy] = useState<'save' | 'record' | 'open' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── Clip loading ───────────────────────────────────────────────────────────

  const loadClip = useCallback(async (clipPath: string) => {
    setError(null)
    setThumbnails([])

    try {
      const opened = await window.api.media.loadPath(clipPath)
      const nextDuration = opened.info.durationSeconds

      setClip({ path: opened.clipPath, url: opened.clipUrl, info: opened.info })
      setDuration(nextDuration)
      setInPoint(0)
      setOutPoint(nextDuration)
      setCurrentTime(0)

      // The strip is a nice-to-have — never block the preview on it
      setLoadingThumbnails(true)
      window.api.media
        .thumbnails(opened.clipPath, nextDuration)
        .then((strip) => setThumbnails(strip.frames))
        .catch(() => setThumbnails([]))
        .finally(() => setLoadingThumbnails(false))
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

      switch (event.key) {
        case ' ':
          event.preventDefault()
          playerRef.current?.togglePlay()
          break
        case 'i':
        case 'I':
          setInPoint(clamp(currentTime, 0, outPoint - 0.1))
          break
        case 'o':
        case 'O':
          setOutPoint(clamp(currentTime, inPoint + 0.1, duration))
          break
        case 's':
        case 'S':
          splitAtPlayhead()
          break
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
  }, [clip, cuts, currentTime, duration, inPoint, outPoint])

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragOver(false)

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
    <div className="editor-layout">
      <MediaLibrary
        activePath={clip?.path ?? null}
        onOpen={(clipPath) => void loadClip(clipPath)}
        onImport={() => void handleOpenFile()}
      />

      <div className="editor">
        <div className="row-between editor-head">
          <div className="stack">
            <h1>{clip ? baseName(clip.path) : 'Edit'}</h1>
            {clip && (
              <span className="muted small mono">
                {clip.info.width}×{clip.info.height} · {formatTime(duration)}
              </span>
            )}
          </div>

          <div className="row">
            <button className="btn" onClick={() => void handleOpenFile()} disabled={busy !== null}>
              Open video…
            </button>

            {/* Export sits with the other things you do to a clip, not under the
              settings that shape it. */}
            <button
              className="btn btn-primary"
              onClick={() => exportControl?.run()}
              disabled={!exportControl?.canExport}
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
          className={`stage${dragOver ? ' drag-over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
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
              <p>Drop a video here, or open one, to start editing.</p>
              <div className="row">
                <button className="btn btn-primary" onClick={() => void handleOpenFile()}>
                  Open video…
                </button>
                <button className="btn" onClick={() => navigate('/record')}>
                  Save a replay
                </button>
              </div>
            </div>
          )}
        </div>

        <Timeline
          duration={duration}
          inPoint={inPoint}
          outPoint={outPoint}
          currentTime={currentTime}
          thumbnails={thumbnails}
          loadingThumbnails={loadingThumbnails}
          cuts={visibleCuts}
          onSeek={handleSeek}
          onTrimChange={handleTrimChange}
        />

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
          onNudge={(delta) => playerRef.current?.nudge(delta)}
        />

        <PresetPicker
          clipPath={clip?.path ?? null}
          inPoint={inPoint}
          outPoint={outPoint}
          ranges={keptRanges}
          hasAudio={clip?.info.hasAudio ?? false}
          disabled={!clip}
          onControlChange={setExportControl}
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
