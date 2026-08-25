import { ipcMain } from 'electron'
import { join } from 'path'
import type { RecorderStatus } from '../../shared/types'
import { localTimestamp } from '../../shared/time'
import { RecorderService } from '../ffmpeg/RecorderService'
import { isSaving, runSaveReplay } from '../ffmpeg/saveReplayPipeline'
import { SettingsStore } from '../settings/SettingsStore'
import { registerClipFile } from '../protocol/clipProtocol'
import { logger } from '../logging/logger'
import { broadcast } from './broadcast'

export interface ReplaySavedPayload {
  clipPath: string
  clipUrl: string
  durationSeconds: number
}

/** Notify every renderer that a new clip is ready to edit */
export function announceReplaySaved(clipPath: string, durationSeconds: number): void {
  const payload: ReplaySavedPayload = {
    clipPath,
    clipUrl: registerClipFile(clipPath),
    durationSeconds,
  }
  broadcast('recorder:replaySaved', payload)
}

export function registerRecorderIpc(): void {
  const recorder = RecorderService.getInstance()

  recorder.onStatusChange((status: RecorderStatus) => {
    broadcast('recorder:statusChange', status)
  })

  ipcMain.handle('recorder:start', () => recorder.start())

  ipcMain.handle('recorder:stop', () => recorder.stop())

  ipcMain.handle('recorder:getStatus', () => recorder.getStatus())

  ipcMain.handle('recorder:saveReplay', async (_event, opts?: { durationSeconds?: number }) => {
    if (isSaving()) throw new Error('A replay save is already in progress')

    logger.info('recorder:saveReplay requested', opts)
    const { outputPath, durationSeconds } = await runSaveReplay(opts)
    announceReplaySaved(outputPath, durationSeconds)

    return { clipPath: outputPath, clipUrl: registerClipFile(outputPath), durationSeconds }
  })

  ipcMain.handle('recorder:startManual', async () => {
    const settings = SettingsStore.getInstance().get()
    const outputPath = join(settings.outputPath, `recording_${localTimestamp()}.mp4`)
    await recorder.startManualRecording(outputPath)
    return outputPath
  })

  ipcMain.handle('recorder:stopManual', async () => {
    const outputPath = await recorder.stopManualRecording()
    if (!outputPath) return null

    announceReplaySaved(outputPath, 0)
    return { clipPath: outputPath, clipUrl: registerClipFile(outputPath), durationSeconds: 0 }
  })

  ipcMain.handle('recorder:getCacheSize', () => recorder.cacheSizeBytes())

  ipcMain.handle('recorder:clearCache', () => recorder.clearCache())
}
