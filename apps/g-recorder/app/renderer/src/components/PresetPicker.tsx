import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ASPECT_OPTIONS,
  DEFAULT_PRESET_ID,
  EXPORT_PRESETS,
  SPEED_OPTIONS,
  TARGET_SIZE_OPTIONS,
  getPreset,
} from '../../../shared/presets'
import type {
  AspectId,
  EncodeEffort,
  ExportFormat,
  ExportOptions,
  ExportProgress,
  ExportTimeline,
  UserExportPreset,
} from '../../../shared/types'
import { formatBytes, formatDuration } from '../../../shared/time'

interface PresetPickerProps {
  /** The whole timeline, which is what gets rendered */
  timeline: ExportTimeline
  hasAudio: boolean
  disabled?: boolean
  /**
   * Reports the export action so it can be driven from elsewhere.
   *
   * Export belongs at the top of the page with the other things you do to a
   * clip, not buried under the settings that shape it — but the settings are
   * what the action needs, so the state stays here and only the handle travels.
   */
  onControlChange?: (control: ExportControl) => void
  /** Whether the settings dialog is open */
  open: boolean
  onClose: () => void
}

export interface ExportControl {
  canExport: boolean
  isExporting: boolean
  percent: number
  run: () => void
  cancel: () => void
}

type ExportState = 'idle' | 'exporting' | 'done' | 'error'

/**
 * Export settings and the export run itself.
 *
 * The controls are deliberately flat — format, quality, framing, speed, volume,
 * size — so the whole thing stays readable without opening a dialog.
 */
