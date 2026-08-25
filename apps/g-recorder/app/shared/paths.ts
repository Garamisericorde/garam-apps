import { join } from 'path'
import { app } from 'electron'

/** Base user-data directory (%APPDATA%/g-recorder) */
export function userDataDir(): string {
  return app.getPath('userData')
}

export function logsDir(): string {
  return join(userDataDir(), 'logs')
}

/** Rolling replay-buffer segments live here */
export function cacheDir(): string {
  return join(userDataDir(), 'cache')
}

/** Downloaded FFmpeg binaries live here when not bundled */
export function binDir(): string {
  return join(userDataDir(), 'bin')
}

/** Cached timeline thumbnails */
export function thumbsDir(): string {
  return join(userDataDir(), 'thumbs')
}

export function settingsFilePath(): string {
  return join(userDataDir(), 'settings.json')
}

export function segmentIndexPath(): string {
  return join(cacheDir(), 'segments-index.json')
}

export function segmentListPath(): string {
  return join(cacheDir(), 'segments.csv')
}

export function concatListPath(): string {
  return join(cacheDir(), 'concat.txt')
}
