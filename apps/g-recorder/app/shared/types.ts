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
  /**
   * How much footage the buffer keeps, in seconds.
   *
   * Seconds rather than minutes because the useful range starts below one: a
   * thirty-second buffer is the right size for a clip nobody is going to trim.
   */
  replayLengthSeconds: number
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
  /**
   * Where exports go.
   *
   * Separate from outputPath, which is where the recorder writes: raw replays
   * and finished clips are different things to keep, and mixing them means the
   * clip list fills with material nobody chose to keep.
   */
  exportPath: string
  /** Name every export is built from: "Test" gives Test1, Test2, Test3 */
  exportNamePattern: string

  /*
   * ── Hotkeys ──
   *
   * null means unbound. An action nobody uses should cost nothing: a shortcut
   * left registered holds that combination away from every other application
   * on the machine, whether or not this app ever acts on it.
   */
  /** Write what the buffer holds to a file */
  hotkeySaveReplay: string | null
  /** Turn the rolling buffer on and off */
  hotkeyToggleRecording: string | null
  /** Start and stop recording straight to a file */
  hotkeyRecordToFile: string | null

  /*
   * The same three actions on a controller, as a set of buttons held at once
   * ("LB+RB+A"), or null when unbound. Kept apart from the accelerators above
   * because they are a different mechanism, not a different spelling: Windows
   * never sees these, and the app reads the pad itself.
   */
  padSaveReplay: string | null
  padToggleRecording: string | null
  padRecordToFile: string | null

  /*
   * Editor keys. Separate from the three above because they are nothing like
   * them: these only fire while the editor has focus, so a bare letter is
   * exactly right, where a global bare letter would swallow that key
   * everywhere in Windows.
   */
  editorKeyPlayPause: string | null
  editorKeyCutStart: string | null
  editorKeyCutEnd: string | null
  editorKeySplit: string | null
  editorKeyFullscreen: string | null

  /** Whether clip edges pull into line with each other while being dragged */
  editorSnap: boolean
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

/** One piece of a lane: a window into a source, placed on the output timeline */
export interface ExportTimelineItem {
  /** Index into ExportTimeline.sources */
  input: number
  start: number
  sourceIn: number
  sourceOut: number
  /** This clip's own loudness, 1 or absent being the source untouched */
  gain?: number
}

/**
 * What the exporter renders.
 *
 * The whole timeline, not a clip plus trim points: with several clips on two
 * independent lanes there is no single in and out to name, and describing it
 * any other way would mean the editor and the exporter each deciding what the
 * gaps between clips mean.
 */
export interface ExportTimeline {
  /** Distinct source files, in the order they are passed as inputs */
  sources: string[]
  video: ExportTimelineItem[]
  audio: ExportTimelineItem[]
  /** Length of the output — the furthest edge on either lane */
  duration: number
}

/**
 * How hard the encoder works.
 *
 * The one trade an export really has: every step slower is the same picture in
 * a smaller file, paid for in the time the export takes. It changes nothing
 * about what the result looks like.
 */
export type EncodeEffort = 'fast' | 'balanced' | 'small'

/**
 * A crop the user drew, as fractions of the source frame.
 *
 * Fractions rather than pixels because it is drawn on a preview whose size has
 * nothing to do with the recording's, and because it then survives the clip
 * being swapped for one at another resolution.
 */
export interface FrameCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportOptions {
  presetId: string
  /** The user's crop, or absent to keep the whole frame */
  crop?: FrameCrop
  effort: EncodeEffort
  timeline: ExportTimeline
  /** Folder to write into; empty string = the configured export folder */
  directory: string
  /** File name without an extension; empty string = the next in the pattern */
  fileName: string
  /** Playback speed multiplier (1 = normal) */
  speed: number
  /** Audio gain, 0 = mute, 1 = unchanged */
  volume: number
  aspect: AspectId
  format: ExportFormat
  /** Hard file-size target in MB; null = use the preset's own bitrate cap */
  targetSizeMb: number | null
}

/**
 * An export setup the user named and kept.
 *
 * Stores the choices, not the resulting numbers: a preset saying "High Quality"
 * follows that preset if its definition ever improves, where a saved bitrate
 * would pin the export to whatever was true the day it was saved.
 */
export interface UserExportPreset {
  name: string
  presetId: string
  format: ExportFormat
  aspect: AspectId
  speed: number
  volume: number
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
  /**
   * Real pixel height, which under fractional scaling is not `height`.
   *
   * Whether capture needs to resize — and so whether it can stay on the GPU —
   * is decided against the pixels, never against the DIP size.
   */
  nativeHeight: number
  /** Refresh rate in Hz, which bounds the frame rate worth capturing at */
  refreshRate: number
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

/** One clip in the editor's media library */
export interface LibraryItem {
  path: string
  /** File name without its directory */
  name: string
  sizeBytes: number
  /** Last-modified time, which is also the sort order (newest first) */
  modifiedAt: number
  /** Poster frame as a data URI; absent until it has been rendered */
  poster?: string
  durationSeconds?: number
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
  /**
   * NVENC accepts ddagrab's D3D11 frames unfiltered — the cheapest path there
   * is, but unusable as soon as a filter (i.e. scaling) has to be inserted.
   */
  hasD3d11DirectNvenc: boolean
  /** ddagrab frames can go straight to NVENC without a system-memory round trip */
  hasCudaZeroCopy: boolean
  /** Highest-ranked encoder that actually works here */
  bestEncoder: EncoderType
}

/** A hotkey that did not register, and why. */
export interface HotkeyFailure {
  accelerator: string
  /** 'taken' = another app owns it, 'invalid' = not a legal accelerator string. */
  reason: 'taken' | 'invalid'
}

/** What the controller layer can currently do, for Settings to report */
export interface PadStatus {
  /** XInput loaded — false means no FFI, so no controller support at all */
  available: boolean
  /** A pad has actually answered on one of the four slots */
  connected: boolean
  /** Why the native layer is unavailable, when it is */
  reason: string | null
}

/** What the close button is interrupting, so the question can name it */
export interface CloseRequest {
  kind: 'recording' | 'buffer'
}

/** What the user answered. Every way out of the dialog sends one of these. */
export type CloseChoice = 'save' | 'discard' | 'close' | 'cancel'
