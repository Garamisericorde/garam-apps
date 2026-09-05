import { useEffect, useState } from 'react'
import type { RecorderStatus } from '../../../shared/types'

/** How long a message stays up before it fades out */
const MESSAGE_MS = 3_500

/**
 * A dot and a line of text, always on top, saying what the recorder is doing.
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
  /*
   * What the recorder just did.
   *
   * It goes here rather than only in the app window because the app window is
   * behind the game at the one moment this matters. A hotkey pressed mid-fight
   * had no answer to "did it save?" short of alt-tabbing to look.
   */
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.body.style.overflow = 'hidden'
  }, [])

  useEffect(() => {
    window.api.recorder.getStatus().then(setStatus).catch(() => undefined)
    return window.api.recorder.onStatusChange(setStatus)
  }, [])

  useEffect(() => {
    return window.api.app.onNotice((notice) => setMessage(notice.message))
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message])

  const recording = status?.isManualRecording ?? false
  const buffering = status?.isRecording ?? false

  const state = recording ? 'is-recording' : buffering ? 'is-buffering' : 'is-idle'
  const label = recording
    ? 'Recording to file'
    : buffering
      ? 'Instant replay on'
      : 'Instant replay off'

  return (
    <div className="state-overlay">
      <span className={`state-dot ${state}`} role="img" aria-label={label} title={label} />
      {message && <span className="state-message">{message}</span>}
    </div>
  )
}
