/** Invoke channels the renderer calls on the main process. */
export const CHANNELS = {
  FILE_SAVE: 'file:save',
  FILE_OPEN: 'file:open',
  FILE_SAVE_DIALOG: 'file:save-dialog',
  FILE_OPEN_DIALOG: 'file:open-dialog',
} as const

/** File extension for saved notes. */
export const NOTE_EXTENSION = 'gnote'

export interface SaveResult {
  success: boolean
  error?: string
}

export interface OpenResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface DialogResult {
  canceled: boolean
  filePath?: string
}

/**
 * Minimum shape a `.gnote` file must have to be accepted.
 * The renderer owns the full document type; the main process only checks that
 * the file is plausibly one of ours before handing it over.
 */
export interface NoteFileHeader {
  appVersion: string
  documentVersion: number
}