export default function PresetPicker({
  timeline,
  hasAudio,
  disabled = false,
  onControlChange,
  open,
  onClose,
}: PresetPickerProps): JSX.Element | null {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [aspect, setAspect] = useState<AspectId>('source')
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [targetSizeMb, setTargetSizeMb] = useState<number | null>(null)
  const [effort, setEffort] = useState<EncodeEffort>('balanced')
  /*
   * Where this export goes and what it is called. Seeded from the settings when
   * the dialog opens, then the user's for as long as it is open.
   */
  const [directory, setDirectory] = useState('')
  const [fileName, setFileName] = useState('')

  const [state, setState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const unsubscribeRef = useRef<(() => void) | null>(null)
  /** Last control reported upward, so an unchanged one is not re-sent */
  const controlRef = useRef<string>('')

  useEffect(() => {
    return () => unsubscribeRef.current?.()
  }, [])

  /*
   * Filled in each time the dialog opens rather than once: the folder may have
   * gained a file since, and the suggested name has to be one that is free now.
   */
  useEffect(() => {
    if (!open) return

    let cancelled = false
    void window.api.settings.get().then(async (settings) => {
      if (cancelled) return
      setDirectory(settings.exportPath)
      const suggestion = await window.api.settings.nextExportName(settings.exportPath)
      if (!cancelled) setFileName(suggestion)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  const preset = getPreset(presetId)
  const sourceDuration = timeline.duration
  const outputDuration = sourceDuration / speed
  const isExporting = state === 'exporting'
  const canExport = !disabled && sourceDuration > 0 && !isExporting

  const handleExport = useCallback(async (): Promise<void> => {
    if (timeline.sources.length === 0) return

    setState('exporting')
    setResult(null)
    setProgress({ percent: 0, eta: null, isComplete: false, error: null })

    unsubscribeRef.current?.()
    unsubscribeRef.current = window.api.export.onProgress(setProgress)

    const options: ExportOptions = {
      presetId,
      effort,
      timeline,
      directory,
      // Empty means "the next name in the pattern", settled against the folder
      // at export time rather than now.
      fileName,
      speed,
      volume: hasAudio ? volume : 0,
      aspect,
      format,
      targetSizeMb: format === 'gif' ? null : targetSizeMb,
    }

    try {
      const { outputPath } = await window.api.export.start(options)
      setResult(outputPath)
      setState('done')
    } catch (err) {
      setProgress((previous) => ({
        percent: previous?.percent ?? 0,
        eta: null,
        isComplete: false,
        error: cleanError(err),
      }))
      setState(cleanError(err) === 'Export cancelled' ? 'idle' : 'error')
    } finally {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [
    aspect,
    directory,
    effort,
    fileName,
    format,
    hasAudio,
    presetId,
    speed,
    targetSizeMb,
    timeline,
    volume,
  ])

  /*
   * Reported only when something the caller can see actually changed.
   *
   * The caller renders a button from this and feeds its own state back down as
   * props — publishing a fresh object on every render would put the two in a
   * loop that no amount of memoising on their side reliably prevents.
   */
  const percent = progress?.percent ?? 0
  useEffect(() => {
    const signature = `${canExport}|${isExporting}|${percent.toFixed(0)}`
    if (signature === controlRef.current) return
    controlRef.current = signature

    onControlChange?.({
      canExport,
      isExporting,
      percent,
      run: () => void handleExport(),
      cancel: () => void window.api.export.cancel(),
    })
  }, [canExport, handleExport, isExporting, onControlChange, percent])

  if (!open) return null

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal stack"
        style={{ gap: 14 }}
        onClick={(event) => event.stopPropagation()}
      >
      <div className="row-between">
        <p className="section-title" style={{ margin: 0 }}>
          Export
        </p>
        <div className="segmented">
          {(['mp4', 'gif'] as ExportFormat[]).map((option) => (
            <button
              key={option}
              className={format === option ? 'active' : ''}
              onClick={() => setFormat(option)}
              disabled={isExporting}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Save as</span>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <input
            className="input"
            style={{ flex: '1 1 0', minWidth: 0 }}
            value={fileName}
            placeholder="Next in the pattern"
            onChange={(event) => setFileName(event.target.value)}
            disabled={isExporting}
          />
          <span className="small faint mono">.{format}</span>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Folder</span>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <span className="path-display" title={directory}>
            {directory}
          </span>
          <button
            className="btn"
            disabled={isExporting}
            onClick={async () => {
              const chosen = await window.api.settings.pickExportPath()
              if (chosen) {
                setDirectory(chosen)
                // The free name in one folder says nothing about another.
                setFileName(await window.api.settings.nextExportName(chosen))
              }
            }}
          >
            Browse…
          </button>
        </div>
      </div>

      <div className="export-grid">
        {format === 'mp4' && (
          <div className="field">
            <span className="field-label">Quality</span>
            <div className="segmented">
              {EXPORT_PRESETS.map((option) => (
                <button
                  key={option.id}
                  className={presetId === option.id ? 'active' : ''}
                  onClick={() => setPresetId(option.id)}
                  disabled={isExporting}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {format === 'mp4' && (
          <div className="field">
            <span className="field-label">Encoding</span>
            <div className="segmented">
              {(
                [
                  ['fast', 'Faster', 'Quickest export, largest file for the quality'],
                  ['balanced', 'Balanced', 'What almost every export wants'],
                  ['small', 'Smallest', 'Same picture, smaller file, a slower export'],
                ] as [EncodeEffort, string, string][]
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  className={effort === id ? 'active' : ''}
                  onClick={() => setEffort(id)}
                  disabled={isExporting}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">Framing</span>
          <select
            value={aspect}
            onChange={(event) => setAspect(event.target.value as AspectId)}
            disabled={isExporting}
            style={{ minWidth: 120 }}
          >
            {ASPECT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="field-label">Speed</span>
          <div className="segmented">
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                className={speed === option ? 'active' : ''}
                onClick={() => setSpeed(option)}
                disabled={isExporting}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>

        {format === 'mp4' && hasAudio && (
          <div className="field">
            <span className="field-label">Volume {Math.round(volume * 100)}%</span>
            <input
              className="slider"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              disabled={isExporting}
            />
          </div>
        )}

        {format === 'mp4' && (
          <div className="field">
            <span className="field-label">Size limit</span>
            <div className="segmented">
              <button
                className={targetSizeMb === null ? 'active' : ''}
                onClick={() => setTargetSizeMb(null)}
                disabled={isExporting}
              >
                Off
              </button>
              {TARGET_SIZE_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={targetSizeMb === option ? 'active' : ''}
                  onClick={() => setTargetSizeMb(option)}
                  disabled={isExporting}
                  title={`Fit the export into roughly ${option} MB`}
                >
                  {option}MB
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Outcome row. The Export button itself lives in the page header. ── */}
      <div className="row" style={{ gap: 10 }}>
        {state === 'done' && result && (
          <>
            <span className="pill" style={{ color: 'var(--success)' }}>
              ✓ Saved
            </span>
            <button className="btn" onClick={() => void window.api.media.revealInFolder(result)}>
              Show in folder
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        {sourceDuration > 0 && (
          <span className="small faint">
            {`${formatDuration(outputDuration)} out · ${estimateLabel(
              format,
              targetSizeMb,
              preset?.maxBitrateKbps ?? 0,
              preset?.bitrateCapIsGuard ?? false,
              preset?.audioBitrateKbps ?? 0,
              outputDuration,
              hasAudio && volume > 0,
            )}`}
          </span>
        )}
      </div>

      {(isExporting || state === 'done') && (
        <div className="progress">
          <div
            className={`progress-fill${state === 'done' ? ' done' : ''}`}
            style={{ width: `${state === 'done' ? 100 : (progress?.percent ?? 0)}%` }}
          />
        </div>
      )}

      {isExporting && progress?.eta != null && progress.eta > 0 && (
        <p className="small faint">About {formatDuration(progress.eta)} remaining</p>
      )}

      {state === 'error' && progress?.error && (
        <div className="banner banner-error">{progress.error}</div>
      )}

      <PresetShelf
        current={{ name: '', presetId, format, aspect, speed, volume, targetSizeMb }}
        onApply={(saved) => {
          setPresetId(saved.presetId)
          setFormat(saved.format)
          setAspect(saved.aspect)
          setSpeed(saved.speed)
          setVolume(saved.volume)
          setTargetSizeMb(saved.targetSizeMb)
        }}
      />

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>
          Done
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport()} disabled={!canExport}>
          {isExporting ? `Exporting ${(progress?.percent ?? 0).toFixed(0)}%` : 'Export'}
        </button>
      </div>
      </div>
    </div>
  )
}

/**
 * Named export setups, so the settings above are chosen once rather than every
 * time. Kept beside the controls they capture: a preset list somewhere else
 * would be a second place to look for the same three decisions.
 */
function PresetShelf({
  current,
  onApply,
}: {
  current: UserExportPreset
  onApply: (preset: UserExportPreset) => void
}): JSX.Element {
  const [presets, setPresets] = useState<UserExportPreset[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    window.api.export.listPresets().then(setPresets).catch(() => undefined)
  }, [])

  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="section-title" style={{ margin: 0 }}>
        Saved setups
      </span>

      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {presets.map((preset) => (
          <span key={preset.name} className="saved-preset">
            <button className="saved-preset-apply" onClick={() => onApply(preset)}>
              {preset.name}
            </button>
            <button
              className="saved-preset-remove"
              title={`Delete ${preset.name}`}
              onClick={() => {
                void window.api.export.deletePreset(preset.name).then(setPresets)
              }}
            >
              ×
            </button>
          </span>
        ))}
        {presets.length === 0 && (
          <span className="small faint">Nothing saved yet. Name the current settings below.</span>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <input
          type="text"
          placeholder="Name these settings"
          value={name}
          onChange={(event) => setName(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          className="btn"
          disabled={name.trim() === ''}
          onClick={() => {
            void window.api.export
              .savePreset({ ...current, name: name.trim() })
              .then((saved) => {
                setPresets(saved)
                setName('')
              })
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Rough output-size hint so the user is not surprised by the result */
function estimateLabel(
  format: ExportFormat,
  targetSizeMb: number | null,
  maxBitrateKbps: number,
  capIsGuard: boolean,
  audioBitrateKbps: number,
  durationSeconds: number,
  includeAudio: boolean,
): string {
  if (format === 'gif') return 'GIF size varies with motion'
  if (targetSizeMb) return `≈ ${targetSizeMb} MB`
  // A guard ceiling is not a number worth quoting: constant quality lands far
  // below it, and printing it promises a file several times too large.
  if (maxBitrateKbps <= 0 || capIsGuard) return 'size depends on the footage'

  const kbps = maxBitrateKbps + (includeAudio ? audioBitrateKbps : 0)
  const bytes = (kbps * 1000 * durationSeconds) / 8
  return `up to ~${formatBytes(bytes)}`
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron wraps handler errors with an IPC prefix that means nothing here
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}
