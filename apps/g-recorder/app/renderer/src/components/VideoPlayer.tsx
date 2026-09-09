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

interface VideoPlayerProps {
  /** clip:// URL produced by the main process */
  src?: string
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

/**
 * Preview surface for the editor.
 *
 * Playback is confined to the trimmed range: pressing play from outside the
 * selection jumps to IN, and playback stops at OUT. That makes the IN/OUT
 * handles feel like a real selection rather than two disconnected numbers.
 */
/**
 * How often the backwards stand-in asks for a new frame, in milliseconds.
 *
 * See the loop below for why this is nowhere near the frame rate.
 */
const REVERSE_SEEK_INTERVAL_MS = 125

/**
 * Longest a held frame stays up waiting for the next one.
 *
 * A still picture that never gives way is worse than the flash it was hiding,
 * so a source that never produces a frame gets the black it earned.
 */
const HOLD_LIMIT_MS = 2000

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    src,
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<number | null>(null)
  /*
   * A seek asked for before the file has any metadata.
   *
   * Setting currentTime on an unloaded element is silently dropped, so clicking
   * into the middle of a clip whose source had not been shown yet landed at its
   * start instead. Held here and applied the moment the duration is known.
   */
  const pendingSeek = useRef<number | null>(null)

  // Keep the latest bounds available to the rAF loop without restarting it
  const boundsRef = useRef({ inPoint, outPoint })
  boundsRef.current = { inPoint, outPoint }

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
      const video = videoRef.current
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
  }, [onTimeUpdate, stopTracking])

  useEffect(() => stopTracking, [stopTracking])

  /*
   * Playing backwards, the hard way.
   *
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
    const video = videoRef.current
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
      const element = videoRef.current
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
  }, [onPlayingChange, onTimeUpdate, stopReverse, stopTracking])

  // Turning a clip round mid-play leaves the loop running the wrong way.
  useEffect(() => {
    stopReverse()
    videoRef.current?.pause()
  }, [reversed, src, stopReverse])

  /*
   * The last frame of the outgoing clip, held on screen while the next one
   * loads.
   *
   * Changing a video element's source empties it, and it paints its background
   * until the new file has a frame to show — so playing across a cut where the
   * two clips come from different files (or from a clip and its reversed copy)
   * flashed black every time. The frame is copied to a canvas laid exactly over
   * the picture and dropped the moment there is something to replace it with.
   *
   * Only drawn to, never read back: a clip:// source taints the canvas, which
   * makes reading the pixels out illegal but drawing them perfectly fine.
   */
  const holdRef = useRef<HTMLCanvasElement>(null)
  /*
   * Whether the held frame is on screen, as state rather than a property set on
   * the element. React rewrites `hidden` on every render, so showing the canvas
   * by hand lasted exactly until the next one — which, with the playhead moving,
   * is the same frame.
   */
  const [holding, setHolding] = useState(false)

  const releaseHold = useCallback(() => setHolding(false), [])

  /**
   * Let go once there is really a picture, not merely a loaded file.
   *
   * `loadeddata` fires with readyState still at HAVE_METADATA — measured: the
   * event at 19 ms, the first frame at 90 ms — so releasing on it put the black
   * back for seventy milliseconds, which is exactly the flash this is here to
   * remove. requestVideoFrameCallback fires when a frame has been presented,
   * which is the only signal that means what is wanted.
   */
  const releaseWhenPainted = useCallback(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
      | null

    if (!video) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => setHolding(false))
      return
    }

    setHolding(false)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!src) {
      video.removeAttribute('src')
      video.load()
      releaseHold()
      return
    }

    // HAVE_CURRENT_DATA or better: there is a frame on screen worth keeping.
    const canvas = holdRef.current
    if (canvas && video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      setHolding(true)
    }

    // A seek meant for the file being replaced does not belong to the new one.
    if (video.currentSrc !== src) pendingSeek.current = null
    video.src = src
    video.load()

    // A frame that never arrives must not leave a still image in its place.
    const giveUp = setTimeout(releaseHold, HOLD_LIMIT_MS)
    return () => clearTimeout(giveUp)
  }, [releaseHold, src])

  /*
   * Set on the element rather than written as attributes: `volume` has no
   * attribute at all, and `muted` as one is only the initial value — React
   * would stop changing it after the first render.
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    video.muted = muted
    video.volume = Math.min(Math.max(volume, 0), 1)
  }, [muted, volume, src])

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const video = videoRef.current
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
      pause: () => {
        stopReverse()
        videoRef.current?.pause()
      },
      togglePlay: () => {
        const video = videoRef.current
        if (!video) return

        if (reversedRef.current) {
          if (reversing.current) stopReverse()
          else startReverse()
          return
        }

        if (video.paused) {
          const { inPoint: start, outPoint: end } = boundsRef.current
          if (video.currentTime < start || video.currentTime >= end - 0.01) {
            video.currentTime = start
          }
          void video.play().catch(() => undefined)
        } else {
          video.pause()
        }
      },
      seek: (seconds: number) => {
        const video = videoRef.current
        if (!video) return

        // A seek during backwards playback moves where it is playing from, not
        // only what is on screen: without this the loop would pull the picture
        // straight back to where it had got to.
        reverseTarget.current = seconds

        if (video.readyState === 0) {
          pendingSeek.current = seconds
          return
        }

        video.currentTime = seconds
        onTimeUpdate(seconds)
      },
      nudge: (deltaSeconds: number) => {
        const video = videoRef.current
        if (!video) return

        const { inPoint: start, outPoint: end } = boundsRef.current
        const next = Math.min(Math.max(video.currentTime + deltaSeconds, start), end)
        video.currentTime = next
        onTimeUpdate(next)
      },
      currentTime: () => videoRef.current?.currentTime ?? 0,
    }),
    [onTimeUpdate, startReverse, stopReverse],
  )

  return (
    <>
      {/* Hidden until there is a frame to hold; see the effect above. */}
      <canvas ref={holdRef} className="stage-hold" style={style} hidden={!holding} />

      <video
        ref={videoRef}
        style={style}
        playsInline
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          if (Number.isFinite(video.duration)) onDurationChange(video.duration)

          const pending = pendingSeek.current
          pendingSeek.current = null
          // Backwards, a clip opens on its last frame, not its first.
          const opensAt = reversedRef.current
            ? boundsRef.current.outPoint
            : boundsRef.current.inPoint
          video.currentTime = pending ?? opensAt
        }}
        // There is a picture on the way; the held frame goes when it arrives.
        onLoadedData={releaseWhenPainted}
        onPlay={() => {
          onPlayingChange(true)
          startTracking()
        }}
        onPause={() => {
          onPlayingChange(false)
          stopTracking()
          if (videoRef.current) onTimeUpdate(videoRef.current.currentTime)
        }}
        onSeeked={() => {
          releaseWhenPainted()
          // While playing backwards the loop is already reporting the position
          // it asked for. Reporting where the seek actually landed on top of
          // that makes the playhead stutter between the two.
          if (reversing.current) return
          if (videoRef.current) onTimeUpdate(videoRef.current.currentTime)
        }}
        onError={(event) => {
          /*
           * The element's own reason, not a guess at one. "It may still be
           * finishing writing" was a plausible cause printed for every failure,
           * which made a decode error and a missing file read identically.
           */
          releaseHold()
          const detail = event.currentTarget.error?.message?.trim()
          onError(
            detail
              ? `This video could not be played: ${detail}`
              : 'This video could not be played. It may still be finishing writing.',
          )
        }}
      />
    </>
  )
})

export default VideoPlayer
