import { ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  AudioDevices,
  DisplayInfo,
  EncoderCapabilities,
  ExportOptions,
  ExportProgress,
  FfmpegStatus,
  LibraryItem,
  MediaInfo,
  RecorderStatus,
  HotkeyFailure,
  ThumbnailStrip,
} from '../shared/types'

export interface ClipRef {
  clipPath: string
  clipUrl: string
  durationSeconds: number
}

export interface OpenedClip {
  clipPath: string
  clipUrl: string
  info: MediaInfo
}

export interface ExportResult {
  outputPath: string
  outputUrl: string
}

export interface Notice {
  level: 'info' | 'warning' | 'error'
  message: string
}

/** Subscribe to a main-process broadcast; returns an unsubscribe function. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** Typed IPC surface exposed to the renderer via contextBridge */
export const api = {
  recorder: {
    start: (): Promise<void> => ipcRenderer.invoke('recorder:start'),
    stop: (): Promise<void> => ipcRenderer.invoke('recorder:stop'),
    getStatus: (): Promise<RecorderStatus> => ipcRenderer.invoke('recorder:getStatus'),

    saveReplay: (opts?: { durationSeconds?: number }): Promise<ClipRef> =>
      ipcRenderer.invoke('recorder:saveReplay', opts),

    startManual: (): Promise<string> => ipcRenderer.invoke('recorder:startManual'),
    stopManual: (): Promise<ClipRef | null> => ipcRenderer.invoke('recorder:stopManual'),

    getCacheSize: (): Promise<number> => ipcRenderer.invoke('recorder:getCacheSize'),
    clearCache: (): Promise<void> => ipcRenderer.invoke('recorder:clearCache'),

    onStatusChange: (callback: (status: RecorderStatus) => void): (() => void) =>
      subscribe('recorder:statusChange', callback),

    onReplaySaved: (callback: (clip: ClipRef) => void): (() => void) =>
      subscribe('recorder:replaySaved', callback),
  },

  export: {
    start: (options: ExportOptions): Promise<ExportResult> =>
      ipcRenderer.invoke('export:start', options),
    cancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
    isBusy: (): Promise<boolean> => ipcRenderer.invoke('export:isBusy'),

    onProgress: (callback: (progress: ExportProgress) => void): (() => void) =>
      subscribe('export:progress', callback),
  },

  media: {
    openFile: (): Promise<OpenedClip | null> => ipcRenderer.invoke('media:openFile'),
    loadPath: (clipPath: string): Promise<OpenedClip> =>
      ipcRenderer.invoke('media:loadPath', clipPath),
    probe: (clipPath: string): Promise<MediaInfo> => ipcRenderer.invoke('media:probe', clipPath),

    /** Clips this app has saved, newest first — metadata only */
    library: (): Promise<LibraryItem[]> => ipcRenderer.invoke('media:library'),
    /** One poster frame for a library item, rendered on demand */
    poster: (clipPath: string): Promise<string | null> =>
      ipcRenderer.invoke('media:poster', clipPath),

    thumbnails: (clipPath: string, durationSeconds: number): Promise<ThumbnailStrip> =>
      ipcRenderer.invoke('media:thumbnails', clipPath, durationSeconds),

    revealInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('media:revealInFolder', filePath),

    /**
     * Resolve the absolute path of a dropped File. Reading `File.path`
     * directly is deprecated in Electron, so this goes through webUtils.
     */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', partial),

    pickOutputPath: (): Promise<string | null> => ipcRenderer.invoke('settings:pickOutputPath'),
    openLogsFolder: (): Promise<void> => ipcRenderer.invoke('settings:openLogsFolder'),
    openOutputFolder: (): Promise<void> => ipcRenderer.invoke('settings:openOutputFolder'),

    onChange: (callback: (settings: AppSettings) => void): (() => void) =>
      subscribe('settings:changed', callback),
  },

  ffmpeg: {
    getStatus: (): Promise<FfmpegStatus> => ipcRenderer.invoke('ffmpeg:getStatus'),
    ensureReady: (): Promise<FfmpegStatus> => ipcRenderer.invoke('ffmpeg:ensureReady'),
    download: (): Promise<FfmpegStatus> => ipcRenderer.invoke('ffmpeg:download'),
    /** Replace an installed FFmpeg with the pinned, driver-compatible build */
    reinstall: (): Promise<FfmpegStatus> => ipcRenderer.invoke('ffmpeg:reinstall'),

    onStatusChange: (callback: (status: FfmpegStatus) => void): (() => void) =>
      subscribe('ffmpeg:statusChange', callback),
  },

  /**
   * System audio capture, which Chromium does and FFmpeg cannot — the renderer
   * captures it and pushes raw PCM back for FFmpeg to mux.
   */
  systemAudio: {
    onStart: (
      callback: (format: { sampleRate: number; channels: number }) => void,
    ): (() => void) => subscribe('systemAudio:start', callback),
    onStop: (callback: () => void): (() => void) => subscribe('systemAudio:stop', callback),
    sendChunk: (pcm: ArrayBuffer): void => ipcRenderer.send('systemAudio:chunk', pcm),
    reportError: (message: string): void => ipcRenderer.send('systemAudio:error', message),
  },

  devices: {
    audio: (force?: boolean): Promise<AudioDevices> => ipcRenderer.invoke('devices:audio', force),
    displays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('devices:displays'),
    encoders: (): Promise<EncoderCapabilities | null> => ipcRenderer.invoke('devices:encoders'),
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),

    /** The main process asking the renderer to move to a route */
    onNavigate: (callback: (route: string) => void): (() => void) =>
      subscribe('app:navigate', callback),

    /** Background failures worth showing the user */
    onNotice: (callback: (notice: Notice) => void): (() => void) =>
      subscribe('app:notice', callback),

    /** Hotkeys that did not register, with the reason for each */
    onHotkeyConflict: (callback: (failures: HotkeyFailure[]) => void): (() => void) =>
      subscribe('app:hotkeyConflict', callback),
  },
} as const

export type AppApi = typeof api
