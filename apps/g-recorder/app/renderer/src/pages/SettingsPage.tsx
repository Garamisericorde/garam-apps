import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AudioDevices,
  DisplayInfo,
  EncoderCapabilities,
  FfmpegStatus,
  PadStatus,
} from '../../../shared/types'
import { isSafeBinding, parseBinding } from '../../../shared/gamepad'
import {
  DEFAULT_EDITOR_KEYS,
  DEFAULT_HOTKEYS,
  DEFAULT_PAD_BINDINGS,
} from '../../../shared/hotkeyDefaults'
import { ALLOWED_FPS } from '../../../shared/presets'
import { sanitizeNamePattern } from '../../../shared/exportNaming'
import { formatBytes } from '../../../shared/time'
import { resolutionHeight } from '../../../shared/presets'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)
  const [encoders, setEncoders] = useState<EncoderCapabilities | null>(null)
  const [audio, setAudio] = useState<AudioDevices | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [version, setVersion] = useState('')
  const [reinstalling, setReinstalling] = useState(false)
  const [scan, setScan] = useState<'idle' | 'scanning' | 'done'>('idle')

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Loading ────────────────────────────────────────────────────────────────

  useEffect(() => {
    window.api.settings.get().then(setSettings).catch((err) => setError(String(err)))
    window.api.app.getVersion().then(setVersion).catch(() => undefined)
    window.api.devices.displays().then(setDisplays).catch(() => undefined)
    window.api.recorder.getCacheSize().then(setCacheSize).catch(() => undefined)

    return window.api.settings.onChange(setSettings)
  }, [])

  const refreshHardware = useCallback(() => {
    window.api.ffmpeg.getStatus().then(setFfmpeg).catch(() => undefined)
    window.api.devices.encoders().then(setEncoders).catch(() => undefined)
    window.api.devices.audio().then(setAudio).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshHardware()
    return window.api.ffmpeg.onStatusChange((status) => {
      setFfmpeg(status)
      if (status.state === 'ready') refreshHardware()
    })
  }, [refreshHardware])

  const reinstallFfmpeg = useCallback(async () => {
    setReinstalling(true)
    setError(null)
    try {
      const status = await window.api.ffmpeg.reinstall()
      if (status.state === 'error') setError(status.error ?? 'Could not install FFmpeg')
      // The main process re-probes the encoders against the new binary; pull the
      // fresh result so the encoder list stops showing the old one's failures.
      refreshHardware()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setReinstalling(false)
    }
  }, [refreshHardware])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  // ── Saving ─────────────────────────────────────────────────────────────────

  const save = useCallback(async (partial: Partial<AppSettings>) => {
    setSaveState('saving')
    setError(null)
    try {
      setSettings(await window.api.settings.set(partial))
      setSaveState('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaveState('idle'), 1500)
    } catch (err) {
      setError(cleanError(err))
      setSaveState('error')
    }
  }, [])

  if (!settings) {
    return <p className="muted">{error ?? 'Loading settings…'}</p>
  }

  const noLoopback = audio?.noLoopbackFound ?? false

  return (
    <div className="page-narrow stack" style={{ gap: 8, paddingBottom: 24 }}>
      <div className="row">
        <h1>Settings</h1>
        {saveState === 'saved' && <span className="pill" style={{ color: 'var(--success)' }}>Saved</span>}
        {saveState === 'saving' && <span className="pill">Saving…</span>}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* ── Recording ── */}
      <Section title="Recording">
        <Field label="Replay length" hint="How much footage the buffer keeps">
          <Select
            value={settings.replayLengthMinutes}
            onChange={(value) => void save({ replayLengthMinutes: Number(value) })}
            options={[1, 2, 3, 5, 10, 15, 30].map((m) => ({ value: m, label: `${m} min` }))}
          />
        </Field>

        <Field label="Resolution" hint={resolutionHint(settings, displays, encoders)}>
          <Select
            value={settings.resolution}
            onChange={(value) => void save({ resolution: value as AppSettings['resolution'] })}
            options={[
              { value: 'source', label: 'Source' },
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
              { value: '1440p', label: '1440p' },
            ]}
          />
        </Field>

        <Field label="Frame rate">
          <Select
            value={settings.fps}
            onChange={(value) => void save({ fps: Number(value) })}
            options={ALLOWED_FPS.map((fps) => ({ value: fps, label: `${fps} fps` }))}
          />
        </Field>

        <Field label="Encoder" hint={encoderHint(encoders)}>
          <Select
            value={settings.encoder}
            onChange={(value) => void save({ encoder: value as AppSettings['encoder'] })}
            options={[
              { value: 'auto', label: 'Automatic' },
              encoderOption('nvenc', 'NVIDIA NVENC', encoders),
              encoderOption('qsv', 'Intel Quick Sync', encoders),
              encoderOption('amf', 'AMD AMF', encoders),
              { value: 'x264', label: 'x264 (software)' },
            ]}
          />
        </Field>

        {needsCompatibleFfmpeg(encoders) && (
          <div className="banner banner-warning">
            <span style={{ flex: 1 }}>
              This copy of FFmpeg needs a newer NVIDIA driver than you have, so it will not use
              your GPU and recording runs on the CPU. Your card is fine. Installing the
              compatible build fixes it without touching your driver.
            </span>
            <button
              className="btn btn-primary"
              disabled={reinstalling}
              onClick={() => void reinstallFfmpeg()}
            >
              {reinstalling ? 'Installing…' : 'Install compatible FFmpeg'}
            </button>
          </div>
        )}

        {displays.length > 1 && (
          <Field label="Monitor">
            <Select
              value={settings.monitorIndex}
              onChange={(value) => void save({ monitorIndex: Number(value) })}
              options={displays.map((display) => ({
                value: display.index,
                label: display.isPrimary ? `${display.label} (primary)` : display.label,
              }))}
            />
          </Field>
        )}

        <Field label="Show the mouse cursor">
          <Toggle
            checked={settings.captureCursor}
            onChange={(value) => void save({ captureCursor: value })}
          />
        </Field>
      </Section>

      {/* ── Audio ── */}
      <Section title="Audio">
        {noLoopback && settings.captureAudio && (
          <div className="banner banner-info" style={{ marginBottom: 10 }}>
            Windows exposes no loopback device, so system audio is captured directly instead.
            nothing to set up. The device list below is only for picking a specific input.
          </div>
        )}

        <Field label="Record system audio">
          <Toggle
            checked={settings.captureAudio}
            onChange={(value) => void save({ captureAudio: value })}
          />
        </Field>

        {settings.captureAudio && (
          <Field label="System audio device">
            <Select
              value={settings.systemAudioDevice ?? ''}
              onChange={(value) => void save({ systemAudioDevice: value === '' ? null : String(value) })}
              options={[
                { value: '', label: 'Automatic' },
                ...(audio?.devices ?? []).map((device) => ({
                  value: device.name,
                  label: device.isLoopback ? `${device.name} (loopback)` : device.name,
                })),
              ]}
            />
          </Field>
        )}

        <Field label="Record microphone">
          <Toggle
            checked={settings.captureMic}
            onChange={(value) => void save({ captureMic: value })}
          />
        </Field>

        {settings.captureMic && (
          <Field label="Microphone">
            <Select
              value={settings.micDevice ?? ''}
              onChange={(value) => void save({ micDevice: value === '' ? null : String(value) })}
              options={[
                { value: '', label: 'Automatic' },
                ...(audio?.devices ?? []).map((device) => ({
                  value: device.name,
                  label: device.name,
                })),
              ]}
            />
          </Field>
        )}

        <Field label="Detected devices" hint={deviceHint(audio, scan)}>
          {/*
            * A rescan of an unchanged machine returns exactly what was there
            * before, so with no state to show the button looked broken. It now
            * says it is working and confirms when it is done.
            */}
          <button
            className="btn"
            disabled={scan === 'scanning'}
            onClick={() => {
              setScan('scanning')
              window.api.devices
                .audio(true)
                .then((devices) => {
                  setAudio(devices)
                  setScan('done')
                  setTimeout(() => setScan('idle'), 2000)
                })
                .catch(() => setScan('idle'))
            }}
          >
            {scan === 'scanning' ? 'Scanning…' : scan === 'done' ? '✓ Rescanned' : 'Rescan'}
          </button>
        </Field>
      </Section>

      {/* ── Behaviour ── */}
      <Section title="Behaviour">
        <Field label="Start the replay buffer on launch">
          <Toggle
            checked={settings.autoStartRecording}
            onChange={(value) => void save({ autoStartRecording: value })}
          />
        </Field>
        <Field label="Launch G-Recorder when Windows starts">
          <Toggle
            checked={settings.launchOnStartup}
            onChange={(value) => void save({ launchOnStartup: value })}
          />
        </Field>
        <Field label="Show the recording badge on screen">
          <Toggle
            checked={settings.showOverlay}
            onChange={(value) => void save({ showOverlay: value })}
          />
        </Field>
      </Section>

      {/* ── Output ── */}
      <Section title="Output">
        <Field label="Save clips to">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="path-display" title={settings.outputPath}>
              {settings.outputPath}
            </span>
            <button
              className="btn"
              onClick={async () => {
                const chosen = await window.api.settings.pickOutputPath()
                if (chosen) await save({ outputPath: chosen })
              }}
            >
              Browse…
            </button>
            <button className="btn" onClick={() => void window.api.settings.openOutputFolder()}>
              Open
            </button>
          </div>
        </Field>

        <Field
          label="Save exports to"
          hint="Kept apart from the recordings, so finished clips do not fill the clip list"
        >
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <span className="path-display" title={settings.exportPath}>
              {settings.exportPath}
            </span>
            <button
              className="btn"
              onClick={async () => {
                const chosen = await window.api.settings.pickExportPath()
                if (chosen) await save({ exportPath: chosen })
              }}
            >
              Browse…
            </button>
            <button className="btn" onClick={() => void window.api.settings.openExportFolder()}>
              Open
            </button>
          </div>
        </Field>

        <Field
          label="Export name"
          hint={`Numbered as they are taken: ${settings.exportNamePattern}1, ${settings.exportNamePattern}2, ${settings.exportNamePattern}3`}
        >
          <NamePatternField
            value={settings.exportNamePattern}
            onChange={(pattern) => void save({ exportNamePattern: pattern })}
          />
        </Field>
      </Section>

      {/* ── Hotkeys ── */}
      <Section
        title="Hotkeys"
        action={
          <button
            className="btn btn-ghost small"
            onClick={() => void save(DEFAULT_HOTKEYS)}
            title="Put all three back to the ShadowPlay defaults"
          >
            Reset to defaults
          </button>
        }
      >
        <HotkeyField
          label="Save clip from buffer"
          value={settings.hotkeySaveReplay}
          onChange={(accelerator) => void save({ hotkeySaveReplay: accelerator })}
        />
        <HotkeyField
          label="Turn buffer on / off"
          value={settings.hotkeyToggleRecording}
          onChange={(accelerator) => void save({ hotkeyToggleRecording: accelerator })}
        />
        <HotkeyField
          label="Start / stop recording"
          value={settings.hotkeyRecordToFile}
          onChange={(accelerator) => void save({ hotkeyRecordToFile: accelerator })}
        />
      </Section>

      {/* ── Controller ── */}
      <GamepadSection settings={settings} save={save} />

      <Section
        title="Editor keys"
        action={
          <button className="btn btn-ghost small" onClick={() => void save(DEFAULT_EDITOR_KEYS)}>
            Reset to defaults
          </button>
        }
      >
        <HotkeyField
          label="Play / pause"
          value={settings.editorKeyPlayPause}
          onChange={(key) => void save({ editorKeyPlayPause: key })}
        />
        <HotkeyField
          label="Cut the start here"
          value={settings.editorKeyCutStart}
          onChange={(key) => void save({ editorKeyCutStart: key })}
        />
        <HotkeyField
          label="Cut the end here"
          value={settings.editorKeyCutEnd}
          onChange={(key) => void save({ editorKeyCutEnd: key })}
        />
        <HotkeyField
          label="Split at the playhead"
          value={settings.editorKeySplit}
          onChange={(key) => void save({ editorKeySplit: key })}
        />
        <HotkeyField
          label="Fullscreen"
          value={settings.editorKeyFullscreen}
          onChange={(key) => void save({ editorKeyFullscreen: key })}
        />
      </Section>

      {/* ── Diagnostics ── */}
      <Section title="Diagnostics">
        <Field label="FFmpeg" hint={ffmpeg?.path ?? undefined}>
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted">{ffmpegLabel(ffmpeg)}</span>
            {ffmpeg?.state !== 'ready' && (
              <button
                className="btn"
                onClick={() => {
                  void window.api.ffmpeg.download().then(setFfmpeg)
                }}
                disabled={ffmpeg?.state === 'downloading'}
              >
                Download
              </button>
            )}
          </div>
        </Field>

        <Field label="Replay cache" hint="Buffered segments on disk">
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted mono">
              {cacheSize === null ? '…' : formatBytes(cacheSize)}
            </span>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await window.api.recorder.clearCache()
                  setCacheSize(await window.api.recorder.getCacheSize())
                } catch (err) {
                  setError(cleanError(err))
                }
              }}
            >
              Clear
            </button>
          </div>
        </Field>

        <Field label="Logs">
          <button className="btn" onClick={() => void window.api.settings.openLogsFolder()}>
            Open logs folder
          </button>
        </Field>

        <Field label="Version">
          <span className="small muted mono">{version || 'Unknown'}</span>
        </Field>
      </Section>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * The name every export is built from.
 *
 * Typed freely and only saved once it is left alone: writing on every keystroke
 * would push a half-typed name through the validator and bounce it back into
 * the field mid-word.
 */
