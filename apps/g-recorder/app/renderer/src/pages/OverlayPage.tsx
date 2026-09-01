import { useEffect, useState } from 'react'
import type { RecorderStatus } from '../../../shared/types'

/**
 * The always-on-top frame-rate readout.
 *
 * It runs in its own frameless, click-through window, so it deliberately skips
 * the app shell and paints a transparent body. The number is how fast the
 * screen is actually changing — see RecorderStatus.captureFps for why that is
 * not the same as the encoder's frame rate, and why it cannot exceed the
 * configured capture rate.
 */
export default function OverlayPage(): JSX.Element {
  const [status, setStatus] = useState<RecorderStatus | null>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.body.style.overflow = 'hidden'
  }, [])

  useEffect(() => {
    window.api.recorder.getStatus().then(setStatus).catch(() => undefined)
    return window.api.recorder.onStatusChange(setStatus)
  }, [])

  const recording = status?.isManualRecording ?? false
  const buffering = status?.isRecording ?? false
  const live = recording || buffering
  const fps = status?.captureFps

  return (
    <div className="fps-overlay">
      <div className={`fps-readout${live ? ' is-live' : ''}${recording ? ' is-recording' : ''}`}>
        <span className="fps-dot" aria-hidden />
        {/*
         * The number and its unit are separate so the digits can hold a fixed
         * width. Without that the whole badge jitters every time the count
         * crosses a digit boundary, which is exactly when you are watching it.
         */}
        <span className="fps-value">{live && typeof fps === 'number' ? fps : '--'}</span>
        <span className="fps-unit">FPS</span>
      </div>
    </div>
  )
}
