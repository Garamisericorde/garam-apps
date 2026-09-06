import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'fs'
import { basename } from 'path'
import type { LibraryItem, MediaInfo, ThumbnailStrip } from '../../shared/types'
import {
  buildPosterFrame,
  buildThumbnailStrip,
  buildWaveform,
  probeMedia,
} from '../ffmpeg/MediaProbe'
import { registerClipFile } from '../protocol/clipProtocol'
import { addToLibrary, listLibrary, removeFromLibrary } from '../settings/ClipLibrary'
import { SettingsStore } from '../settings/SettingsStore'
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
      // Where the recorder writes, since that is where the clip being looked
      // for almost always is.
      defaultPath: SettingsStore.getInstance().get().outputPath,
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
   * The clips in the editor's list, most recently added first.
   *
   * What the user put there, not what is in the output folder. Reading the
   * folder meant every replay saved mid-game appeared in the editor unasked,
   * and the list became a record of everything ever recorded rather than of
   * what is being worked on.
   *
   * Deliberately metadata-only, no probing or thumbnails: a long list would
   * otherwise spawn an FFmpeg process per entry before the panel could paint.
   * Posters are fetched per item, as they come into view.
   */
  ipcMain.handle('media:library', async (): Promise<LibraryItem[]> => {
    const items: LibraryItem[] = []

    for (const path of await listLibrary()) {
      try {
        const stats = statSync(path)
        items.push({ path, name: basename(path), sizeBytes: stats.size, modifiedAt: stats.mtimeMs })
      } catch {
        // Gone between the existence check and the stat; it simply does not
        // appear, and the next read drops it for good.
      }
    }

    return items
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
   * Take a clip out of the list, leaving the file alone.
   *
   * This app does not delete anyone's footage. Removing a recording from a
   * folder is something a file manager does, with the confirmation and the undo
   * that come with it, and a video editor offering the same button beside
   * "open" is one misclick away from destroying a recording.
   */
  ipcMain.handle('media:forget', async (_event, filePath: string): Promise<void> => {
    await removeFromLibrary(filePath)
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

  // Every route in (the dialog, a drop, the list itself) comes through here,
  // so this is the one place that has to put it in the list.
  await addToLibrary(clipPath)

  return { clipPath, clipUrl: registerClipFile(clipPath), info }
}
