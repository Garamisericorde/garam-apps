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
}

/**
 * Preview surface for the editor.
 *
 * Playback is confined to the trimmed range: pressing play from outside the
 * selection jumps to IN, and playback stops at OUT. That makes the IN/OUT
 * handles feel like a real selection rather than two disconnected numbers.
 */
const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, inPoint, outPoint, onTimeUpdate, onDurationChange, onPlayingChange, onError },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const frameRef = useRef<number | null>(null)

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

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!src) {
      video.removeAttribute('src')
      video.load()
      return
    }

    video.src = src
    video.load()
  }, [src])

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const video = videoRef.current
        if (!video) return

        const { inPoint: start, outPoint: end } = boundsRef.current
        // Restart from IN when the playhead sits outside the selection
        if (video.currentTime < start || video.currentTime >= end - 0.01) {
          video.currentTime = start
        }
        void video.play().catch(() => undefined)
      },
      pause: () => videoRef.current?.pause(),
      togglePlay: () => {
        const video = videoRef.current
        if (!video) return
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
    [onTimeUpdate],
  )

  return (
    <video
      ref={videoRef}
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget
        if (Number.isFinite(video.duration)) onDurationChange(video.duration)
        video.currentTime = boundsRef.current.inPoint
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
        if (videoRef.current) onTimeUpdate(videoRef.current.currentTime)
      }}
      onError={() => onError('This video could not be played. It may still be finishing writing.')}
    />
  )
})

export default VideoPlayer
