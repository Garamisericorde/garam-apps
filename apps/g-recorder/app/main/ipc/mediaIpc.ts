import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import type { LibraryItem, MediaInfo, ThumbnailStrip } from '../../shared/types'
import { buildPosterFrame, buildThumbnailStrip, probeMedia } from '../ffmpeg/MediaProbe'
import { SettingsStore } from '../settings/SettingsStore'
import { registerClipFile } from '../protocol/clipProtocol'
import { logger } from '../logging/logger'

export interface OpenedClip {
  clipPath: string
  clipUrl: string
  info: MediaInfo
}

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']

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

  /** Open Explorer with the file selected */
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
    if (!existsSync(dir)) return []

    try {
      return readdirSync(dir)
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
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
    } catch (err) {
      logger.warn('Could not read the clip library', String(err))
      return []
    }
  })

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

  ipcMain.handle('media:revealInFolder', (_event, filePath: string) => {
    if (typeof filePath === 'string' && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })
}

async function loadClip(clipPath: string): Promise<OpenedClip> {
  const info = await probeMedia(clipPath)
  logger.info('Clip opened', { clipPath, duration: info.durationSeconds })

  return { clipPath, clipUrl: registerClipFile(clipPath), info }
}
