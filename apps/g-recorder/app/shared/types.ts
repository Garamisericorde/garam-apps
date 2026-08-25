// ---------------------------------------------------------------------------
// Shared types used by main, preload, and renderer
// ---------------------------------------------------------------------------

export type Resolution = 'source' | '720p' | '1080p' | '1440p'

/** User-facing encoder choice. 'auto' picks the best available at runtime. */
export type EncoderPref = 'auto' | 'nvenc' | 'qsv' | 'amf' | 'x264'

/** Concrete encoder actually used for an FFmpeg run */
export type EncoderType = 'nvenc' | 'qsv' | 'amf' | 'x264'

export interface AppSettings {
  // ── Capture ──
  replayLengthMinutes: number
  segmentDurationSeconds: number
  fps: number
  resolution: Resolution
  encoder: EncoderPref
  /** Index of the monitor to capture (0 = primary) */
  monitorIndex: number
  captureCursor: boolean

  // ── Audio ──
  captureAudio: boolean
  /** DirectShow device name for system audio (loopback / Stereo Mix) */
  systemAudioDevice: string | null
  captureMic: boolean
  /** DirectShow device name for the microphone */
  micDevice: string | null

  // ── Behaviour ──
  autoStartRecording: boolean
  launchOnStartup: boolean
  showOverlay: boolean

  // ── Output ──
  outputPath: string

  // ── Hotkeys ──
  hotkeySaveReplay: string
  hotkeyToggleRecording: string
}

export interface RecorderStatus {
  isRecording: boolean
  /** True while a manual (non-buffer) recording is running */
  isManualRecording: boolean
  segmentCount: number
  /** Seconds of footage currently held in the replay buffer */
  bufferSeconds: number
  oldestSegmentTime: number | null
  newestSegmentTime: number | null
  error: string | null
}

/** Aspect-ratio framing applied on export */
export type AspectId = 'source' | '16:9' | '9:16' | '1:1' | '4:5'

export type ExportFormat = 'mp4' | 'gif'

export interface ExportOptions {
  presetId: string
  /** Absolute path to the source clip to trim + transcode */
  clipPath: string
  inPoint: number
  outPoint: number
  /** Absolute output path; empty string = auto-generate in settings.outputPath */
  outputPath: string
  /** Playback speed multiplier (1 = normal) */
  speed: number
  /** Audio gain, 0 = mute, 1 = unchanged */
  volume: number
  aspect: AspectId
  format: ExportFormat
  /** Hard file-size target in MB; null = use the preset's own bitrate cap */
  targetSizeMb: number | null
}

export interface ExportProgress {
  percent: number
  eta: number | null
  isComplete: boolean
  error: string | null
  /** Set when the export finished successfully */
  outputPath?: string
}

export interface SegmentInfo {
  filename: string
  startTimestamp: number
  durationSeconds: number
}

export interface SegmentIndex {
  segments: SegmentInfo[]
}

// ── FFmpeg availability ──────────────────────────────────────────────────────

export type FfmpegState = 'ready' | 'missing' | 'downloading' | 'error'

export interface FfmpegStatus {
  state: FfmpegState
  /** Resolved ffmpeg.exe path when state === 'ready' */
  path: string | null
  /** Version banner line, e.g. "ffmpeg version 7.1" */
  version: string | null
  /** 0–100 while state === 'downloading' */
  downloadPercent: number
  error: string | null
}

// ── Device / display enumeration ─────────────────────────────────────────────

export interface AudioDevice {
  /** DirectShow device name, passed verbatim to ffmpeg */
  name: string
  /** True when the name looks like a system-audio loopback source */
  isLoopback: boolean
}

export interface AudioDevices {
  devices: AudioDevice[]
  /** True if no loopback-capable device was found (Stereo Mix disabled) */
  noLoopbackFound: boolean
}

export interface DisplayInfo {
  index: number
  label: string
  width: number
  height: number
  isPrimary: boolean
}

// ── Media metadata ───────────────────────────────────────────────────────────

export interface MediaInfo {
  path: string
  durationSeconds: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  sizeBytes: number
}

/** A thumbnail strip for the editor timeline */
export interface ThumbnailStrip {
  /** data: URIs, evenly spaced across the clip */
  frames: string[]
}

/** Result of smoke-testing one encoder on this machine */
export interface EncoderProbe {
  available: boolean
  /** Short explanation shown in Settings when unavailable */
  reason: string | null
}

export interface EncoderCapabilities {
  nvenc: EncoderProbe
  qsv: EncoderProbe
  amf: EncoderProbe
  x264: EncoderProbe
  /** DXGI Desktop Duplication capture works */
  hasDdagrab: boolean
  /** ddagrab frames can go straight to NVENC without a system-memory round trip */
  hasCudaZeroCopy: boolean
  /** Highest-ranked encoder that actually works here */
  bestEncoder: EncoderType
}
