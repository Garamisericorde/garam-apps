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
 * Renderer'a acilan TEK yuzey. Ham ipcRenderer asla disari verilmiyor;
 * her yontem sabit bir kanala bagli, kanal adi renderer'dan gelmiyor.
 */
const api = {
  overlay: {
    /** Overlay cizimi bitti — ana surec pencereyi gorunur yapabilir. */
    ready: (): Promise<void> => ipcRenderer.invoke(CHANNELS.OVERLAY_READY),

    /** ESC veya sag tik — overlay'i kapat. */
    cancel: (): Promise<void> => ipcRenderer.invoke(CHANNELS.OVERLAY_CANCEL),

    /** Secimi panoya kopyala ve/veya diske kaydet. */
    commit: (request: CommitRequest): Promise<CommitResult> =>
      ipcRenderer.invoke(CHANNELS.OVERLAY_COMMIT, request),

    /** Ana suructen gelen acilis verisini dinle. */
    onInit: (listener: (init: OverlayInit) => void): (() => void) =>
      subscribe(EVENTS.OVERLAY_INIT, listener),
  },

  settings: {
    get: (): Promise<SettingsSnapshot> => ipcRenderer.invoke(CHANNELS.SETTINGS_GET),

    set: (patch: Partial<SnapSettings>): Promise<Omit<SettingsSnapshot, 'version'>> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, patch),

    reset: (): Promise<Omit<SettingsSnapshot, 'version'>> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_RESET),

    /** Klasor secme dialogu; iptal edilirse null. */
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.SETTINGS_PICK_DIR),
  },

  app: {
    version: (): Promise<string> => ipcRenderer.invoke(CHANNELS.APP_VERSION),
    openLogs: (): Promise<void> => ipcRenderer.invoke(CHANNELS.APP_OPEN_LOGS),
    /** Klasoru acar; yol bir goruntu dosyasiysa Explorer'da secili gosterir. */
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

/** Olay aboneligi kurar ve temizleyici doner. */
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
  // contextIsolation kapaliysa (olmamali) yine de calissin.
  ;(globalThis as unknown as { api: SnapApi }).api = api
}
