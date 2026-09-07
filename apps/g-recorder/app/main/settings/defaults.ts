import { app } from 'electron'
import { join } from 'path'
import type { AppSettings } from '../../shared/types'
import { ALLOWED_FPS } from '../../shared/presets'
import {
  MAX_REPLAY_SECONDS,
  MIN_REPLAY_SECONDS,
  REPLAY_PRESET_SECONDS,
} from '../../shared/replay'
import { DEFAULT_NAME_PATTERN } from '../../shared/exportNaming'
import {
  DEFAULT_EDITOR_KEYS,
  DEFAULT_HOTKEYS,
  DEFAULT_PAD_BINDINGS,
} from '../../shared/hotkeyDefaults'

export const DEFAULT_SETTINGS: AppSettings = {
  // Capture
  /*
   * Two minutes. Long enough that a round you want back is still in it, short
   * enough that the cache is a couple of hundred megabytes rather than a
   * gigabyte being rewritten all evening.
   */
  replayLengthSeconds: 120,
  segmentDurationSeconds: 2,
  fps: 60,
  resolution: '1080p',
  encoder: 'auto',
  monitorIndex: 0,
  captureCursor: true,

  // Audio
  captureAudio: true,
  systemAudioDevice: null,
  captureMic: false,
  micDevice: null,

  // Behaviour
  autoStartRecording: true,
  /*
   * On by default, like g-snap. A replay buffer that has to be started by hand
   * is a replay buffer that is off for the moment worth keeping.
   */
  launchOnStartup: true,
  showOverlay: true,

  // Output
  outputPath: join(app.getPath('videos'), 'G-Recorder'),
  exportPath: join(app.getPath('videos'), 'G-Recorder', 'Exports'),
  exportNamePattern: DEFAULT_NAME_PATTERN,

  ...DEFAULT_HOTKEYS,
  ...DEFAULT_PAD_BINDINGS,
  ...DEFAULT_EDITOR_KEYS,
  editorSnap: true,
}

// ── Recording constants ──────────────────────────────────────────────────────

export { ALLOWED_FPS }

export const MIN_SEGMENT_DURATION_SECONDS = 1
export const MAX_SEGMENT_DURATION_SECONDS = 10
export { MIN_REPLAY_SECONDS, MAX_REPLAY_SECONDS, REPLAY_PRESET_SECONDS }

/** Keyframe cadence, in seconds — matches the segment length for clean cuts */
export const KEYFRAME_INTERVAL_SECONDS = 2



/** Extra headroom kept in the cache beyond the replay window, in segments */
export const PRUNE_BUFFER_SEGMENTS = 2

// ── Editor constants ─────────────────────────────────────────────────────────

/** Number of frames in the editor's timeline thumbnail strip */
export const TIMELINE_THUMBNAIL_COUNT = 12

/** Width of each timeline thumbnail, in pixels */
export const TIMELINE_THUMBNAIL_WIDTH = 160

/** Frame rate used for GIF export */
export const GIF_FPS = 12

/** Maximum width of an exported GIF, in pixels */
export const GIF_MAX_WIDTH = 640
