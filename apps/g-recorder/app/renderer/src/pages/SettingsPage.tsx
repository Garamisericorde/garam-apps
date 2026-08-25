import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AudioDevices,
  DisplayInfo,
  EncoderCapabilities,
  FfmpegStatus,
} from '../../../shared/types'
import { formatBytes } from '../../../shared/time'

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

        <Field label="Resolution" hint="Source keeps the monitor's own resolution">
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
            options={[
              { value: 30, label: '30 fps' },
              { value: 60, label: '60 fps' },
            ]}
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
          <div className="banner banner-warning" style={{ marginBottom: 10 }}>
            No system-audio device was found. Enable “Stereo Mix” in the Windows sound control
            panel, or install a virtual audio cable, then click Rescan.
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

        <Field label="Detected devices" hint={`${audio?.devices.length ?? 0} found`}>
          <button
            className="btn"
            onClick={() => {
              window.api.devices.audio(true).then(setAudio).catch(() => undefined)
            }}
          >
            Rescan
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
      </Section>

      {/* ── Hotkeys ── */}
      <Section title="Hotkeys">
        <HotkeyField
          label="Save replay"
          value={settings.hotkeySaveReplay}
          onChange={(accelerator) => void save({ hotkeySaveReplay: accelerator })}
        />
        <HotkeyField
          label="Start / stop instant replay"
          value={settings.hotkeyToggleRecording}
          onChange={(accelerator) => void save({ hotkeyToggleRecording: accelerator })}
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
          <span className="small muted mono">{version || '—'}</span>
        </Field>
      </Section>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="settings-section">
      <p className="section-title">{title}</p>
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
function HotkeyField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (accelerator: string) => void
}): JSX.Element {
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return

    const handleKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }

      const accelerator = toAccelerator(event)
      if (!accelerator) return // modifier-only press — keep waiting

      setCapturing(false)
      onChange(accelerator)
    }

    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [capturing, onChange])

  return (
    <div className="row-between">
      <span>{label}</span>
      <button
        className="btn"
        onClick={() => setCapturing((previous) => !previous)}
        style={{ minWidth: 170, justifyContent: 'center' }}
      >
        {capturing ? 'Press a combination…' : value}
      </button>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta']

/** Build an Electron accelerator from a keyboard event, or null if incomplete */
function toAccelerator(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(event.key)) return null

  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  if (event.metaKey) parts.push('Super')

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  parts.push(key)

  // A bare letter would swallow normal typing everywhere in Windows
  const isFunctionKey = /^F\d{1,2}$/.test(key)
  if (parts.length === 1 && !isFunctionKey) return null

  return parts.join('+')
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
    label: probe && !probe.available && probe.reason ? `${label} — ${probe.reason}` : label,
    disabled: probe ? !probe.available : false,
  }
}

function encoderHint(capabilities: EncoderCapabilities | null): string | undefined {
  if (!capabilities) return undefined

  const working = [
    capabilities.nvenc.available && 'NVENC',
    capabilities.qsv.available && 'Quick Sync',
    capabilities.amf.available && 'AMF',
  ].filter(Boolean)

  const capture = capabilities.hasDdagrab
    ? capabilities.hasCudaZeroCopy
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