function NamePatternField({
  value,
  onChange,
}: {
  value: string
  onChange: (pattern: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    const cleaned = sanitizeNamePattern(draft)
    setDraft(cleaned)
    if (cleaned !== value) onChange(cleaned)
  }

  return (
    <input
      className="input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      spellCheck={false}
    />
  )
}

/**
 * Controller shortcuts.
 *
 * Its own section rather than a fourth column on the keyboard rows: these do
 * not go through Windows at all — the app reads the pad itself — and the two
 * fail in completely different ways. A keyboard shortcut can be taken by
 * another app; a controller one can only be missing a controller.
 */
function GamepadSection({
  settings,
  save,
}: {
  settings: AppSettings
  save: (partial: Partial<AppSettings>) => Promise<void>
}): JSX.Element {
  const [status, setStatus] = useState<PadStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      void window.api.gamepad.status().then((next) => {
        if (!cancelled) setStatus(next)
      })
    }

    poll()
    // A pad plugged in while this page is open should appear on its own.
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="settings-section">
      <div className="section-head">
        <p className="section-title">Controller</p>
        <button
          className="btn btn-ghost small"
          onClick={() => void save(DEFAULT_PAD_BINDINGS)}
          title="Clear all three controller bindings"
        >
          Clear all
        </button>
      </div>
      <div className="card stack">
        <p className="small faint" style={{ margin: 0 }}>
          {status && !status.available
            ? `Controller support is unavailable on this install${
                status.reason ? `: ${status.reason}` : ''
              }`
            : status?.connected
              ? 'Controller connected. These work while a game is in the foreground.'
              : 'No controller detected. Xbox pads work as they are; a DualSense needs Steam Input or DS4Windows.'}
        </p>

        <PadField
          label="Save clip from buffer"
          value={settings.padSaveReplay}
          disabled={!status?.available}
          onChange={(binding) => void save({ padSaveReplay: binding })}
        />
        <PadField
          label="Turn buffer on / off"
          value={settings.padToggleRecording}
          disabled={!status?.available}
          onChange={(binding) => void save({ padToggleRecording: binding })}
        />
        <PadField
          label="Start / stop recording"
          value={settings.padRecordToFile}
          disabled={!status?.available}
          onChange={(binding) => void save({ padRecordToFile: binding })}
        />
      </div>
    </div>
  )
}

