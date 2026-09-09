import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

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
   * Playing backwards.
   *
   * No video element can do it: `playbackRate` will not go negative, and there
   * is no API that decodes towards the head of a file. So the position is kept
   * here and the element is seeked to it, which is the only way to show a frame
   * from earlier than the one on screen.
   *
   * Two rules keep it watchable. The position moves with the wall clock, so the
   * clip takes the time it should however slow the seeks are; and a new seek is
   * only asked for once the last one has landed, because a queue of them never
   * catches up and the picture falls further behind every second. What gives
   * way under load is the frame rate, which is the right thing to lose.
   */
  const reversing = useRef(false)
  const reverseTarget = useRef(0)
  const reversedRef = useRef(reversed)
  reversedRef.current = reversed

  const stopReverse = useCallback(() => {
    if (!reversing.current) return
    reversing.current = false
    stopTracking()
    onPlayingChange(false)
  }, [onPlayingChange, stopTracking])

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
        element.currentTime = head
        onTimeUpdate(head)
        stopReverse()
        return
      }

      if (!element.seeking) element.currentTime = reverseTarget.current
      onTimeUpdate(reverseTarget.current)
      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
  }, [onPlayingChange, onTimeUpdate, stopReverse, stopTracking])

  // Turning a clip round mid-play leaves the loop running the wrong way.
  useEffect(() => {
    stopReverse()
    videoRef.current?.pause()
  }, [reversed, src, stopReverse])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!src) {
      video.removeAttribute('src')
      video.load()
      return
    }

    // A seek meant for the file being replaced does not belong to the new one.
    if (video.currentSrc !== src) pendingSeek.current = null
    video.src = src
    video.load()
  }, [src])

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
        // While playing backwards the loop is already reporting the position it
        // asked for. Reporting where the seek actually landed on top of that
        // makes the playhead stutter between the two.
        if (reversing.current) return
        if (videoRef.current) onTimeUpdate(videoRef.current.currentTime)
      }}
      onError={() => onError('This video could not be played. It may still be finishing writing.')}
    />
  )
})

export default VideoPlayer
