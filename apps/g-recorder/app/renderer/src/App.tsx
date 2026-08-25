import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { FfmpegStatus } from '../../shared/types'
import EditorPage from './pages/EditorPage'
import SettingsPage from './pages/SettingsPage'
import OverlayPage from './pages/OverlayPage'
import FfmpegBanner from './components/FfmpegBanner'

interface Notice {
  level: 'info' | 'error'
  message: string
}

export default function App(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const isOverlay = location.pathname === '/overlay'

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [hotkeyConflicts, setHotkeyConflicts] = useState<string[]>([])

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
          G-Recorder
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

          {hotkeyConflicts.length > 0 && (
            <div className="banner banner-warning">
              <span style={{ flex: 1 }}>
                Windows would not register {hotkeyConflicts.join(' and ')} — another app is probably
                using it. Pick a different shortcut in Settings.
              </span>
              <button className="btn btn-ghost" onClick={() => setHotkeyConflicts([])}>
                Dismiss
              </button>
            </div>
          )}

          {notice && (
            <div className={`banner banner-${notice.level === 'error' ? 'error' : 'info'}`}>
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
