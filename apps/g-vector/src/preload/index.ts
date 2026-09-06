import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, EVENTS, type PickedImage } from '@shared/types'

/**
 * The ONLY surface exposed to the renderer. Raw ipcRenderer is never handed
 * out; each method is bound to a fixed channel, and channel names never come
 * from the renderer.
 */
const api = {
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(CHANNELS.WINDOW_MINIMIZE),
    maximize: (): Promise<void> => ipcRenderer.invoke(CHANNELS.WINDOW_MAXIMIZE),
    close: (): Promise<void> => ipcRenderer.invoke(CHANNELS.WINDOW_CLOSE),
    /** Fires whenever the window is maximized or restored, by any route. */
    onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        listener(maximized)
      ipcRenderer.on(EVENTS.WINDOW_MAXIMIZED, handler)
      return () => ipcRenderer.removeListener(EVENTS.WINDOW_MAXIMIZED, handler)
    },
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(CHANNELS.APP_VERSION),
  },
  image: {
    /** Opens the file dialog; resolves to null when it is cancelled. */
    pick: (): Promise<PickedImage | null> => ipcRenderer.invoke(CHANNELS.IMAGE_PICK),
  },
}

export type GVectorApi = typeof api

contextBridge.exposeInMainWorld('api', api)
