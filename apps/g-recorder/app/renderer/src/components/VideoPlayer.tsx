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
  inPoint: number
  outPoint: number
  onTimeUpdate: (seconds: number) => void
  onDurationChange: (seconds: number) => void
  onPlayingChange: (playing: boolean) => void
  onError: (message: string) => void
  /** Play the trimmed range backwards */
  reversed?: boolean
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
 * How often the backwards stand-in asks for a new frame, in milliseconds.
 *
 * See the loop below for why this is nowhere near the frame rate.
 */
const REVERSE_SEEK_INTERVAL_MS = 125

/**
 * Longest the outgoing picture stays up waiting for the incoming one.
 *
 * A preview frozen on the wrong clip is worse than the flash the swap avoids,
 * so a source that never produces a frame is shown anyway and allowed to fail
 * in the open.
 */
const SWAP_LIMIT_MS = 2000

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
    reversed = false,
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
  /** Which clip each element is holding, so a preloaded one can be recognised */
  const holds = useRef<(string | undefined)[]>([undefined, undefined])

  // Keep the latest bounds available to the rAF loop without restarting it
  const boundsRef = useRef({ inPoint, outPoint })
  boundsRef.current = { inPoint, outPoint }

  const soundRef = useRef({ muted, volume })
  soundRef.current = { muted, volume }

  const applySound = useCallback((video: VideoElement | null): void => {
    if (!video) return
    video.muted = soundRef.current.muted
    video.volume = Math.min(Math.max(soundRef.current.volume, 0), 1)
  }, [])

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
      const video = live()
      if (!video) return

      const { outPoint: end } = boundsRef.current
      if (end > 0 && video.currentTime >= end) {
        video.pause()
        video.currentTime = end
        onTimeUpdate(end)
        return
      }

      onTimeUpdate(video.currentTime)
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
  }, [live, onTimeUpdate, stopTracking])

  useEffect(() => stopTracking, [stopTracking])

  // ── Backwards, the hard way ────────────────────────────────────────────────

  /*
   * This is the stand-in, used only until the editor has a reversed copy of the
   * clip to play forwards instead. No video element can run in reverse on its
   * own — `playbackRate` will not go negative and nothing decodes towards the
   * head of a file — so the position is kept here and the element is seeked to
   * it, which is the only way to show a frame earlier than the one on screen.
   *
   * It is deliberately slow. Every seek decodes from the previous keyframe, and
   * asking sixty times a second brought the whole app to its knees on 1440p60
   * footage. So the position moves with the wall clock, the clip takes the time
   * it should, and the picture is refreshed a few times a second: enough to see
   * where you are while the real copy is being made.
   */
  const reversing = useRef(false)
  const reverseTarget = useRef(0)
  const reverseFrame = useRef<number | null>(null)
  const lastSeekAt = useRef(0)
  const reversedRef = useRef(reversed)
  reversedRef.current = reversed

  const stopReverse = useCallback(() => {
    if (reverseFrame.current !== null) {
      cancelAnimationFrame(reverseFrame.current)
      reverseFrame.current = null
    }
    if (!reversing.current) return
    reversing.current = false
    onPlayingChange(false)
  }, [onPlayingChange])

  const startReverse = useCallback(() => {
    const video = live()
    if (!video) return

    video.pause()
    stopTracking()

    const { inPoint: start, outPoint: end } = boundsRef.current
    // Reaching the head is this direction's version of reaching the end, so
    // pressing play there starts the clip again from its tail.
    const from = video.currentTime
    reverseTarget.current = from <= start + 0.01 || from > end ? end : from

    reversing.current = true
    lastSeekAt.current = 0
    onPlayingChange(true)

    let last = performance.now()
    const tick = (): void => {
      const element = live()
      if (!element || !reversing.current) return

      const now = performance.now()
      // A stalled frame must not be paid back all at once: a hidden window or a
      // slow seek would otherwise jump the clip instead of resuming it.
      const elapsed = Math.min((now - last) / 1000, 0.25)
      last = now

      const head = boundsRef.current.inPoint
      reverseTarget.current -= elapsed

      if (reverseTarget.current <= head) {
        reverseTarget.current = head
        element.currentTime = head
        onTimeUpdate(head)
        stopReverse()
        return
      }

      /*
       * Asked for at a fraction of the frame rate on purpose. Every one of
       * these seeks decodes from the previous keyframe — up to a hundred and
       * twenty frames of 1440p60 — so at sixty a second the machine has no
       * chance and the whole app crawls. This is the stand-in shown only while
       * the reversed copy is being built, so a few pictures a second is enough
       * to see where you are.
       */
      if (!element.seeking && now - lastSeekAt.current >= REVERSE_SEEK_INTERVAL_MS) {
        lastSeekAt.current = now
        element.currentTime = reverseTarget.current
      }

      onTimeUpdate(reverseTarget.current)
      reverseFrame.current = requestAnimationFrame(tick)
    }

    reverseFrame.current = requestAnimationFrame(tick)
  }, [live, onPlayingChange, onTimeUpdate, stopReverse, stopTracking])

  // ── Swapping one clip for the next ─────────────────────────────────────────

  const startPlaying = useCallback(
    (video: VideoElement | null): void => {
      if (!video) return

      if (reversedRef.current) {
        startReverse()
        return
      }

      const { inPoint: start, outPoint: end } = boundsRef.current
      // Restart from IN when the playhead sits outside the selection
      if (video.currentTime < start || video.currentTime >= end - 0.01) {
        video.currentTime = start
      }
      void video.play().catch(() => undefined)
    },
    [startReverse],
  )

  /** Put the loaded element on screen and retire the one that was there */
  const finishSwap = useCallback(() => {
    if (!swapping.current) return
    swapping.current = false

    const outgoing = live()
    const incoming = standby()
    outgoing?.pause()
    if (outgoing) outgoing.muted = true

    shownRef.current = 1 - shownRef.current
    setShown(shownRef.current)
    applySound(incoming)
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
      holds.current[slot] = id
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
    if (showing && showing.currentSrc === src && holds.current[slot] === clipId) return

    /*
     * Already waiting in the wings, loaded and positioned before the cut came:
     * it goes straight on screen. This is what makes a cut instant rather than
     * a freeze on the last frame while the next clip loads.
     */
    const incoming = standby()
    const ready = incoming && incoming.readyState >= 2 && !incoming.seeking
    if (ready && holds.current[1 - slot] === clipId && incoming.currentSrc === src) {
      swapping.current = true
      finishSwap()
      return
    }

    swapping.current = true
    loadStandby(clipId, src, null)

    // A picture that never arrives must not leave the wrong one up for ever.
    const giveUp = setTimeout(finishSwap, SWAP_LIMIT_MS)
    return () => clearTimeout(giveUp)
  }, [clipId, finishSwap, live, loadStandby, src, standby])

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
    if (holds.current[1 - shownRef.current] === preload.id) return

    loadStandby(preload.id, preload.src, preload.at)
  }, [loadStandby, preload, shown])

  // Turning a clip round mid-play leaves the loop running the wrong way.
  useEffect(() => {
    stopReverse()
    live()?.pause()
  }, [live, reversed, src, stopReverse])

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
        stopReverse()
        live()?.pause()
      },
      togglePlay: () => {
        const video = live()
        if (!video) return

        if (reversedRef.current) {
          if (reversing.current) stopReverse()
          else startReverse()
          return
        }

        if (swapping.current) {
          resumeOnSwap.current = !resumeOnSwap.current
          return
        }

        if (video.paused) startPlaying(video)
        else video.pause()
      },
      seek: (seconds: number) => {
        const { video, slot } = target()
        if (!video) return

        // A seek during backwards playback moves where it is playing from, not
        // only what is on screen: without this the loop would pull the picture
        // straight back to where it had got to.
        reverseTarget.current = seconds

        if (video.readyState === 0) {
          pendingSeek.current[slot] = seconds
          return
        }

        video.currentTime = seconds
        // Only the visible clip's position is the playhead's business.
        if (!swapping.current) onTimeUpdate(seconds)
      },
      nudge: (deltaSeconds: number) => {
        const video = live()
        if (!video) return

        const { inPoint: start, outPoint: end } = boundsRef.current
        const next = Math.min(Math.max(video.currentTime + deltaSeconds, start), end)
        video.currentTime = next
        onTimeUpdate(next)
      },
      currentTime: () => live()?.currentTime ?? 0,
    }),
    [live, onTimeUpdate, startPlaying, startReverse, stopReverse, target],
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
          // Backwards, a clip opens on its last frame, not its first.
          const opensAt = reversedRef.current
            ? boundsRef.current.outPoint
            : boundsRef.current.inPoint
          video.currentTime = pending ?? opensAt
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

          // While playing backwards the loop is already reporting the position
          // it asked for. Reporting where the seek actually landed on top of
          // that makes the playhead stutter between the two.
          if (reversing.current) return
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
