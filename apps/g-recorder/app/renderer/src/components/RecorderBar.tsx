import { useCallback, useEffect, useState } from 'react'
import type { RecorderStatus } from '@shared/types'

/**
 * Always-visible state and controls for the replay buffer.
 *
 * These actions existed only in the tray menu, so the window showed no sign of
 * whether the buffer was running and offered no way to stop it — you had to
 * already know the tray menu was where to look.
 */
export default function RecorderBar() {
  const [status, setStatus] = useState<RecorderStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.recorder.getStatus().then(setStatus)
    return window.api.recorder.onStatusChange(setStatus)
  }, [])

  const toggleBuffer = useCallback(async () => {
    if (!status || busy) return
    setBusy(true)
    try {
      if (status.isRecording) await window.api.recorder.stop()
      else await window.api.recorder.start()
      setStatus(await window.api.recorder.getStatus())
    } finally {
      setBusy(false)
    }
  }, [status, busy])

  const saveReplay = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.recorder.saveReplay()
    } finally {
      setBusy(false)
    }
  }, [busy])

  if (!status) return null

  const running = status.isRecording
  const buffered = formatDuration(status.bufferSeconds)

  return (
    <div className="recorder-bar">
      <span className={`recorder-dot${running ? ' is-live' : ''}`} aria-hidden />

      <span className="recorder-state">
        {status.isManualRecording
          ? 'Recording to file'
          : running
            ? `Instant replay on — ${buffered} buffered`
            : 'Instant replay off'}
      </span>

      {status.error && <span className="recorder-error">{status.error}</span>}

      <button
        className={`btn ${running ? 'btn-danger' : 'btn-primary'}`}
        onClick={() => void toggleBuffer()}
        disabled={busy}
      >
        {running ? 'Stop buffer' : 'Start buffer'}
      </button>

      <button
        className="btn"
        onClick={() => void saveReplay()}
        disabled={busy || !running || status.bufferSeconds <= 0}
        title={running ? 'Save what is in the buffer right now' : 'Start the buffer first'}
      >
        Save replay
      </button>
    </div>
  )
}

/** Seconds -> "3m 20s", or "0s" when the buffer is empty. */
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}
