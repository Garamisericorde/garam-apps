/** A rectangle in pixels or DIP. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** One display's frozen screenshot. */
import type { LocaleId } from './i18n/index.js'

export interface DisplayShot {
  displayId: number
  /** Position and size within the combined display space (DIP). */
  bounds: Rect
  /**
   * The DPI scale the OS reports (1 = 100%, 1.5 = 150%).
   * Informational only; scaling maths should use `nativeSize`.
   */
  scaleFactor: number
  /**
   * The REAL pixel size of the captured image.
   *
   * At a fractional DPI scale `bounds * scaleFactor` is not a whole number and
   * can miss the true pixel count by one. The export surfaces that drift as
   * blur, so every scale is derived from
   * `nativeSize.width / bounds.width` instead.
   */
  nativeSize: { width: number; height: number }
  /**
   * Raw BGRA pixels, straight from `nativeImage.toBitmap()`.
   *
   * NOT a PNG data URL: encoding one costs ~137 ms and decoding it in the
   * renderer costs more again, all on the hotkey path. `toBitmap()` takes 4 ms
   * and the renderer can hand the buffer to `createImageBitmap` directly.
   */
  pixels: Uint8Array
}

/** DIP -> real pixel scale for a captured display. */
export function pixelScaleOf(shot: Pick<DisplayShot, 'bounds' | 'nativeSize'>): number {
  return shot.bounds.width > 0 ? shot.nativeSize.width / shot.bounds.width : 1
}

/** Payload sent to the overlay window when it opens. */
export interface OverlayInit {
  shots: DisplayShot[]
  /** Rectangle covering every display (DIP) — the overlay window's bounds. */
  union: Rect
  /**
   * Where the mouse is right now, in the overlay window's own coordinates
   * (DIP relative to `union`, which is what CSS pixels are here).
   *
   * The overlay window is reused between captures, so its React state survives
   * a close. Without this the readout reappears at the position it held when
   * the previous capture ended and only jumps to the truth on the first mouse
   * move — the browser cannot know where the pointer is until an event arrives.
   */
  cursor: { x: number; y: number }
  /** Default pen color and thickness, taken from the settings. */
  defaults: {
    color: string
    thickness: number
  }
  /**
   * Interface language.
   *
   * The overlay never reads the settings itself — it is built on the hotkey
   * path and a round trip there would be a round trip too many — so the
   * language rides along with the frame.
   */
  language: LocaleId
  /**
   * A dry run sent at startup: render it, then throw it away. Nothing is shown
   * and `overlay:ready` is not called. See OverlayWindow.warmRenderer().
   */
  warmup?: boolean
}

export type ImageFormat = 'png' | 'jpg'

/** Request the overlay sends to the main process once a selection is confirmed. */
export interface CommitRequest {
  /** The cropped image with annotations already rendered in. */
  dataUrl: string
  /** The source selection rectangle (DIP) — used for logging and file names. */
  rect: Rect
  action: 'copy' | 'save' | 'save-as'
}

export interface CommitResult {
  ok: boolean
  /** Path to the file, when one was written. */
  filePath?: string
  /** Message to show the user on failure. */
  error?: string
}

export interface SnapSettings {
  /** Interface language. Defaults to English rather than the system locale. */
  language: LocaleId

  /** Shortcut for the region selection overlay. */
  hotkeyRegion: string
  /** Shortcut that copies the whole screen straight to the clipboard. */
  hotkeyFullscreen: string

  /** Folder screenshots are saved into. */
  saveDirectory: string
  /** File name template — {YYYY} {MM} {DD} {HH} {mm} {ss} {app} {n} */
  fileNameTemplate: string
  imageFormat: ImageFormat
  /** JPEG quality (1-100); only used when imageFormat is 'jpg'. */
  jpegQuality: number

  /** Copy to the clipboard automatically when a selection is confirmed. */
  copyToClipboard: boolean
  /** Ask where to save every time. */
  askWhereToSave: boolean

  /** Start with Windows. */
  launchAtStartup: boolean

  /** Annotation defaults. */
  defaultColor: string
  defaultThickness: number
}

/** Events the main process broadcasts to renderers. */
export const EVENTS = {
  OVERLAY_INIT: 'overlay:init',
  /**
   * The overlay has been put away — drop everything on screen.
   *
   * The window is kept alive at opacity 0 and goes on painting, so whatever was
   * last drawn stays in its surface until the next frame lands. On the next
   * capture that surface can be presented for an instant before the new one is
   * ready, and the user sees the PREVIOUS session: the old readout position,
   * the old frozen screenshot. Clearing on close makes the resting state plain
   * black, which is the same black the overlay already uses to hide its first
   * unpainted frame — so a stale present shows nothing instead of something wrong.
   */
  OVERLAY_CLEAR: 'overlay:clear',
  SETTINGS_CHANGED: 'settings:changed',
  TOAST: 'app:toast',
} as const

/** Invoke channels the renderer calls on the main process. */
export const CHANNELS = {
  OVERLAY_READY: 'overlay:ready',
  OVERLAY_CANCEL: 'overlay:cancel',
  OVERLAY_COMMIT: 'overlay:commit',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_PICK_DIR: 'settings:pick-directory',
  SETTINGS_TEST_HOTKEY: 'settings:test-hotkey',
  APP_OPEN_LOGS: 'app:open-logs',
  APP_OPEN_PATH: 'app:open-path',
  APP_VERSION: 'app:version',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_CLOSE: 'window:close',
} as const

/** Reports shortcut registration results back to the settings window. */
export interface HotkeyStatus {
  hotkeyRegion: boolean
  hotkeyFullscreen: boolean
}

export interface ToastMessage {
  tone: 'success' | 'error' | 'info'
  text: string
  /** When set, clicking the toast opens this file or folder. */
  path?: string
}
