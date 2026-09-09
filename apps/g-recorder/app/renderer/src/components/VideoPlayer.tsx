import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface VideoPlayerHandle {
  play: () => void
  pause: () => void
  togglePlay: () => void
  seek: (seconds: number) => void
  /** Move by a delta, clamped to the trimmed range */
  nudge: (deltaSeconds: number) => void
  currentTime: () => number
}

/** A clip waiting out of sight, so the cut to it costs nothing */
export interface PlayerPreload {
  /** The clip it is, so a second cut to the same file is still a cut */
  id: string
  src: string
  /** Where it should start, in its own timebase */
  at: number
}

interface VideoPlayerProps {
  /** clip:// URL produced by the main process */
  src?: string
  /**
   * Which clip is on screen.
   *
   * A change means a cut, even between two clips of the same file: the second
   * half of a split needs the same swap the picture would need for a different
   * source, or the preview freezes on the last frame while it seeks.
   */
  clipId?: string
  /** What comes after it, loaded and positioned before the cut arrives */
  preload?: PlayerPreload | null
  /**
   * The preloaded clip has taken the screen, on the player's own initiative.
   *
   * Playback hands over before the editor has asked it to — that is the whole
   * point of the pre-roll below — so the editor is told after the fact and
   * catches its own state up. It must not seek or play in response: the clip
   * is already running, and touching it would undo the seamless join.
   */
  onHandover?: () => void
  inPoint: number
  outPoint: number
  onTimeUpdate: (seconds: number) => void
  onDurationChange: (seconds: number) => void
  onPlayingChange: (playing: boolean) => void
  onError: (message: string) => void
  /** Silence the preview — what the audio lane says when there is nothing under the clip */
  muted?: boolean
  /** 0 to 1, from the clip's gain */
  volume?: number
  /** Set by the editor to show a crop: the element is moved and scaled */
  style?: React.CSSProperties
}

/** An element with the frame callback Chromium provides and the DOM types do not */
type VideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
}

/**
 * Longest the outgoing picture stays up waiting for the incoming one.
 *
 * A preview frozen on the wrong clip is worse than the flash the swap avoids,
 * so a source that never produces a frame is shown anyway and allowed to fail
 * in the open.
 */
const SWAP_LIMIT_MS = 2000

/**
 * How long before a cut the incoming clip is set running.
 *
 * A media element does not start when told to. Measured here: play() returns at
 * once and the clock starts, but no frame reaches the screen for about fifty
 * milliseconds — and the clock does not wait for the picture, so those three
 * frames are simply skipped. Starting the clip at the cut therefore drops the
 * first fiftieth of a second of it every time, which is the jump that reads as
 * the picture briefly speeding up.
 *
 * So it is started early, silent and out of sight, and is already running by
 * the time it is needed. The value only has to cover that start-up; more just
 * means the clip is warm for longer.
 */
const PREROLL_SECONDS = 0.12

/**
 * How far the incoming clip must have travelled to count as running.
 *
 * Starting is not one event but two: the clock begins at once, and the pictures
 * follow. Measured here, an element reports three milliseconds of progress,
 * stops for thirty-five while the decoder fills, and only then runs. Anything
 * short of a couple of frames of real progress is still that first twitch.
 */
const WARMED_SECONDS = 2 / 60

/** As late as the pre-roll is ever allowed to get, however often it is short */
const MAX_PREROLL_SECONDS = 0.3

/** Longest a hand-over waits for the editor to acknowledge it */
const SETTLE_LIMIT_MS = 500

/**
 * Preview surface for the editor.
 *
 * Playback is confined to the trimmed range: pressing play from outside the
 * selection jumps to IN, and playback stops at OUT. That makes the IN/OUT
 * handles feel like a real selection rather than two disconnected numbers.
 *
 * There are two video elements, not one. Changing a single element's source
 * empties it, and it paints its background until the new file has decoded a
 * frame — so every cut between two different files, or between a clip and the
 * reversed copy standing in for it, flashed black. The incoming clip is loaded
 * and seeked in the element that is not on screen, and the two are swapped only
 * once it has a frame to show; the outgoing one holds its last frame until then.
 *
 * Copying that frame to a canvas was tried first and is not an option: on this
 * hardware `drawImage` of a paused video returns black, which is precisely the
 * thing being hidden. Two elements never read a frame back at all.
 *
 * While playing, the cut is not waited for either. The clip that is coming is
 * set running behind the picture a tenth of a second early, and the two are
 * exchanged at the moment the incoming one has travelled as far past its start
 * as the outgoing one has left to go. Both give up the same sliver, so a clip
 * played next to its own reverse turns round on the frame they share and the
 * motion never breaks.
 */
