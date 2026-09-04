import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  type DialogResult,
  type OpenResult,
  type SaveResult,
} from '@shared/types'

/**
 * The only surface exposed to the renderer. Raw ipcRenderer is never handed
 * out; each method is bound to a fixed channel.
 */
const api = {
  file: {
    save: (filePath: string, data: unknown): Promise<SaveResult> =>
      ipcRenderer.invoke(CHANNELS.FILE_SAVE, filePath, data),

    open: <T = unknown,>(filePath: string): Promise<OpenResult<T>> =>
      ipcRenderer.invoke(CHANNELS.FILE_OPEN, filePath),

    /** Native "Save as" dialog; `canceled` is true when dismissed. */
    saveDialog: (): Promise<DialogResult> => ipcRenderer.invoke(CHANNELS.FILE_SAVE_DIALOG),

    /** Native "Open" dialog. */
    openDialog: (): Promise<DialogResult> => ipcRenderer.invoke(CHANNELS.FILE_OPEN_DIALOG),
  },
} as const

export type NoteApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Still work if contextIsolation is off (it should never be).
  ;(globalThis as unknown as { api: NoteApi }).api = api
}
