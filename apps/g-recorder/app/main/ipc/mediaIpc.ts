import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import type { LibraryItem, MediaInfo, ThumbnailStrip } from '../../shared/types'
import {
  buildPosterFrame,
  buildThumbnailStrip,
  buildWaveform,
  probeMedia,
} from '../ffmpeg/MediaProbe'
import { SettingsStore } from '../settings/SettingsStore'
import { registerClipFile } from '../protocol/clipProtocol'
import { logger } from '../logging/logger'

export interface OpenedClip {
  clipPath: string
  clipUrl: string
  info: MediaInfo
}

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']

/**
 * Clips opened from outside the output folder, most recent first.
 *
 * Held in memory rather than written to disk: it is a convenience for the
 * session you are in, and a file of "videos this app once touched" is a
 * privacy footprint nobody asked for.
 */
const recentlyOpened: string[] = []
const MAX_RECENT = 20

function forget(clipPath: string): void {
  const index = recentlyOpened.indexOf(clipPath)
  if (index !== -1) recentlyOpened.splice(index, 1)
}

function remember(clipPath: string): void {
  const index = recentlyOpened.indexOf(clipPath)
  if (index !== -1) recentlyOpened.splice(index, 1)
  recentlyOpened.unshift(clipPath)
  recentlyOpened.length = Math.min(recentlyOpened.length, MAX_RECENT)
}

export function registerMediaIpc(getMainWindow: () => BrowserWindow | null): void {
  /** Native "open video" dialog */
  ipcMain.handle('media:openFile', async (): Promise<OpenedClip | null> => {
    const window = getMainWindow()
    const options = {
      title: 'Open a video',
      properties: ['openFile' as const],
      filters: [
        { name: 'Video', extensions: VIDEO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    }

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null
    return loadClip(result.filePaths[0])
  })

  /** Load a path the renderer already has — used for drag-and-drop */
  ipcMain.handle('media:loadPath', async (_event, clipPath: string): Promise<OpenedClip> => {
    if (typeof clipPath !== 'string' || !existsSync(clipPath)) {
      throw new Error('That file could not be found')
    }
    return loadClip(clipPath)
  })

  ipcMain.handle('media:probe', async (_event, clipPath: string): Promise<MediaInfo> => {
    return probeMedia(clipPath)
  })

  ipcMain.handle(
    'media:thumbnails',
    async (_event, clipPath: string, durationSeconds: number): Promise<ThumbnailStrip> => {
      try {
        return await buildThumbnailStrip(clipPath, durationSeconds)
      } catch (err) {
        logger.warn('Could not build thumbnail strip', String(err))
        return { frames: [] }
      }
    },
  )

  /**
   * The clips this app has produced, newest first.
   *
   * Read from the output folder rather than kept as a list the user curates:
   * everything the recorder saves lands there already, so a separate library
   * would only be a second place for the same files to be missing from.
   *
   * Deliberately metadata-only — no probing, no thumbnails. A folder with a
   * hundred replays would otherwise spawn a hundred FFmpeg processes before the
   * panel could paint; posters are fetched per item, as they come into view.
   */
  ipcMain.handle('media:library', (): LibraryItem[] => {
    const dir = SettingsStore.getInstance().get().outputPath
    const items = new Map<string, LibraryItem>()

    // Clips opened from elsewhere belong in the list too. Without them,
    // importing a video appears to do nothing: it loads into the editor and
    // the panel beside it still says the library is empty.
    for (const path of recentlyOpened) {
      if (!existsSync(path)) continue
      try {
        const stats = statSync(path)
        items.set(path, {
          path,
          name: basename(path),
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs,
        })
      } catch {
        // Gone between the check and the stat; it simply does not appear.
      }
    }

    if (!existsSync(dir)) return [...items.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)

    try {
      readdirSync(dir)
        .filter((name) => VIDEO_EXTENSIONS.includes(extname(name).slice(1).toLowerCase()))
        .map((name) => {
          const path = join(dir, name)
          const stats = statSync(path)
          return {
            path,
            name: basename(name),
            sizeBytes: stats.size,
            modifiedAt: stats.mtimeMs,
          }
        })
        .forEach((item) => items.set(item.path, item))
    } catch (err) {
      logger.warn('Could not read the clip library', String(err))
    }

    return [...items.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)
  })

  ipcMain.handle(
    'media:waveform',
    async (_event, clipPath: string, buckets: number): Promise<number[]> => {
      try {
        return await buildWaveform(clipPath, buckets)
      } catch (err) {
        // A clip with no audio track is the common case, not a failure.
        logger.debug('No waveform for this clip', { clipPath, error: String(err) })
        return []
      }
    },
  )

  ipcMain.handle('media:poster', async (_event, clipPath: string): Promise<string | null> => {
    if (!existsSync(clipPath)) return null
    try {
      const info = await probeMedia(clipPath)
      return await buildPosterFrame(clipPath, info.durationSeconds)
    } catch (err) {
      logger.debug('Poster unavailable', { clipPath, error: String(err) })
      return null
    }
  })

  /**
   * Send a clip to the recycle bin.
   *
   * Trash rather than unlink: this is the user's footage, reached from a list
   * where the neighbouring entry is "open", and a misclick that permanently
   * destroys a recording is not a risk worth taking to save a keystroke.
   */
  ipcMain.handle('media:delete', async (_event, filePath: string): Promise<void> => {
    if (typeof filePath !== 'string' || !existsSync(filePath)) return
    await shell.trashItem(filePath)
    forget(filePath)
    logger.info('Clip moved to the recycle bin', { filePath })
  })

  /** Drop a clip from the list without touching the file */
  ipcMain.handle('media:forget', (_event, filePath: string): void => {
    forget(filePath)
  })

  /** Open Explorer with the file selected */
  ipcMain.handle('media:revealInFolder', (_event, filePath: string) => {
    if (typeof filePath === 'string' && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })
}

async function loadClip(clipPath: string): Promise<OpenedClip> {
  const info = await probeMedia(clipPath)
  logger.info('Clip opened', { clipPath, duration: info.durationSeconds })

  // Every route in — the dialog, a drop, the library — comes through here, so
  // this is the one place that has to remember what was opened.
  remember(clipPath)

  return { clipPath, clipUrl: registerClipFile(clipPath), info }
}