const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    src,
    clipId,
    preload,
    inPoint,
    outPoint,
    onTimeUpdate,
    onDurationChange,
    onPlayingChange,
    onError,
    onHandover,
    muted = false,
    volume = 1,
    style,
  },
  ref,
) {
  const slots = useRef<(VideoElement | null)[]>([null, null])
  /*
   * Which element is on screen, as state so it renders, and as a ref so the
   * callbacks below can read it without being rebuilt on every swap.
   */
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)

  const live = useCallback((): VideoElement | null => slots.current[shownRef.current], [])
  const standby = useCallback((): VideoElement | null => slots.current[1 - shownRef.current], [])

  /** A swap in flight: the standby is loading what should be on screen next */
  const swapping = useRef(false)
  /** Whether the incoming clip should start playing the moment it appears */
  const resumeOnSwap = useRef(false)

  /*
   * A seek asked for before the file has any metadata, one slot each.
   *
   * Setting currentTime on an unloaded element is silently dropped, so clicking
   * into the middle of a clip whose source had not been shown yet landed at its
   * start instead. Held here and applied the moment the duration is known.
   */
  const pendingSeek = useRef<(number | null)[]>([null, null])
  /*
   * What each element is holding: the clip AND the file it is playing it from.
   *
   * Both, because they can disagree. A reversed clip is played from a copy that
   * takes a second to write, so the clip after this one is first offered as its
   * original file and only later as the copy — and keying on the clip alone
   * meant the standby was never told about the swap. It sat holding the wrong
   * file until the cut, and then loaded the right one from scratch at exactly
   * the moment it was needed: measured, the picture stopped for a tenth of a
   * second at every join, which is the hesitation that reads as the clip
   * suddenly speeding up afterwards.
   */
  const holds = useRef<(string | undefined)[]>([undefined, undefined])
  const held = (id: string | undefined, source: string): string => `${id ?? ''}|${source}`

  // Keep the latest bounds available to the rAF loop without restarting it
  const boundsRef = useRef({ inPoint, outPoint })
  boundsRef.current = { inPoint, outPoint }

  const soundRef = useRef({ muted, volume })
  soundRef.current = { muted, volume }

  /*
   * The editor's own callback, read fresh every frame.
   *
   * The frame loop is started once and runs across cuts, so whatever it closed
   * over it keeps. That was harmless while every cut stopped playback and
   * started the loop again — and stopped being harmless the moment the player
   * began handing over without pausing: it went on reporting positions through
   * the clip that had already left, and the playhead read as though playback
   * had jumped back to the start of the timeline.
   */
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate

  // What is on screen, for the callbacks that run outside a render
  const clipIdRef = useRef(clipId)
  clipIdRef.current = clipId
  const srcRef = useRef(src)
  srcRef.current = src

  const applySound = useCallback((video: VideoElement | null): void => {
    if (!video) return
    video.muted = soundRef.current.muted
    video.volume = Math.min(Math.max(soundRef.current.volume, 0), 1)
  }, [])

  // ── Handing over to the next clip while playing ────────────────────────────

  // Read from the animation frame, which must not be rebuilt to see a new value
  const preloadRef = useRef(preload)
  preloadRef.current = preload
  const onHandoverRef = useRef(onHandover)
  onHandoverRef.current = onHandover

  /** The standby running silently towards a cut, and where it was let go from */
  const preroll = useRef<{ from: number; moved: boolean } | null>(null)
  /**
   * How long this machine needs to get a video element moving.
   *
   * Only ever lengthened, and only by a hand-over that found the incoming clip
   * still not running. Shortening it on a good measurement was tried and is a
   * trap: the first moments after play() report progress while the decoder is
   * still empty, so the reading comes back at a few milliseconds, the next
   * pre-roll starts that late, and the stall it was meant to hide lands in the
   * middle of the cut. Measured, that put a three-frame freeze on the loop
   * while the join before it was clean.
   */
  const ramp = useRef(PREROLL_SECONDS)
  /** A hand-over waiting to be acknowledged, so the old bounds are not applied */
  const settling = useRef<{ id: string | undefined; until: number } | null>(null)

  /** Put the pre-rolled clip back where it was waiting */
  const cancelPreroll = useCallback((): void => {
    const running = preroll.current
    if (!running) return
    preroll.current = null

    const waiting = standby()
    if (!waiting) return
    waiting.pause()
    waiting.currentTime = running.from
  }, [standby])

  /**
   * Exchange the two elements mid-flight: the standby is already playing.
   *
   * Nothing is started here and nothing is seeked — that is the point. The only
   * change is which element is visible, which is one style flag and lands in
   * the frame it is made in.
   */
  const finishHandover = useCallback((): void => {
    const incoming = standby()
    if (!incoming) return

    const arrived = preloadRef.current
    /*
     * Handed over with the incoming clip still not moving: it was started too
     * late to be up to speed, and the frames it skips getting there are the
     * hitch this whole arrangement exists to remove. Start earlier next time.
     */
    if (preroll.current && !preroll.current.moved) {
      ramp.current = Math.min(ramp.current * 1.4, MAX_PREROLL_SECONDS)
    }
    preroll.current = null

    const outgoing = live()
    outgoing?.pause()
    if (outgoing) outgoing.muted = true

    shownRef.current = 1 - shownRef.current
    setShown(shownRef.current)
    applySound(incoming)
    holds.current[shownRef.current] = held(arrived?.id, arrived?.src ?? '')
    holds.current[1 - shownRef.current] = undefined

    // The pre-roll can fail — a source that will not decode, a play() refused.
    // The clip still has to take the screen, so it does, and starts late.
    if (incoming.paused) void incoming.play().catch(() => undefined)

    settling.current = { id: arrived?.id, until: performance.now() + SETTLE_LIMIT_MS }
    onHandoverRef.current?.()
  }, [applySound, live, standby])

  /**
   * Start the next clip early, then hand over when the two meet.
   *
   * The meeting point is where the incoming clip has run as far past its start
   * as the outgoing one has left to reach its end. Each gives up the same
   * amount, and for a clip laid beside its own reverse those two amounts are
   * the same frame — so the picture turns round without a seam. Returns whether
   * the screen changed hands.
   */
  const armHandover = useCallback(
    (remaining: number): boolean => {
      const waiting = standby()
      const next = preloadRef.current
      if (!waiting || !next || swapping.current) return false
      // Only the clip that was actually made ready may be handed to.
      if (holds.current[1 - shownRef.current] !== held(next.id, next.src)) return false

      const running = preroll.current
      if (running) {
        // With a pre-roll that never moved this is simply the clip's end.
        const travelled = Math.max(waiting.currentTime - running.from, 0)
        running.moved = running.moved || travelled >= WARMED_SECONDS

        if (remaining > travelled) return false
        finishHandover()
        return true
      }

      if (remaining > ramp.current) return false
      if (!waiting.paused || waiting.seeking || waiting.readyState < 3) return false

      preroll.current = { from: waiting.currentTime, moved: false }
      // Two clips must never be heard at once; it is unmuted as it appears.
      waiting.muted = true
      void waiting.play().catch(() => {
        preroll.current = null
      })
      return false
    },
    [finishHandover, standby],
  )

  // ── Playhead tracking ───────────────────────────────────────────────────────

  const frameRef = useRef<number | null>(null)

  const stopTracking = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  /** Report the playhead every frame while playing — timeupdate is far too coarse */
  const startTracking = useCallback(() => {
    stopTracking()

    const tick = (): void => {
      // Booked first, so the paths that only watch and wait keep the loop alive
      frameRef.current = requestAnimationFrame(tick)

      const video = live()
      if (!video) {
        stopTracking()
        return
      }

      /*
       * A hand-over the editor has not caught up with yet. Its bounds still
       * describe the clip that left, and a clip stopped at another clip's out
       * point ends in the wrong place — or instantly, if that point is already
       * behind it.
       */
      const acknowledging = settling.current
      if (acknowledging) {
        if (clipIdRef.current !== acknowledging.id && performance.now() < acknowledging.until) return
        settling.current = null
      }

      const { outPoint: end } = boundsRef.current
      const remaining = end > 0 ? end - video.currentTime : Number.POSITIVE_INFINITY

      if (armHandover(remaining)) return

      /*
       * Nothing is reported once the next clip is on its way. The editor reads
       * a position at the clip's edge as "hand over now" and would start doing
       * by itself what is already half done here — seeking and playing the very
       * element that is quietly running. The playhead pauses for a tenth of a
       * second before a cut and then continues on the next clip.
       */
      if (preroll.current) return

      if (end > 0 && video.currentTime >= end) {
        /*
         * Paused where it got to, not seeked back to the edge. Seeking to the
         * out point shows the frame that starts at it — the first frame of what
         * comes NEXT, which is a jerk forward at the end of every clip — and it
         * is one more seek to wait out at the very moment the next clip is
         * trying to take over.
         */
        video.pause()
        stopTracking()
        onTimeUpdateRef.current(end)
        return
      }

      onTimeUpdateRef.current(video.currentTime)
    }

    frameRef.current = requestAnimationFrame(tick)
  }, [armHandover, live, stopTracking])

  useEffect(() => stopTracking, [stopTracking])

  // ── Swapping one clip for the next ─────────────────────────────────────────

  const startPlaying = useCallback(
    (video: VideoElement | null): void => {
      if (!video) return

      const { inPoint: start, outPoint: end } = boundsRef.current
      // Restart from IN when the playhead sits outside the selection
      if (video.currentTime < start || video.currentTime >= end - 0.01) {
        video.currentTime = start
      }
      void video.play().catch(() => undefined)
    },
    [],
  )

  /** Put the loaded element on screen and retire the one that was there */
  const finishSwap = useCallback(() => {
    if (!swapping.current) return
    swapping.current = false
    // Whatever the standby was being warmed up for, it is on screen now.
    preroll.current = null
    settling.current = null

    const outgoing = live()
    const incoming = standby()
    outgoing?.pause()
    if (outgoing) outgoing.muted = true

    shownRef.current = 1 - shownRef.current
    setShown(shownRef.current)
    applySound(incoming)
    // The element taking the screen is holding what the editor asked to show.
    holds.current[shownRef.current] = held(clipIdRef.current, srcRef.current ?? '')
    holds.current[1 - shownRef.current] = undefined

    if (resumeOnSwap.current) {
      resumeOnSwap.current = false
      startPlaying(incoming)
    }
  }, [applySound, live, standby, startPlaying])

  /**
   * Swap once the incoming element has really shown a frame.
   *
   * Not on `loadeddata`: it fires with readyState still at HAVE_METADATA —
   * measured at 19 ms against a first frame at 90 ms — so swapping on it puts
   * the black straight back. requestVideoFrameCallback fires when a frame has
   * been presented, which is the only signal that means what is wanted.
   */
  const swapWhenPainted = useCallback(() => {
    const incoming = standby()
    if (!incoming || !swapping.current) return

    if (typeof incoming.requestVideoFrameCallback === 'function') {
      incoming.requestVideoFrameCallback(finishSwap)
      return
    }

    finishSwap()
  }, [finishSwap, standby])

  /** Put a clip into the element that is not on screen, ready to take over */
  const loadStandby = useCallback(
    (id: string | undefined, source: string, at: number | null): void => {
      const incoming = standby()
      if (!incoming) return

      const slot = 1 - shownRef.current
      holds.current[slot] = held(id, source)
      pendingSeek.current[slot] = at
      // Silent until it takes over, or both clips would be heard at once.
      incoming.muted = true
      incoming.src = source
      incoming.load()
    },
    [standby],
  )

  useEffect(() => {
    if (!src) {
      for (const video of slots.current) {
        if (!video) continue
        video.removeAttribute('src')
        video.load()
      }
      holds.current = [undefined, undefined]
      swapping.current = false
      return
    }

    const slot = shownRef.current
    const showing = live()
    if (showing && showing.currentSrc === src && holds.current[slot] === held(clipId, src)) return

    /*
     * Already waiting in the wings, loaded and positioned before the cut came:
     * it goes straight on screen. This is what makes a cut instant rather than
     * a freeze on the last frame while the next clip loads.
     */
    const incoming = standby()
    const ready = incoming && incoming.readyState >= 2 && !incoming.seeking
    if (ready && holds.current[1 - slot] === held(clipId, src)) {
      swapping.current = true
      finishSwap()
      return
    }

    // The editor has asked for something other than what was being warmed up.
    cancelPreroll()
    swapping.current = true
    loadStandby(clipId, src, null)

    // A picture that never arrives must not leave the wrong one up for ever.
    const giveUp = setTimeout(finishSwap, SWAP_LIMIT_MS)
    return () => clearTimeout(giveUp)
  }, [cancelPreroll, clipId, finishSwap, live, loadStandby, src, standby])

  /*
   * The clip after this one, fetched while there is still time.
   *
   * Loading at the cut is what the freeze was: a file has to be opened, its
   * headers read and a frame decoded, and none of that can happen inside a
   * frame. Doing it a clip early costs one idle decoder and buys a cut with
   * nothing in it.
   */
  useEffect(() => {
    if (swapping.current || !preload) return
    if (holds.current[1 - shownRef.current] === held(preload.id, preload.src)) return

    // What was being warmed up is no longer what comes next.
    cancelPreroll()
    loadStandby(preload.id, preload.src, preload.at)
  }, [cancelPreroll, loadStandby, preload, shown])

  // A clip turned round mid-play is a different clip; it does not carry on.
  useEffect(() => {
    const video = live()
    // Unless it is already playing it: a hand-over the player made for itself
    // arrives here as a changed source, and stopping it would be stopping the
    // very thing the hand-over was for.
    if (!video || video.currentSrc === src) return
    video.pause()
  }, [live, src])

  useEffect(() => applySound(live()), [applySound, live, muted, volume, shown])

  // ── The editor's handle on all this ────────────────────────────────────────

  /** Where a seek or a play should land: the incoming clip if one is on its way */
  const target = useCallback(
    (): { video: VideoElement | null; slot: number } =>
      swapping.current
        ? { video: standby(), slot: 1 - shownRef.current }
        : { video: live(), slot: shownRef.current },
    [live, standby],
  )

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        // Playing what is about to be replaced would be a second of the wrong
        // clip; the swap starts it instead, the moment it is on screen.
        if (swapping.current) {
          resumeOnSwap.current = true
          return
        }
        startPlaying(live())
      },
      pause: () => {
        resumeOnSwap.current = false
        cancelPreroll()
        live()?.pause()
      },
      togglePlay: () => {
        const video = live()
        if (!video) return

        if (swapping.current) {
          resumeOnSwap.current = !resumeOnSwap.current
          return
        }

        if (video.paused) startPlaying(video)
        else {
          cancelPreroll()
          video.pause()
        }
      },
      seek: (seconds: number) => {
        // A cut being prepared is a cut somewhere the playhead is leaving.
        cancelPreroll()
        const { video, slot } = target()
        if (!video) return

        if (video.readyState === 0) {
          pendingSeek.current[slot] = seconds
          return
        }

        video.currentTime = seconds
        // Only the visible clip's position is the playhead's business.
        if (!swapping.current) onTimeUpdate(seconds)
      },
      nudge: (deltaSeconds: number) => {
        cancelPreroll()
        const video = live()
        if (!video) return

        const { inPoint: start, outPoint: end } = boundsRef.current
        const next = Math.min(Math.max(video.currentTime + deltaSeconds, start), end)
        video.currentTime = next
        onTimeUpdate(next)
      },
      currentTime: () => live()?.currentTime ?? 0,
    }),
    [cancelPreroll, live, onTimeUpdate, startPlaying, target],
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  const element = (slot: number): JSX.Element => {
    const isShown = slot === shown

    return (
      <video
        key={slot}
        ref={(node) => {
          slots.current[slot] = node as VideoElement | null
        }}
        className={`stage-video${isShown ? '' : ' is-standby'}`}
        style={style}
        playsInline
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          if (slot === shownRef.current && Number.isFinite(video.duration)) {
            onDurationChange(video.duration)
          }

          const pending = pendingSeek.current[slot]
          pendingSeek.current[slot] = null
          video.currentTime = pending ?? boundsRef.current.inPoint
        }}
        onLoadedData={() => {
          if (slot !== shownRef.current && swapping.current) swapWhenPainted()
        }}
        onPlay={() => {
          if (slot !== shownRef.current) return
          onPlayingChange(true)
          startTracking()
        }}
        onPause={() => {
          if (slot !== shownRef.current) return
          onPlayingChange(false)
          stopTracking()
          onTimeUpdate(slots.current[slot]?.currentTime ?? 0)
        }}
        onSeeked={() => {
          if (slot !== shownRef.current) {
            // The incoming clip has landed where it was asked to. It can go on
            // screen as soon as it has a frame there — unless it is only being
            // kept ready for later, in which case it waits where it is.
            if (swapping.current) swapWhenPainted()
            return
          }

          onTimeUpdate(slots.current[slot]?.currentTime ?? 0)
        }}
        onError={(event) => {
          /*
           * The element's own reason, not a guess at one. "It may still be
           * finishing writing" was a plausible cause printed for every failure,
           * which made a decode error and a missing file read identically.
           */
          if (slot !== shownRef.current) {
            // A source that cannot be played is still what the editor asked to
            // show, so it takes the screen and reports itself.
            finishSwap()
          }

          const detail = event.currentTarget.error?.message?.trim()
          onError(
            detail
              ? `This video could not be played: ${detail}`
              : 'This video could not be played. It may still be finishing writing.',
          )
        }}
      />
    )
  }

  return (
    <>
      {element(0)}
      {element(1)}
    </>
  )
})

export default VideoPlayer
