import { useEffect, useState } from 'react'
import type { RecorderStatus } from '../../../shared/types'

/**
 * The always-on-top capture badge. It runs in its own frameless, click-through
 * window, so it deliberately skips the app shell and paints a transparent body.
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

  const isRecording = status?.isManualRecording ?? false
  const isBuffering = status?.isRecording ?? false
  const active = isRecording || isBuffering
  const label = isRecording ? 'REC' : isBuffering ? 'REPLAY' : 'IDLE'
  const colour = isRecording ? '#ff4040' : isBuffering ? '#6c63ff' : '#888'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'rgba(0, 0, 0, 0.72)',
          borderRadius: 5,
          padding: '3px 8px',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          userSelect: 'none',
          color: colour,
          border: `1px solid ${active ? colour + '59' : 'rgba(255,255,255,0.08)'}`,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: active ? colour : '#555',
            flexShrink: 0,
            animation: isRecording ? 'blink 1.4s ease-in-out infinite' : 'none',
          }}
        />
        {label}
      </div>
    </div>
  )
}
