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

/** Events the main process broadcasts to the renderer. */
export const EVENTS = {
  WINDOW_MAXIMIZED: 'window:maximized',
} as const