/**
 * One controller binding.
 *
 * Capture resolves on RELEASE, with everything held during the press — the
 * only way a chord can be bound at all, since a field that took the first
 * button down could never capture more than one.
 */
function PadField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string | null
  disabled: boolean
  onChange: (binding: string | null) => void
}): JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [held, setHeld] = useState('')
  const [rejected, setRejected] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    return window.api.gamepad.onHeld(setHeld)
  }, [capturing])

  useEffect(() => {
    if (!capturing) return

    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      window.api.gamepad.cancelCapture()
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [capturing])

  const start = (): void => {
    setCapturing(true)
    setHeld('')

    void window.api.gamepad.capture().then((binding) => {
      setCapturing(false)
      setHeld('')
      if (binding === null) return

      if (!isSafePadBinding(binding)) {
        // A single button, or two face buttons, would fire mid-game on its own.
        setRejected(
          binding === ''
            ? 'No buttons were pressed'
            : `${binding} would fire during play. Use three buttons, or two with a shoulder or trigger.`,
        )
        setTimeout(() => setRejected(null), 3200)
        return
      }
      onChange(binding)
    })
  }

  return (
    <div className="row-between">
      <div className="stack">
        <span>{label}</span>
        {!capturing && !rejected && swallowsTyping(value) && (
          <span className="small faint">
            Held globally, so {value} will not reach other applications
          </span>
        )}
        {rejected ? (
          <span className="small danger">{rejected}</span>
        ) : (
          capturing && (
            <span className="small faint">
              Hold the buttons together, then let go · Esc to cancel
            </span>
          )
        )}
      </div>
      <div className="row">
        <button
          className={`btn hotkey-field${capturing ? ' is-capturing' : ''}${
            rejected ? ' is-rejected' : ''
          }`}
          disabled={disabled}
          onClick={() => (capturing ? window.api.gamepad.cancelCapture() : start())}
        >
          {capturing ? held || 'Press some buttons…' : (value ?? 'Not bound')}
        </button>
        {value && !capturing && (
          <button className="btn btn-ghost" onClick={() => onChange(null)} title="Clear">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  /** A control belonging to the whole section, shown beside its title */
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="settings-section">
      <div className="section-head">
        <p className="section-title">{title}</p>
        {action}
      </div>
      <div className="card stack">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="row-between">
      <div className="stack">
        <span>{label}</span>
        {hint && <span className="small faint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

interface Option {
  value: string | number
  label: string
  disabled?: boolean
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string | number
  onChange: (value: string) => void
  options: Option[]
}): JSX.Element {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <button
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  )
}

/**
 * Captures the next key combination the user presses and turns it into an
 * Electron accelerator string.
 */
/**
 * Records a shortcut by watching what you hold down.
 *
 * The combination builds up as keys go down — Alt, then Alt+Shift, then the
 * finished Alt+Shift+K — so you can see what you are about to bind instead of
 * finding out after it is saved.
 *
 * What it refuses is as important as what it accepts. Windows binds a shortcut
 * to modifiers plus ONE key: "Alt+Q+R" is not a three-key chord, and Electron
 * happily registers it as plain Alt+R with the Q silently dropped. Mouse
 * buttons are not addressable at all. Rejecting both here, visibly, beats
 * saving something that reads back as one shortcut and fires on another.
 */
function HotkeyField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (accelerator: string | null) => void
}): JSX.Element {
  const [capturing, setCapturing] = useState(false)
  /** What is held down right now, shown while it is being pressed */
  const [preview, setPreview] = useState<string[]>([])
  /**
   * Why the last attempt bounced.
   *
   * A shake on its own is the worst possible answer here: the field goes red,
   * keeps showing the old shortcut, and the user is left believing the setting
   * reset itself rather than that their combination was refused.
   */
  const [rejected, setRejected] = useState<string | null>(null)

  const reject = useCallback((reason: string) => {
    setRejected(reason)
    // Long enough for the shake to finish, short enough to keep trying.
    setTimeout(() => setRejected(null), 2600)
  }, [])

  useEffect(() => {
    if (!capturing) {
      setPreview([])
      return
    }

    const handleKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }

      const held: string[] = []
      if (event.ctrlKey) held.push('Ctrl')
      if (event.shiftKey) held.push('Shift')
      if (event.altKey) held.push('Alt')
      if (event.metaKey) held.push('Super')

      // Still only modifiers: show them and wait for the key they belong to.
      if (MODIFIER_KEYS.includes(event.key)) {
        setPreview(held)
        return
      }

      const key = acceleratorKey(event)
      if (!key) {
        reject('That key cannot be part of a shortcut')
        return
      }

      setPreview([...held, key])
      setCapturing(false)
      onChange([...held, key].join('+'))
    }

    const handleUp = (event: KeyboardEvent): void => {
      if (!MODIFIER_KEYS.includes(event.key)) return
      // Releasing a modifier before the key means starting over.
      setPreview((previous) => previous.filter((part) => part !== modifierName(event.key)))
    }

    const handleMouse = (event: MouseEvent): void => {
      // Only the primary button gets through: it is how the field is opened.
      if (event.button === 0) return
      event.preventDefault()
      reject('Windows cannot bind mouse buttons to a shortcut')
    }

    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('keyup', handleUp, true)
    window.addEventListener('mousedown', handleMouse, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('keyup', handleUp, true)
      window.removeEventListener('mousedown', handleMouse, true)
    }
  }, [capturing, onChange, reject])

  return (
    <div className="row-between">
      <div className="stack">
        <span>{label}</span>
        {rejected ? (
          <span className="small danger">{rejected}</span>
        ) : (
          capturing && <span className="small faint">Press a combination · Esc to cancel</span>
        )}
      </div>
      <div className="row">
        <button
          className={`btn hotkey-field${capturing ? ' is-capturing' : ''}${
            rejected ? ' is-rejected' : ''
          }`}
          onClick={() => setCapturing((previous) => !previous)}
        >
          {capturing
            ? preview.length > 0
              ? preview.join('+')
              : 'Press a combination…'
            : (value ?? 'Not bound')}
        </button>
        {value !== null && !capturing && (
          <button
            className="btn btn-ghost"
            onClick={() => onChange(null)}
            title="Unbind this action. It keeps working from the tray and the buttons."
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

/** Event key name -> the name used in an accelerator */
function modifierName(key: string): string {
  if (key === 'Control') return 'Ctrl'
  if (key === 'Meta') return 'Super'
  return key
}

/**
 * Whether a global shortcut is a key people also type with.
 *
 * Worth saying once, because a global registration takes that key away from
 * every other application — but not worth refusing over. Which keys are worth
 * spending is the user's call, not this field's.
 */
function swallowsTyping(accelerator: string | null): boolean {
  return accelerator !== null && /^[A-Za-z0-9]$/.test(accelerator)
}

/** Whether a captured binding is one a game will not fire by accident */
function isSafePadBinding(binding: string): boolean {
  const mask = parseBinding(binding)
  return mask !== null && isSafeBinding(mask)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta']

/**
 * Physical key -> Electron accelerator name.
 *
 * Built from `event.code`, not `event.key`. `event.key` reports the CHARACTER
 * the combination produces, so Shift+Equal arrives as "+" and the accelerator
 * became "Ctrl+Shift++" — the trailing plus collides with the separator and
 * Electron rejects the whole string. `event.code` names the physical key, which
 * is what an accelerator actually refers to.
 */
const CODE_TO_ACCELERATOR: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  Enter: 'Return',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Tab: 'Tab',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
}

function acceleratorKey(event: KeyboardEvent): string | null {
  const code = event.code

  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F\d{1,2}$/.test(code)) return code

  return CODE_TO_ACCELERATOR[code] ?? null
}


function ffmpegLabel(status: FfmpegStatus | null): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'ready':
      return status.version ?? 'Ready'
    case 'downloading':
      return `Downloading… ${status.downloadPercent}%`
    case 'error':
      return status.error ?? 'Error'
    default:
      return 'Not installed'
  }
}

