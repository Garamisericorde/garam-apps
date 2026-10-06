/** Invoke channels the renderer calls on the main process. */
export const CHANNELS = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  APP_VERSION: 'app:version',
  IMAGE_PICK: 'image:pick',
} as const

/** A bitmap chosen through the file dialog, ready to place. */
export interface PickedImage {
  /** A data URL, so the document that embeds it stays self-contained. */
  dataUrl: string
  name: string
}

/**
 * How far the window sticks out past the screen on each side.
 *
 * Windows maximises a FRAMELESS window to the work area plus its invisible
 * resize border, so the outermost few pixels on every edge are off screen. The
 * renderer has to pad by exactly that much or its title bar — and with it the
 * whole draggable strip — sits above the top of the display.
 */
export interface WindowInset {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_INSET: WindowInset = { top: 0, right: 0, bottom: 0, left: 0 }

export interface WindowState {
  maximized: boolean
  inset: WindowInset
}

/** Events the main process broadcasts to the renderer. */
export const EVENTS = {
  WINDOW_STATE: 'window:state',
} as const
