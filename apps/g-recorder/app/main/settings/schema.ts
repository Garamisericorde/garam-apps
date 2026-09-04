import type { AppSettings } from '../../shared/types'
import {
  ALLOWED_FPS,
  DEFAULT_SETTINGS,
  MAX_REPLAY_MINUTES,
  MAX_SEGMENT_DURATION_SECONDS,
  MIN_REPLAY_MINUTES,
  MIN_SEGMENT_DURATION_SECONDS,
} from './defaults'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const RESOLUTIONS: AppSettings['resolution'][] = ['source', '720p', '1080p', '1440p']
const ENCODERS: AppSettings['encoder'][] = ['auto', 'nvenc', 'qsv', 'amf', 'x264']

/**
 * Per-field validators. Each returns an error message, or null when the value
 * is acceptable. Fields absent from a partial update are skipped.
 */
const VALIDATORS: {
  [K in keyof AppSettings]: (value: unknown) => string | null
} = {
  replayLengthMinutes: (v) =>
    isNumberInRange(v, MIN_REPLAY_MINUTES, MAX_REPLAY_MINUTES)
      ? null
      : `replayLengthMinutes must be ${MIN_REPLAY_MINUTES}–${MAX_REPLAY_MINUTES}`,

  segmentDurationSeconds: (v) =>
    isNumberInRange(v, MIN_SEGMENT_DURATION_SECONDS, MAX_SEGMENT_DURATION_SECONDS)
      ? null
      : `segmentDurationSeconds must be ${MIN_SEGMENT_DURATION_SECONDS}–${MAX_SEGMENT_DURATION_SECONDS}`,

  fps: (v) =>
    typeof v === 'number' && (ALLOWED_FPS as readonly number[]).includes(v)
      ? null
      : `fps must be one of ${ALLOWED_FPS.join(', ')}`,

  resolution: (v) =>
    typeof v === 'string' && RESOLUTIONS.includes(v as AppSettings['resolution'])
      ? null
      : `resolution must be one of ${RESOLUTIONS.join(', ')}`,

  encoder: (v) =>
    typeof v === 'string' && ENCODERS.includes(v as AppSettings['encoder'])
      ? null
      : `encoder must be one of ${ENCODERS.join(', ')}`,

  monitorIndex: (v) =>
    isNumberInRange(v, 0, 15) ? null : 'monitorIndex must be between 0 and 15',

  captureCursor: (v) => (typeof v === 'boolean' ? null : 'captureCursor must be a boolean'),
  captureAudio: (v) => (typeof v === 'boolean' ? null : 'captureAudio must be a boolean'),
  captureMic: (v) => (typeof v === 'boolean' ? null : 'captureMic must be a boolean'),

  systemAudioDevice: (v) =>
    isNullableString(v) ? null : 'systemAudioDevice must be a string or null',
  micDevice: (v) => (isNullableString(v) ? null : 'micDevice must be a string or null'),

  autoStartRecording: (v) =>
    typeof v === 'boolean' ? null : 'autoStartRecording must be a boolean',
  launchOnStartup: (v) => (typeof v === 'boolean' ? null : 'launchOnStartup must be a boolean'),
  showOverlay: (v) => (typeof v === 'boolean' ? null : 'showOverlay must be a boolean'),

  outputPath: (v) =>
    typeof v === 'string' && v.trim() !== '' ? null : 'outputPath must be a non-empty string',

  hotkeySaveReplay: (v) =>
    typeof v === 'string' && v.trim() !== '' ? null : 'hotkeySaveReplay must be a non-empty string',
  hotkeyToggleRecording: (v) =>
    typeof v === 'string' && v.trim() !== ''
      ? null
      : 'hotkeyToggleRecording must be a non-empty string',
  hotkeyRecordToFile: (v) =>
    typeof v === 'string' && v.trim() !== ''
      ? null
      : 'hotkeyRecordToFile must be a non-empty string',
}

const SETTING_KEYS = Object.keys(VALIDATORS) as (keyof AppSettings)[]

/** Strict validation — used for incoming IPC updates, which must be correct. */
export function validateSettings(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Settings must be an object'] }
  }

  const record = raw as Record<string, unknown>
  const errors: string[] = []

  for (const key of SETTING_KEYS) {
    if (record[key] === undefined) continue
    const error = VALIDATORS[key](record[key])
    if (error) errors.push(error)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Lenient parsing — used when reading settings.json from disk. A single bad
 * field falls back to its default instead of discarding the whole file.
 */
export function sanitizeSettings(raw: unknown): {
  settings: AppSettings
  warnings: string[]
} {
  if (typeof raw !== 'object' || raw === null) {
    return { settings: { ...DEFAULT_SETTINGS }, warnings: ['Settings file was not an object'] }
  }

  const record = migrateLegacyKeys(raw as Record<string, unknown>)
  const settings = { ...DEFAULT_SETTINGS }
  const warnings: string[] = []

  for (const key of SETTING_KEYS) {
    const value = record[key]
    if (value === undefined) continue

    const error = VALIDATORS[key](value)
    if (error) {
      warnings.push(error)
      continue
    }
    // The validator above already narrowed the value for this key
    ;(settings as Record<string, unknown>)[key] = value
  }

  return { settings, warnings }
}

/** Rename fields from earlier versions so existing installs keep their config. */
function migrateLegacyKeys(record: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...record }

  // v0.1: a single `audioDevice` covered system audio
  if (migrated.systemAudioDevice === undefined && migrated.audioDevice !== undefined) {
    migrated.systemAudioDevice = migrated.audioDevice
  }
  delete migrated.audioDevice

  return migrated
}

/** Merge a partial settings object onto defaults. Partial values always win. */
export function mergeWithDefaults(partial: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...partial }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNumberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}
