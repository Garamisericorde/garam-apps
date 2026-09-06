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
  const [busy, setBusy] = useState<'toggle' | 'save' | 'record' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  /** Whether a pad has answered, which is what decides if its keys are shown */
  const [padConnected, setPadConnected] = useState(false)

  useEffect(() => {
    void window.api.recorder.getStatus().then(setStatus)
    void window.api.settings.get().then(setSettings)
    return window.api.recorder.onStatusChange(setStatus)
  }, [])

  useEffect(() => {
    return window.api.settings.onChange(setSettings)
  }, [])

  /*
   * A pad plugged in while this page is open should appear on its own. Polled
   * rather than pushed because XInput has no arrival event to listen for: the
   * only way to know a controller is there is to ask.
   */
  useEffect(() => {
    let cancelled = false
    const read = (): void => {
      void window.api.gamepad.status().then((status) => {
        if (!cancelled) setPadConnected(status.connected)
      })
    }

    read()
    const timer = setInterval(read, 2_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
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

  /** The hotkey rows are also the way to change them */
  const openHotkeySettings = useCallback(() => {
    navigate('/settings')
    // The section is rendered by the page that is about to mount, so the jump
    // waits for it rather than running against a page that is not there yet.
    requestAnimationFrame(() => {
      document.getElementById('settings-hotkeys')?.scrollIntoView({ block: 'start' })
    })
  }, [navigate])

  const run = useCallback(
    async (kind: 'toggle' | 'save' | 'record' | 'clear', action: () => Promise<unknown>) => {
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
    <div className="record-page">
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
            title="Record straight to a file. The replay buffer pauses while this runs."
            onClick={() =>
              void run('record', () =>
                recording
                  ? window.api.recorder.stopManual()
                  : window.api.recorder.startManual(),
              )
            }
          >
            {recording ? 'Stop recording' : 'Start recording'}
          </button>
        </div>

        {status?.error && <div className="banner banner-error">{status.error}</div>}
      </section>

      <section className="shortcuts">
        <div className="row-between">
          <p className="section-title" style={{ margin: 0 }}>
            Shortcuts
          </p>
          <button className="btn btn-ghost small" onClick={openHotkeySettings}>
            Change
          </button>
        </div>

        {/*
          * A real table: one grid for every row, so the keys of one action sit
          * directly under the keys of the next. Each row sizing itself left
          * the columns ragged, which is the difference between a list you can
          * scan down and three lines you have to read across.
          */}
        <div className="shortcuts-body">
        <div className="shortcut-table">
          <span className="shortcut-head" />
          <span className="shortcut-head">Keyboard</span>
          <span className="shortcut-head">Controller</span>

          <Shortcut
            label="Save clip from buffer"
            keys={settings?.hotkeySaveReplay ?? null}
            pad={settings?.padSaveReplay ?? null}
          />
          <Shortcut
            label="Turn buffer on / off"
            keys={settings?.hotkeyToggleRecording ?? null}
            pad={settings?.padToggleRecording ?? null}
          />
          <Shortcut
            label="Start / stop recording"
            keys={settings?.hotkeyRecordToFile ?? null}
            pad={settings?.padRecordToFile ?? null}
          />
        </div>

        {/*
          * The two standing numbers, beside the shortcuts rather than in a
          * card of their own. They are the same kind of thing — what the
          * recorder is set to right now — and a second card for two lines was
          * mostly border.
          */}
        <div className="capture-stats">
          <Fact
            label="Replay length"
            value={settings ? `${settings.replayLengthMinutes} min` : '...'}
          />

          {/* A number you cannot act on is just a number: the cache is the one
              thing on this page that grows without limit, so it gets a button. */}
          <div className="fact">
          <span className="fact-label">Cache on disk</span>
          <div className="row" style={{ gap: 8 }}>
            <span className="fact-value">
              {cacheSize === null ? '...' : formatBytes(cacheSize)}
            </span>
            <button
              className="btn btn-ghost small"
              disabled={busy !== null || buffering || recording || !cacheSize}
              title={
                buffering || recording
                  ? 'Stop capturing first. These are the files being written.'
                  : 'Delete the buffered footage on disk'
              }
              onClick={() =>
                void run('clear', async () => {
                  await window.api.recorder.clearCache()
                  setCacheSize(await window.api.recorder.getCacheSize())
                })
              }
            >
              {busy === 'clear' ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
        </div>

        <p className="small faint" style={{ margin: 0 }}>
          {padConnected
            ? 'Controller connected.'
            : 'No controller connected. Bindings are kept and work as soon as one is.'}
        </p>
      </section>
    </div>
  )
}

/**
 * One action, and the two ways to reach it.
 *
 * Keys and buttons are drawn as the things they are rather than printed as
 * text: a shortcut gets read at a glance in the middle of a game, and
 * "Alt+Shift+F10" as running text has to be parsed first.
 *
 * A controller binding is shown whether or not a pad is awake. It is a
 * setting, and hiding it while the pad sleeps makes the app look like it
 * forgot.
 */
function Shortcut({
  label,
  keys,
  pad,
}: {
  label: string
  keys: string | null
  pad: string | null
}): JSX.Element {
  return (
    <>
      <span className="shortcut-label">{label}</span>

      <span className="shortcut-keys">
        {keys ? (
          keys.split('+').map((key, index) => (
            <span key={`${key}-${index}`} className="key-cap">
              {key}
            </span>
          ))
        ) : (
          <span className="small faint">Not bound</span>
        )}
      </span>

      <span className="shortcut-pad">
        {pad ? (
          pad.split('+').map((button, index) => (
            <span key={`${button}-${index}`} className={`pad-cap is-${button.toLowerCase()}`}>
              {button}
            </span>
          ))
        ) : (
          <span className="small faint">No button</span>
        )}
      </span>
    </>
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
