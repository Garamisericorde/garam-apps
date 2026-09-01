import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { HotkeyFailure } from '@shared/types'
import type { FfmpegStatus } from '../../shared/types'
import EditorPage from './pages/EditorPage'
import SettingsPage from './pages/SettingsPage'
import OverlayPage from './pages/OverlayPage'
import FfmpegBanner from './components/FfmpegBanner'
import RecorderBar from './components/RecorderBar'
import { startSystemAudioCapture, stopSystemAudioCapture } from './audio/systemAudio'

interface Notice {
  level: 'info' | 'warning' | 'error'
  message: string
}

export default function App(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const isOverlay = location.pathname === '/overlay'

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [hotkeyConflicts, setHotkeyConflicts] = useState<HotkeyFailure[]>([])

  // The overlay is a separate window that shares this bundle — it needs none
  // of the app shell, so bail out before wiring anything else up.
  useEffect(() => {
    if (isOverlay) return

    window.api.ffmpeg.getStatus().then(setFfmpeg).catch(() => undefined)
    const unsubscribers = [
      window.api.ffmpeg.onStatusChange(setFfmpeg),
      window.api.app.onNavigate((route) => navigate(route)),
      window.api.app.onNotice(setNotice),
      window.api.app.onHotkeyConflict(setHotkeyConflicts),
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [isOverlay, navigate])

  // System audio is captured here rather than in FFmpeg — Chromium is the only
  // thing on Windows that can hear the machine without a loopback device. This
  // runs whenever the recorder asks for it, whichever page is open.
  useEffect(() => {
    if (isOverlay) return

    // Exposed on window rather than driven by IPC: the main process has to
    // invoke this through executeJavaScript to give it the user activation
    // getDisplayMedia insists on. See SystemAudioBridge.
    // Returns a result rather than throwing: an exception crossing
    // executeJavaScript arrives in the main process stripped of its message.
    window.__gRecorderStartSystemAudio = async (requested) => {
      try {
        // The real format comes back from the device, not from the request.
        const format = await startSystemAudioCapture(requested)
        return { ok: true, format }
      } catch (err) {
        const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        return { ok: false, error }
      }
    }

    const unsubscribe = window.api.systemAudio.onStop(() => {
      void stopSystemAudioCapture()
    })

    return () => {
      unsubscribe()
      delete window.__gRecorderStartSystemAudio
      void stopSystemAudioCapture()
    }
  }, [isOverlay])

  // Clear a transient notice a few seconds after it appears
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8_000)
    return () => clearTimeout(timer)
  }, [notice])

  if (isOverlay) return <OverlayPage />

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">
          <span className="brand-dot" />
          <span className="brand-name">G-Recorder</span>
        </span>

        <NavLink to="/editor" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Editor
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Settings
        </NavLink>
      </header>

      <main className="page">
        <div className="stack" style={{ gap: 12, height: '100%' }}>
          <FfmpegBanner status={ffmpeg} onStatusChange={setFfmpeg} />

          <RecorderBar />

          {hotkeyConflicts.length > 0 && (
            <div className="banner banner-warning">
              <span style={{ flex: 1 }}>
                {hotkeyConflicts
                  .map((f) =>
                    f.reason === 'invalid'
                      ? `${f.accelerator} is not a valid shortcut`
                      : `${f.accelerator} is already taken by another app`,
                  )
                  .join(', ')}
                . Pick a different shortcut in Settings.
              </span>
              <button className="btn btn-ghost" onClick={() => setHotkeyConflicts([])}>
                Dismiss
              </button>
            </div>
          )}

          {notice && (
            <div className={`banner banner-${notice.level}`}>
              <span style={{ flex: 1 }}>{notice.message}</span>
              <button className="btn btn-ghost" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          <Routes>
            <Route path="/" element={<Navigate to="/editor" replace />} />
            <Route path="/editor" element={<EditorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/editor" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
