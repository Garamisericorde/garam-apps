import { useEffect, useState } from 'react'
import type { RecorderStatus } from '../../../shared/types'

/**
 * A single dot, always on top, saying whether capture is running.
 *
 * Deliberately just a dot. It sits over a game, where anything that has to be
 * read takes attention the game wants — the state is carried by colour alone,
 * which is legible from the corner of the eye and costs nothing to ignore.
 *
 * It runs in its own frameless, click-through window, so it skips the app
 * shell and paints a transparent body.
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

  const buffering = status?.isRecording ?? false

  const state = buffering ? 'is-buffering' : 'is-idle'
  const label = buffering ? 'Instant replay on' : 'Instant replay off'

  return (
    <div className="state-overlay">
      <span className={`state-dot ${state}`} role="img" aria-label={label} title={label} />
    </div>
  )
}
