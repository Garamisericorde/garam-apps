import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  EVENTS,
  type CommitRequest,
  type CommitResult,
  type HotkeyStatus,
  type OverlayInit,
  type SnapSettings,
  type ToastMessage,
} from '@shared/types'

export interface SettingsSnapshot {
  values: SnapSettings
  hotkeyStatus: HotkeyStatus
  version: string
}

/**
 * The ONLY surface exposed to the renderer. Raw ipcRenderer is never handed
 * out; each method is bound to a fixed channel, and channel names never come
 * from the renderer.
 */
const api = {
  overlay: {
    /** The overlay has painted — the main process may now show the window. */
    ready: (): Promise<void> => ipcRenderer.invoke(CHANNELS.OVERLAY_READY),

    /** Esc or right-click — close the overlay. */
    cancel: (): Promise<void> => ipcRenderer.invoke(CHANNELS.OVERLAY_CANCEL),

    /** Copy the selection to the clipboard and/or save it to disk. */
    commit: (request: CommitRequest): Promise<CommitResult> =>
      ipcRenderer.invoke(CHANNELS.OVERLAY_COMMIT, request),

    /** Listen for the init payload from the main process. */
    onInit: (listener: (init: OverlayInit) => void): (() => void) =>
      subscribe(EVENTS.OVERLAY_INIT, listener),

    /** The overlay closed — clear the canvas so nothing stale can be shown. */
    onClear: (listener: () => void): (() => void) => subscribe(EVENTS.OVERLAY_CLEAR, listener),
  },

  settings: {
    get: (): Promise<SettingsSnapshot> => ipcRenderer.invoke(CHANNELS.SETTINGS_GET),

    set: (patch: Partial<SnapSettings>): Promise<Omit<SettingsSnapshot, 'version'>> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, patch),

    reset: (): Promise<Omit<SettingsSnapshot, 'version'>> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_RESET),

    /** Folder picker dialog; resolves to null when cancelled. */
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.SETTINGS_PICK_DIR),
  },

  app: {
    version: (): Promise<string> => ipcRenderer.invoke(CHANNELS.APP_VERSION),
    openLogs: (): Promise<void> => ipcRenderer.invoke(CHANNELS.APP_OPEN_LOGS),
    /** Opens a folder, or reveals the file in Explorer when given an image path. */
    openPath: (path: string): Promise<void> => ipcRenderer.invoke(CHANNELS.APP_OPEN_PATH, path),
    onToast: (listener: (message: ToastMessage) => void): (() => void) =>
      subscribe(EVENTS.TOAST, listener),
  },

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(CHANNELS.WINDOW_MINIMIZE),
    close: (): Promise<void> => ipcRenderer.invoke(CHANNELS.WINDOW_CLOSE),
  },
} as const

export type SnapApi = typeof api

/** Subscribes to an event and returns an unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Still work if contextIsolation is off (it should never be).
  ;(globalThis as unknown as { api: SnapApi }).api = api
}
