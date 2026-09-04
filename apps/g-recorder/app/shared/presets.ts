import type { AspectId, Resolution } from './types'

export interface ExportPreset {
  id: string
  label: string
  description: string
  /** Target height; 'source' keeps the clip's own resolution */
  resolution: Resolution
  /** 0 = keep the source frame rate */
  fps: number
  /** CRF value for x264 / CQ value for hardware encoders */
  quality: number
  /** Peak bitrate cap in kbps (0 = uncapped) */
  maxBitrateKbps: number
  /** Audio bitrate in kbps */
  audioBitrateKbps: number
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'small',
    label: 'Small',
    description: '720p 30fps — smallest file, easy to share anywhere',
    resolution: '720p',
    fps: 30,
    quality: 30,
    maxBitrateKbps: 2500,
    audioBitrateKbps: 96,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: '1080p 60fps — good quality at a moderate size',
    resolution: '1080p',
    fps: 60,
    quality: 25,
    maxBitrateKbps: 8000,
    audioBitrateKbps: 128,
  },
  {
    id: 'high',
    label: 'High Quality',
    description: 'Source resolution and frame rate — largest file',
    resolution: 'source',
    fps: 0,
    quality: 19,
    maxBitrateKbps: 0,
    audioBitrateKbps: 192,
  },
]

/*
 * High by default. These are game clips kept for their own sake, and the
 * export runs once — the moment to save space is when a specific upload
 * demands it, which is what the size limit is for.
 */
export const DEFAULT_PRESET_ID = 'high'

export function getPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => p.id === id)
}

// ── Aspect ratios ────────────────────────────────────────────────────────────

export interface AspectOption {
  id: AspectId
  label: string
  /** width / height; null = keep the source ratio */
  ratio: number | null
}

export const ASPECT_OPTIONS: AspectOption[] = [
  { id: 'source', label: 'Original', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
]

export function getAspectRatio(id: AspectId): number | null {
  return ASPECT_OPTIONS.find((a) => a.id === id)?.ratio ?? null
}

// ── Speed ────────────────────────────────────────────────────────────────────

export const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const

// ── Common share-target file sizes (MB) ──────────────────────────────────────

export const TARGET_SIZE_OPTIONS = [10, 25, 50, 100] as const

/** Height in pixels for a named resolution; null keeps the source height. */
export function resolutionHeight(resolution: Resolution): number | null {
  switch (resolution) {
    case '720p':
      return 720
    case '1080p':
      return 1080
    case '1440p':
      return 1440
    default:
      return null
  }
}
