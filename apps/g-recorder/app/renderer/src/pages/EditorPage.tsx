import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppSettings, FrameCrop, MediaInfo } from '../../../shared/types'
import { formatBytes, formatTime } from '../../../shared/time'
import {
  appendClip,
  boomerang,
  closeGapBefore,
  copyItems,
  EMPTY_TIMELINE,
  itemAt,
  itemDuration,
  itemEnd,
  linkItems,
  moveItem,
  pasteItems,
  pastedId,
  previewAudio,
  removeItem,
  reverseItem,
  setItemGain,
  unlinkItem,
  sortLane,
  sourceTimeAt,
  splitAt,
  timelineDuration,
  timelineTimeAt,
  trimItem,
  type ClipboardItem,
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
import CropOverlay, { FULL_FRAME, isCropped } from '../components/CropOverlay'
import PresetPicker from '../components/PresetPicker'
import MediaLibrary from '../components/MediaLibrary'
import { carriesFile, droppedPath } from '../lib/droppedPath'
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

/** A reversed copy of one clip's window, played forwards in place of it */
interface ReversePreview {
  url: string
  durationSeconds: number
}

/**
 * What a reversed copy is of: the file and the window, never the item.
 *
 * Keyed this way, splitting a reversed clip reuses the copy for whichever half
 * still spans the same seconds, and trimming one asks for a new one — which is
 * exactly when the old copy has stopped being a picture of it.
 */
function previewKey(item: TimelineItem): string {
  return `${item.path}|${item.sourceIn}|${item.sourceOut}`
}

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
  /*
   * Rows picked in the clips panel.
   *
   * Held here, beside the timeline's own selection, because the app has one
   * selection and not two. Delete has to mean one thing, and it cannot if a row
   * in the list and a clip on the timeline can both be lit at once — so picking
   * in either place clears the other.
   */
  const [libraryPicks, setLibraryPicks] = useState<string[]>([])
  /*
   * The last clip copied.
   *
   * The app's own, not the system clipboard: what is held is a position in a
   * file and a window into it, which means nothing to anything else on the
   * machine, and Ctrl+C in the editor should never quietly replace whatever
   * the user had copied elsewhere.
   */
  const [clipboard, setClipboard] = useState<ClipboardItem[] | null>(null)
  /*
   * Reversed clips, each as a small copy that has already been turned round.
   *
   * A video element cannot play backwards at any speed worth watching: seeking
   * towards the head of an H.264 file decodes from the previous keyframe every
   * time, which on a 1440p60 capture is up to a hundred and twenty frames per
   * step. So the reversing is done once by FFmpeg and the preview plays the
   * result the normal way round.
   */
  const [reversePreviews, setReversePreviews] = useState<Record<string, ReversePreview>>({})
  const [buildingPreview, setBuildingPreview] = useState(false)
  /*
   * Play was pressed on a clip whose reversed copy is not finished.
   *
   * There used to be a stand-in that ran the original backwards by seeking it,
   * and it was worse than waiting: eight pictures a second, which reads as the
   * clip suddenly speeding up rather than as something loading. So the request
   * is held instead, and honoured the moment the copy lands.
   */
  const playWhenReady = useRef(false)

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
  /*
   * Whether reaching the end starts the timeline again.
   *
   * On to begin with: editing a short clip means watching it over, and having
   * to press play again after every pass is the kind of small friction that is
   * only noticed a hundred times.
   */
  const [loop, setLoop] = useState(true)

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
  /*
   * What to keep of the frame, and whether the rectangle is on screen.
   *
   * One crop for the export rather than one per clip: it answers "what part of
   * my screen is worth showing", which is a property of the recording setup,
   * not of the moment.
   */
  const [crop, setCrop] = useState<FrameCrop>(FULL_FRAME)
  const [cropping, setCropping] = useState(false)
  /* While drawing, the whole frame has to be visible to draw on. */
  const showCrop = isCropped(crop) && !cropping
  const [dragOver, setDragOver] = useState<'stage' | 'timeline' | null>(null)
  /** Where an incoming clip would land, drawn while it is over the lanes */
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null)

  const duration = timelineDuration(timeline)

  /*
   * Removing the clip the playhead was inside used to leave it past the end,
   * and the transport then read 00:06.503 / 00:04.937 — a position that cannot
   * exist, which reads as the editor having lost track of itself.
   */
  useEffect(() => {
    if (duration > 0 && playhead > duration) setPlayhead(duration)
  }, [duration, playhead])

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
   * Make a file playable: register it, read it, and start its strips.
   *
   * Separate from putting it on the timeline, because the two are not always
   * the same act — restoring a saved arrangement needs every source it names
   * without adding a single clip.
   */
  const loadSource = useCallback(
    async (clipPath: string): Promise<{ path: string; info: MediaInfo }> => {
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

      return { path: opened.clipPath, info }
    },
    [],
  )

  /**
   * Load a file and put it on both lanes.
   *
   * Added rather than replacing what is there: a library that swapped the
   * timeline out on every click would make a second clip impossible to reach.
   */
  const addClip = useCallback(async (clipPath: string, start?: number): Promise<void> => {
    setError(null)

    try {
      const opened = await loadSource(clipPath)
      const { info } = opened

      edit((previous) =>
        appendClip(
          previous,
          {
            path: opened.path,
            durationSeconds: info.durationSeconds,
            hasAudio: info.hasAudio,
          },
          start,
        ),
      )
    } catch (err) {
      setError(cleanError(err))
    }
  }, [edit, loadSource])

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

  /*
   * A replay saved from the tray or a hotkey is NOT put on the timeline.
   *
   * It used to be, and that made every save an edit: the clip you had been
   * arranging gained a stranger on the end of it. Saving writes a file; the
   * list beside this picks it up, and adding it is a decision of its own.
   */

  /*
   * Pick the last arrangement back up.
   *
   * An edit is work, and every restart used to throw it away: closing the app,
   * or installing an update, meant laying the same clips out again. What is
   * stored is a few hundred bytes of positions, so every source it names has to
   * be loaded again here — and any whose file has since gone is dropped rather
   * than left on the timeline as a clip that cannot be shown.
   */
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true

    void (async () => {
      const saved = await window.api.editor.get().catch(() => null)
      if (!saved) return

      const paths = [
        ...new Set([...saved.timeline.video, ...saved.timeline.audio].map((item) => item.path)),
      ]
      if (paths.length === 0) return

      const alive = new Set<string>()
      for (const path of paths) {
        try {
          const loaded = await loadSource(path)
          alive.add(loaded.path)
        } catch {
          // The file has been moved or deleted since. Nothing to restore.
        }
      }

      const keep = (items: TimelineItem[]): TimelineItem[] =>
        items.filter((item) => alive.has(item.path))

      setTimeline((previous) => {
        // A clip opened on the way in beat the restore to it. What the user
        // just asked for wins; the saved arrangement is not worth overwriting
        // a deliberate act with.
        if (previous.video.length > 0 || previous.audio.length > 0) return previous
        return { video: keep(saved.timeline.video), audio: keep(saved.timeline.audio) }
      })

      if (saved.crop) setCrop(saved.crop)
      if (saved.playhead > 0) setPlayhead(saved.playhead)
    })()
  }, [loadSource])

  /*
   * Write it back, a moment after it stops changing.
   *
   * Debounced because a drag reports every pointer move, and the playhead is
   * read from a ref rather than depended on: it changes sixty times a second
   * while playing, and waiting for that to settle would mean an edit made just
   * before pressing play was never written at all.
   */
  const stateRef = useRef({ timeline, crop, playhead })
  stateRef.current = { timeline, crop, playhead }

  const saveState = useCallback((): void => {
    const { timeline: current, crop: rect, playhead: at } = stateRef.current
    void window.api.editor
      .set({ timeline: current, crop: isCropped(rect) ? rect : null, playhead: at })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = setTimeout(saveState, SAVE_DELAY_MS)
    /*
     * Only the timer. Saving from the cleanup as well meant every change wrote
     * twice — once on the way out of the old effect and once from its timer —
     * and three of those landing together lost the rename to each other:
     * EPERM, and nothing saved at all.
     */
    return () => clearTimeout(timer)
  }, [timeline, crop, saveState])

  // Leaving the editor is the one moment the delay cannot be afforded.
  useEffect(() => saveState, [saveState])

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

  /** The reversed copy standing in for an item, once it has been built */
  const previewFor = useCallback(
    (item: TimelineItem | null | undefined): ReversePreview | undefined =>
      item?.reversed ? reversePreviews[previewKey(item)] : undefined,
    [reversePreviews],
  )

  /**
   * Where the player should be, in the timebase of whatever it is showing.
   *
   * A reversed clip standing on its proxy is played forwards through a file
   * that is already backwards, so the two run in opposite directions and the
   * position has to be turned round with them.
   */
  const playerTimeFor = useCallback(
    (item: TimelineItem, time: number): number => {
      const inSource = sourceTimeAt(item, time)
      return previewFor(item) ? item.sourceOut - inSource : inSource
    },
    [previewFor],
  )

  const activePreview = previewFor(activeItem)

  /**
   * The clip playback will hand over to, so the preview can get it ready.
   *
   * The clip after this one, or — at the end of a looping timeline — the first
   * one again. The loop is a cut like any other and gets the same preparation;
   * without it the join back to the beginning was the one place playback still
   * had to stop and load, which is exactly where a boomerang is watched most.
   */
  const nextItem = useMemo(() => {
    if (!activeItem) return null
    const order = sortLane(timeline.video)
    const after = order.find((item) => item.start > activeItem.start)
    if (after) return after
    return loop ? order[0] ?? null : null
  }, [activeItem, loop, timeline.video])

  const nextPreview = previewFor(nextItem)

  /*
   * What the preview should have loaded before the cut arrives.
   *
   * Memoised on the values rather than the objects: this is handed to the
   * player as a prop, and a fresh object every render would have it reloading
   * the same clip for ever.
   */
  const nextSource = nextItem
    ? nextPreview?.url ?? sources[nextItem.path]?.url
    : undefined
  const nextAt = nextItem ? playerTimeFor(nextItem, nextItem.start) : 0
  const nextId = nextItem?.id

  const preload = useMemo(
    () => (nextId && nextSource ? { id: nextId, src: nextSource, at: nextAt } : null),
    [nextAt, nextId, nextSource],
  )

  /*
   * Build the copy the moment a clip is turned round, not when play is pressed
   * — and for the clip after it too, or the cut into a reversed clip would be
   * the first thing to ask for one.
   */
  const needsPreview = [activeItem, nextItem].find((item) => item?.reversed && !previewFor(item))

  useEffect(() => {
    if (!needsPreview) return

    const key = previewKey(needsPreview)
    const { path, sourceIn, sourceOut } = needsPreview
    let cancelled = false

    setBuildingPreview(true)
    window.api.media
      .reversedPreview(path, sourceIn, sourceOut)
      .then((built) => {
        if (cancelled) return
        setReversePreviews((previous) => ({
          ...previous,
          [key]: { url: built.clipUrl, durationSeconds: built.durationSeconds },
        }))
      })
      .catch((err) => {
        if (!cancelled) setError(cleanError(err))
      })
      .finally(() => {
        if (!cancelled) setBuildingPreview(false)
      })

    return () => {
      cancelled = true
    }
  }, [needsPreview])

  /* What the audio lane says should be heard right now — see previewAudio */
  const sound = useMemo(
    () => previewAudio(timeline, activeItem, playhead),
    [activeItem, playhead, timeline],
  )

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
      requestSeek(playerTimeFor(item, time))
    },
    [playerTimeFor, requestSeek, timeline],
  )

  /**
   * The preview has moved to the next clip by itself.
   *
   * It starts that clip running behind the picture a moment before the cut, so
   * by the time this arrives the hand-over has already happened and the only
   * thing left to do is agree with it. Deliberately no seek and no play: the
   * clip is running, and either of those would take back the seamless join the
   * pre-roll bought.
   */
  const handleHandover = useCallback(() => {
    if (!nextItem) return
    setActiveId(nextItem.id)
    setPlayhead(nextItem.start)
  }, [nextItem])

  /** Player time is a position in one source; the timeline wants where that is */
  const handlePlayerTime = useCallback(
    (sourceSeconds: number) => {
      if (!activeItem) return

      // A proxy runs the other way from the item it stands for.
      const inSource = activePreview
        ? activeItem.sourceOut - sourceSeconds
        : sourceSeconds
      setPlayhead(timelineTimeAt(activeItem, inSource))

      // Hand over at the edge, so a run of clips plays through rather than
      // stopping at the first boundary. A reversed clip reaches its edge
      // travelling the other way, so the edge is the other end of the window.
      const atEnd = activeItem.reversed
        ? inSource <= activeItem.sourceIn + 0.02
        : inSource >= activeItem.sourceOut - 0.02

      if (isPlaying && atEnd) {
        const next = sortLane(timeline.video).find((item) => item.start > activeItem.start)
        if (next) {
          setActiveId(next.id)
          setPlayhead(next.start)
          // The player has already paused itself at this clip's end, so handing
          // over is not enough: without this, playback stopped at every cut.
          // Where the next clip begins depends on which way round it runs.
          // A reversed clip with no copy yet cannot be played at all, so the
          // hand-over asks for it and waits rather than showing nothing.
          const ready = !next.reversed || Boolean(previewFor(next))
          playWhenReady.current = !ready
          requestSeek(playerTimeFor(next, next.start), ready)
          return
        }

        /*
         * The end of the last clip, which is where the timeline stops — unless
         * it is meant to go round again. Back to the first clip's start rather
         * than to zero: a timeline that begins with a gap begins with black,
         * and looping into it would read as the preview having lost its place.
         */
        const first = loop ? sortLane(timeline.video)[0] : undefined
        if (first) {
          setActiveId(first.id)
          setPlayhead(first.start)
          requestSeek(playerTimeFor(first, first.start), true)
        }
      }
    },
    [
      activeItem,
      activePreview,
      isPlaying,
      loop,
      playerTimeFor,
      previewFor,
      requestSeek,
      timeline.video,
    ],
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

  const handleGain = useCallback(
    (lane: LaneId, id: string, gain: number) => {
      // Part of the drag that began it, so the whole slide is one undo.
      apply((previous) => setItemGain(previous, lane, id, gain))
    },
    [apply],
  )

  const handleUnlink = useCallback(
    (lane: LaneId, id: string) => {
      edit((previous) => unlinkItem(previous, lane, id))
    },
    [edit],
  )

  const handleLink = useCallback(
    (a: Selection, b: Selection) => {
      edit((previous) => linkItems(previous, a, b))
    },
    [edit],
  )

  const handleRemove = useCallback(
    (lane: LaneId, id: string) => {
      edit((previous) => removeItem(previous, lane, id))
      setSelected((previous) => (previous?.id === id ? null : previous))
    },
    [edit],
  )

  /**
   * Turn a clip round.
   *
   * The preview seeks backwards through the file to show it, which is the only
   * way a video element can be made to run in reverse and is not as smooth as
   * playing forwards. The export is exact either way.
   */
  const handleReverse = useCallback(
    (lane: LaneId, id: string) => {
      edit((previous) => reverseItem(previous, lane, id))
    },
    [edit],
  )

  /**
   * Put a reversed copy of a clip right after it.
   *
   * The frame rate comes from the source, because the copy has to be exactly
   * one frame shorter at each end: any other amount either repeats a frame at
   * the turnaround or skips one.
   */
  const handleBoomerang = useCallback(
    (lane: LaneId, id: string) => {
      const item = latestTimeline.current[lane].find((entry) => entry.id === id)
      const fps = item ? sources[item.path]?.info.fps : 0
      edit((previous) => boomerang(previous, lane, id, 1 / (fps && fps > 0 ? fps : 60)))
    },
    [edit, sources],
  )

  /**
   * Play, or ask to play once there is something to play.
   *
   * A reversed clip is only playable through its copy — nothing can run a
   * video element backwards — so pressing play before the copy is written is a
   * request, not a refusal.
   */
  const togglePlay = useCallback(() => {
    if (activeItem?.reversed && !activePreview) {
      playWhenReady.current = !playWhenReady.current
      return
    }

    playWhenReady.current = false
    playerRef.current?.togglePlay()
  }, [activeItem, activePreview])

  /* The copy has landed: honour the play that was waiting on it */
  useEffect(() => {
    if (!activePreview || !playWhenReady.current) return
    playWhenReady.current = false
    playerRef.current?.play()
  }, [activePreview])

  const handleCloseGap = useCallback(
    (lane: LaneId, id: string) => {
      edit((previous) => closeGapBefore(previous, lane, id))
    },
    [edit],
  )

  const handleCopy = useCallback(
    (lane: LaneId, id: string) => {
      const copied = copyItems(latestTimeline.current, lane, id)
      if (copied.length > 0) setClipboard(copied)
    },
    [],
  )

  /**
   * Put the copy down at the playhead.
   *
   * At the playhead rather than after the clip it came from, because the
   * playhead is the one place on the timeline the user is already looking at,
   * and it is where every other keyboard edit here happens. The copy is
   * selected afterwards, so it can be dragged somewhere else without hunting
   * for it first.
   */
  const handlePaste = useCallback(() => {
    if (!clipboard) return

    const before = latestTimeline.current
    /*
     * Pulled onto a nearby edge, exactly as a dropped clip is.
     *
     * A paste lands wherever the playhead happens to be, and that is almost
     * never precisely where the clip before it ends — so pasting one clip after
     * another left a sliver of a gap, invisible at most zooms and a flash of
     * black on export.
     */
    const at = snapEnabled ? snapDropTo(before, playhead, PASTE_SNAP_SECONDS) : playhead
    const after = pasteItems(before, clipboard, at)
    if (after === before) return

    edit(() => after)

    const lane = clipboard.some((entry) => entry.lane === 'video') ? 'video' : 'audio'
    const id = pastedId(before, after, lane)
    if (id) setSelected({ lane, id })
  }, [clipboard, edit, playhead, snapEnabled])

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
        if (key === 'c') {
          // Only claimed when there is a clip to claim it for: with nothing
          // selected this is still the browser's copy, and swallowing it would
          // stop the user copying a filename off the page.
          if (!selected) return
          event.preventDefault()
          handleCopy(selected.lane, selected.id)
          return
        }
        if (key === 'v') {
          event.preventDefault()
          handlePaste()
          return
        }
        return
      }

      if (matches(event, keys.editorKeyPlayPause)) {
        event.preventDefault()
        togglePlay()
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
        // A selection in the clips panel takes the key; the panel handles it.
        if (libraryPicks.length > 0) return
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
    handleCopy,
    handlePaste,
    handleRemove,
    handleSeek,
    handleSplit,
    handleTrim,
    keys,
    libraryPicks,
    togglePlay,
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

      if (!carriesFile(event.dataTransfer)) return

      const path = droppedPath(event.dataTransfer)
      if (!path) {
        // Silence here read as the drop having missed. It did not: the drop
        // landed and carried nothing this app could open.
        setError('That drop carried no file. Drag a video file in from a folder.')
        return
      }

      void addClip(path, at)
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
        gain: item.gain,
        reversed: item.reversed,
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
        onDropFile={(event) => handleDrop(event)}
        picked={libraryPicks}
        onPicked={(paths) => {
          setLibraryPicks(paths)
          if (paths.length > 0) setSelected(null)
        }}
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
            /*
             * The crop is shown, not merely recorded for the export.
             *
             * The picture is scaled up inside a box the shape of the crop, so
             * the kept region exactly fills it. Anything else means drawing a
             * rectangle and then having to imagine the result.
             */
            <div
              className={`stage-media${showCrop ? ' stage-crop' : ''}`}
              style={
                showCrop
                  ? {
                      aspectRatio: `${crop.width * (activeSource.info.width || 16)} / ${
                        crop.height * (activeSource.info.height || 9)
                      }`,
                    }
                  : undefined
              }
            >
            <VideoPlayer
              ref={playerRef}
              src={activePreview?.url ?? activeSource.url}
              clipId={activeItem.id}
              preload={preload}
              inPoint={activePreview ? 0 : activeItem.sourceIn}
              outPoint={
                activePreview ? activePreview.durationSeconds : activeItem.sourceOut
              }
              onTimeUpdate={handlePlayerTime}
              onDurationChange={() => undefined}
              onPlayingChange={setIsPlaying}
              onHandover={handleHandover}
              onError={setError}
              muted={sound.muted}
              volume={sound.volume}
              style={
                showCrop
                  ? {
                      width: `${100 / crop.width}%`,
                      height: `${100 / crop.height}%`,
                      left: `${(-crop.x / crop.width) * 100}%`,
                      top: `${(-crop.y / crop.height) * 100}%`,
                    }
                  : undefined
              }
            />
            </div>
          ) : null}

          {/*
            * Turning a clip round takes a second or two of FFmpeg, and until it
            * is done the preview is the slow stand-in. Saying so is the
            * difference between waiting and thinking it is broken.
            */}
          {activeItem?.reversed && !activePreview && (
            <div className="stage-note">
              {buildingPreview ? 'Preparing the reversed preview…' : 'Preparing…'}
            </div>
          )}

          {cropping && activeSource && (
            <CropOverlay
              crop={crop}
              sourceWidth={activeSource.info.width || 1920}
              sourceHeight={activeSource.info.height || 1080}
              onChange={setCrop}
            />
          )}

          {!activeItem || !activeSource ? (
            <div className="stage-empty">
              {/* The library beside this holds the clips and the way to add
                  more, so the empty state points at it rather than repeating
                  its buttons. */}
              <p>Pick a clip from the left, or drop a video here.</p>
            </div>
          ) : null}
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
            onSelect={(selection) => {
              setSelected(selection)
              if (selection) setLibraryPicks([])
            }}
            onSeek={handleSeek}
            onMove={handleMove}
            onEditBegin={beginEdit}
            onRemove={handleRemove}
            onGain={handleGain}
            onUnlink={handleUnlink}
            onLink={handleLink}
            onSplit={(lane, both) => handleSplit(playhead, both ? undefined : [lane])}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onReverse={handleReverse}
            onBoomerang={handleBoomerang}
            onCloseGap={handleCloseGap}
            canPaste={clipboard !== null}
            onViewChange={setView}
          />
        </div>

        <TrimControls
          duration={duration}
          currentTime={playhead}
          isPlaying={isPlaying}
          disabled={duration <= 0}
          canRemove={selected !== null}
          onTogglePlay={togglePlay}
          onSplit={() => handleSplit(playhead)}
          onRemove={() => selected && handleRemove(selected.lane, selected.id)}
          onSeek={handleSeek}
          cropping={cropping}
          cropped={isCropped(crop)}
          onToggleCrop={() => setCropping((on) => !on)}
          onResetCrop={() => setCrop(FULL_FRAME)}
          view={view}
          span={fitSpan(duration)}
          onViewChange={setView}
          snap={snapEnabled}
          onSnapChange={(next) => {
            setSnapEnabled(next)
            void window.api.settings.set({ editorSnap: next })
          }}
          onToggleFullscreen={toggleFullscreen}
          loop={loop}
          onToggleLoop={() => setLoop((on) => !on)}
        />

        <PresetPicker
          timeline={exportTimeline}
          crop={isCropped(crop) ? crop : undefined}
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
 * How close a paste must come to an edge to land on it, in seconds.
 *
 * In seconds rather than pixels because a paste has no pointer: it lands where
 * the playhead is, and the playhead was put there by an arrow key or a click,
 * neither of which is trying to be frame-accurate. A quarter of a second is
 * well inside "I meant right there" and nowhere near a gap anyone left on
 * purpose.
 */
const PASTE_SNAP_SECONDS = 0.25

/**
 * How long the editor waits before writing the arrangement down.
 *
 * Long enough that a drag is one write rather than two hundred, short enough
 * that it is always ahead of the user reaching for the close button.
 */
const SAVE_DELAY_MS = 600

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
