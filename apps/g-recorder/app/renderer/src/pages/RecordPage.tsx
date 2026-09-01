import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppSettings, RecorderStatus } from '../../../shared/types'
import { formatBytes } from '../../../shared/time'

/**
 * Everything to do with capturing: what the buffer is holding right now, and
 * the three things you can do with it.
 *
 * These controls used to live in a bar above every page *and* in the editor's
 * header, so the same state and the same "Save replay" button appeared twice on
 * screen at once. Recording and editing are separate activities; they now have
 * separate tabs.
 */
export default function RecordPage(): JSX.Element {
  const navigate = useNavigate()

  const [status, setStatus] = useState<RecorderStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [busy, setBusy] = useState<'toggle' | 'save' | 'record' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    void window.api.recorder.getStatus().then(setStatus)
    void window.api.settings.get().then(setSettings)
    return window.api.recorder.onStatusChange(setStatus)
  }, [])

  useEffect(() => {
    return window.api.settings.onChange(setSettings)
  }, [])

  // The cache only changes as segments are written, so polling it with the
  // status would be wasteful; once a second while this page is open is plenty.
  useEffect(() => {
    const read = (): void => {
      window.api.recorder.getCacheSize().then(setCacheSize).catch(() => undefined)
    }
    read()
    const timer = setInterval(read, 1_000)
    return () => clearInterval(timer)
  }, [])

  const run = useCallback(
    async (kind: 'toggle' | 'save' | 'record', action: () => Promise<unknown>) => {
      setBusy(kind)
      setError(null)
      try {
        await action()
      } catch (err) {
        setError(cleanError(err))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const buffering = status?.isRecording ?? false
  const recording = status?.isManualRecording ?? false
  const buffered = status?.bufferSeconds ?? 0
  const replayLength = (settings?.replayLengthMinutes ?? 5) * 60
  const fill = replayLength > 0 ? Math.min(buffered / replayLength, 1) : 0

  const state = recording ? 'Recording to file' : buffering ? 'Instant replay on' : 'Not recording'

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && (
        <div className="banner banner-error">
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {saved && (
        <div className="banner banner-success">
          <span style={{ flex: 1 }}>Replay saved. Open it in the editor to trim and export.</span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSaved(null)
              navigate('/editor')
            }}
          >
            Open editor
          </button>
        </div>
      )}

      <section className="capture-card">
        <div className="capture-head">
          <span className={`state-dot ${recording ? 'is-recording' : buffering ? 'is-buffering' : 'is-idle'}`} />
          <div className="stack">
            <h1>{state}</h1>
            <span className="muted small">
              {buffering || recording
                ? `Holding the last ${formatClock(buffered)} of footage`
                : 'Start the buffer to keep the last few minutes on hand'}
            </span>
          </div>
        </div>

        {/* How full the rolling window is — the one number that says whether a
            replay saved right now would cover what just happened. */}
        <div className="capture-meter" title={`${formatClock(buffered)} of ${formatClock(replayLength)}`}>
          <div className="capture-meter-fill" style={{ width: `${Math.round(fill * 100)}%` }} />
        </div>
        <div className="row-between small muted">
          <span className="mono">{formatClock(buffered)}</span>
          <span className="mono">{formatClock(replayLength)}</span>
        </div>

        <div className="row capture-actions">
          <button
            className={`btn ${buffering ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy !== null || recording}
            onClick={() =>
              void run('toggle', () =>
                buffering ? window.api.recorder.stop() : window.api.recorder.start(),
              )
            }
          >
            {buffering ? 'Stop buffer' : 'Start buffer'}
          </button>

          <button
            className="btn"
            disabled={busy !== null || !buffering || buffered <= 0}
            title={buffering ? 'Write what is in the buffer to a file' : 'Start the buffer first'}
            onClick={() =>
              void run('save', async () => {
                await window.api.recorder.saveReplay()
                setSaved('saved')
              })
            }
          >
            {busy === 'save' ? 'Saving…' : 'Save replay'}
          </button>

          <div style={{ flex: 1 }} />

          <button
            className={recording ? 'btn btn-danger' : 'btn'}
            disabled={busy !== null}
            title="Record straight to a file instead of a rolling buffer"
            onClick={() =>
              void run('record', () =>
                recording
                  ? window.api.recorder.stopManual()
                  : window.api.recorder.startManual(),
              )
            }
          >
            {recording ? 'Stop recording' : 'Record to file'}
          </button>
        </div>

        {status?.error && <div className="banner banner-error">{status.error}</div>}
      </section>

      <section className="capture-facts">
        <Fact label="Save replay" value={settings?.hotkeySaveReplay ?? '—'} mono />
        <Fact label="Start / stop" value={settings?.hotkeyToggleRecording ?? '—'} mono />
        <Fact
          label="Replay length"
          value={settings ? `${settings.replayLengthMinutes} min` : '—'}
        />
        <Fact label="Cache on disk" value={cacheSize === null ? '—' : formatBytes(cacheSize)} />
      </section>
    </div>
  )
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}): JSX.Element {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className={`fact-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  )
}

/** Seconds as m:ss — short enough to read at a glance, unlike "3m 54s" */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}
