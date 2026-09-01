import { useEffect, useRef, useState } from 'react'
import {
  ASPECT_OPTIONS,
  DEFAULT_PRESET_ID,
  EXPORT_PRESETS,
  SPEED_OPTIONS,
  TARGET_SIZE_OPTIONS,
  getPreset,
} from '../../../shared/presets'
import type { AspectId, ExportFormat, ExportOptions, ExportProgress } from '../../../shared/types'
import { formatBytes, formatDuration } from '../../../shared/time'

interface PresetPickerProps {
  clipPath: string | null
  inPoint: number
  outPoint: number
  /** Kept pieces when the clip has been cut; undefined for a plain trim */
  ranges?: { start: number; end: number }[]
  hasAudio: boolean
  disabled?: boolean
}

type ExportState = 'idle' | 'exporting' | 'done' | 'error'

/**
 * Export settings and the export run itself.
 *
 * The controls are deliberately flat — format, quality, framing, speed, volume,
 * size — so the whole thing stays readable without opening a dialog.
 */
export default function PresetPicker({
  clipPath,
  inPoint,
  outPoint,
  ranges,
  hasAudio,
  disabled = false,
}: PresetPickerProps): JSX.Element {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [aspect, setAspect] = useState<AspectId>('source')
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [targetSizeMb, setTargetSizeMb] = useState<number | null>(null)

  const [state, setState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => unsubscribeRef.current?.()
  }, [])

  const preset = getPreset(presetId)
  // With parts, the footage kept is the sum of the pieces, not the span they
  // sit in — the size estimate and the progress bar both read from this.
  const sourceDuration = ranges?.length
    ? ranges.reduce((total, r) => total + Math.max(r.end - r.start, 0), 0)
    : Math.max(outPoint - inPoint, 0)
  const outputDuration = sourceDuration / speed
  const isExporting = state === 'exporting'
  const canExport = !disabled && !!clipPath && sourceDuration > 0 && !isExporting

  async function handleExport(): Promise<void> {
    if (!clipPath) return

    setState('exporting')
    setResult(null)
    setProgress({ percent: 0, eta: null, isComplete: false, error: null })

    unsubscribeRef.current?.()
    unsubscribeRef.current = window.api.export.onProgress(setProgress)

    const options: ExportOptions = {
      presetId,
      clipPath,
      inPoint,
      outPoint,
      ranges,
      outputPath: '', // the main process names the file
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
  }

  return (
    <div className="card stack" style={{ gap: 14 }}>
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

        {format === 'mp4' && (
          <div className="field">
            <span className="field-label">
              Volume {hasAudio ? `${Math.round(volume * 100)}%` : ''}
            </span>
            {hasAudio ? (
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
            ) : (
              <span className="small faint">No audio track</span>
            )}
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

      {/* ── Action row ── */}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-primary" onClick={() => void handleExport()} disabled={!canExport}>
          {isExporting ? `Exporting ${(progress?.percent ?? 0).toFixed(0)}%` : 'Export'}
        </button>

        {isExporting && (
          <button className="btn" onClick={() => void window.api.export.cancel()}>
            Cancel
          </button>
        )}

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

        <span className="small faint">
          {sourceDuration > 0
            ? `${formatDuration(outputDuration)} out · ${estimateLabel(
                format,
                targetSizeMb,
                preset?.maxBitrateKbps ?? 0,
                preset?.audioBitrateKbps ?? 0,
                outputDuration,
                hasAudio && volume > 0,
              )}`
            : 'Nothing selected'}
        </span>
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
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Rough output-size hint so the user is not surprised by the result */
function estimateLabel(
  format: ExportFormat,
  targetSizeMb: number | null,
  maxBitrateKbps: number,
  audioBitrateKbps: number,
  durationSeconds: number,
  includeAudio: boolean,
): string {
  if (format === 'gif') return 'GIF size varies with motion'
  if (targetSizeMb) return `≈ ${targetSizeMb} MB`
  if (maxBitrateKbps <= 0) return 'size depends on the footage'

  const kbps = maxBitrateKbps + (includeAudio ? audioBitrateKbps : 0)
  const bytes = (kbps * 1000 * durationSeconds) / 8
  return `up to ~${formatBytes(bytes)}`
}

function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron wraps handler errors with an IPC prefix that means nothing here
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim()
}
