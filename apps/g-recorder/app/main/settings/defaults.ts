import { app } from 'electron'
import { join } from 'path'
import type { AppSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  // Capture
  replayLengthMinutes: 5,
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
  launchOnStartup: false,
  showOverlay: true,

  // Output
  outputPath: join(app.getPath('videos'), 'G-Recorder'),

  // Hotkeys
  hotkeySaveReplay: 'Ctrl+Shift+F10',
  hotkeyToggleRecording: 'Ctrl+Shift+F9',
  hotkeyRecordToFile: 'Ctrl+Shift+F8',
}

// ── Recording constants ──────────────────────────────────────────────────────

export const MIN_SEGMENT_DURATION_SECONDS = 1
export const MAX_SEGMENT_DURATION_SECONDS = 10
export const MIN_REPLAY_MINUTES = 1
export const MAX_REPLAY_MINUTES = 60

/** Keyframe cadence, in seconds — matches the segment length for clean cuts */
export const KEYFRAME_INTERVAL_SECONDS = 2

/**
 * Supported capture frame rates.
 *
 * The high rates are here for high-refresh monitors: capture samples the screen
 * at this rate, so it also sets the ceiling on the frame rate the overlay can
 * report. A 144 Hz display captured at 60 can only ever read 60, however fast
 * the game is actually running.
 */
export const ALLOWED_FPS = [30, 60, 120, 144] as const

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