/**
 * Build one encoder option, disabling it when the probe showed it cannot run
 * here and surfacing the reason so the user is not left guessing.
 */
function encoderOption(
  id: 'nvenc' | 'qsv' | 'amf',
  label: string,
  capabilities: EncoderCapabilities | null,
): Option {
  const probe = capabilities?.[id]
  return {
    value: id,
    label: probe && !probe.available && probe.reason ? `${label}: ${probe.reason}` : label,
    disabled: probe ? !probe.available : false,
  }
}

/**
 * Explain what a resolution choice costs, when it costs something.
 *
 * Resizing has to happen in a filter, and a filter forces every frame down from
 * the GPU into system memory — on this hardware that is the difference between
 * capture being free and capture costing real CPU. Someone on a 1440p monitor
 * picking "1080p" to save disk space has no way to know they just gave that up,
 * so the field says so rather than leaving it to be discovered as stutter.
 */
function resolutionHint(
  settings: AppSettings,
  displays: DisplayInfo[],
  capabilities: EncoderCapabilities | null,
): string {
  const base = "Source keeps the monitor's own resolution"
  if (!capabilities?.hasD3d11DirectNvenc) return base

  const display = displays[settings.monitorIndex] ?? displays.find((d) => d.isPrimary)
  const target = resolutionHeight(settings.resolution)
  // Compared against the display's real pixel height, the same measure the main
  // process decides on — its DIP size disagrees under fractional scaling.
  const scaling = target !== null && display?.nativeHeight !== target

  return scaling
    ? `${base}, and lets capture stay on the GPU. Resizing costs noticeably more CPU.`
    : `${base} · capture is running entirely on the GPU`
}

