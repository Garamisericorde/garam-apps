import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import type { MediaInfo, ThumbnailStrip } from '../../shared/types'
import { buildThumbnailStrip, probeMedia } from '../ffmpeg/MediaProbe'
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