/** What the last scan found, so the button has something to have changed */
function deviceHint(audio: AudioDevices | null, scan: 'idle' | 'scanning' | 'done'): string {
  if (scan === 'scanning') return 'Asking Windows…'
  const count = audio?.devices.length ?? 0
  return count === 1 ? '1 device found' : `${count} devices found`
}

/**
 * Only worth saying when the choice loses something.
 *
 * Recording below the display's refresh rate is a real trade — smoothness for
 * file size — and one people make by accident on a high-refresh monitor.
 * Matching it needs no explanation, so it gets none.
 */

/**
 * Whether the installed FFmpeg is the reason the GPU is idle.
 *
 * NVENC reports its own failure precisely — "Required: 13.1 Found: 12.2" — and
 * that particular failure is fixable by swapping the binary, unlike a machine
 * that simply has no NVIDIA card. Only offer the reinstall for the former.
 */
function needsCompatibleFfmpeg(capabilities: EncoderCapabilities | null): boolean {
  if (!capabilities || capabilities.bestEncoder !== 'x264') return false
  return /nvenc api version|driver does not support/i.test(capabilities.nvenc.reason ?? '')
}

function encoderHint(capabilities: EncoderCapabilities | null): string | undefined {
  if (!capabilities) return undefined

  const working = [
    capabilities.nvenc.available && 'NVENC',
    capabilities.qsv.available && 'Quick Sync',
    capabilities.amf.available && 'AMF',
  ].filter(Boolean)

  const zeroCopy = capabilities.hasD3d11DirectNvenc || capabilities.hasCudaZeroCopy
  const capture = capabilities.hasDdagrab
    ? zeroCopy
      ? 'ddagrab capture (zero-copy)'
      : 'ddagrab capture'
    : 'gdigrab capture'

  return working.length > 0
    ? `${working.join(', ')} working · ${capture}`
    : `No working hardware encoder · ${capture}`
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}
