import { ipcMain } from 'electron'
import { basename, join } from 'path'
import type { RecorderStatus } from '../../shared/types'
import { localTimestamp } from '../../shared/time'
import { RecorderService } from '../ffmpeg/RecorderService'
import { isSaving, runSaveReplay } from '../ffmpeg/saveReplayPipeline'
import { SettingsStore } from '../settings/SettingsStore'
import { registerClipFile } from '../protocol/clipProtocol'
import { receiveSystemAudioChunk } from '../audio/SystemAudioBridge'
import { logger } from '../logging/logger'
import { broadcast } from './broadcast'

export interface ReplaySavedPayload {
  clipPath: string
  clipUrl: string
  durationSeconds: number
}

/**
 * Say out loud what the recorder just did.
 *
 * A hotkey pressed with a game in the foreground has no other feedback: the
 * window is behind the game, the tray icon is a few pixels, and without a line
 * of text the honest answer to "did it save?" was to go and look in a folder.
 */
export function announce(message: string): void {
  broadcast('app:notice', { level: 'info', message })
}

/** Notify every renderer that a new clip is ready to edit */
export function announceReplaySaved(clipPath: string, durationSeconds: number): void {
  const payload: ReplaySavedPayload = {
    clipPath,
    clipUrl: registerClipFile(clipPath),
    durationSeconds,
  }
  broadcast('recorder:replaySaved', payload)
  announce(`Clip saved · ${basename(clipPath)}`)
}

export function registerRecorderIpc(): void {
  const recorder = RecorderService.getInstance()

  recorder.onStatusChange((status: RecorderStatus) => {
    broadcast('recorder:statusChange', status)
  })

  // Raw PCM from the renderer's loopback capture. `on`, not `handle`: this
  // fires many times a second and has nothing to return.
  ipcMain.on('systemAudio:chunk', (_event, pcm: ArrayBuffer) => {
    receiveSystemAudioChunk(Buffer.from(pcm))
  })

  ipcMain.on('systemAudio:error', (_event, message: string) => {
    logger.warn('SystemAudio: renderer reported a failure', message)
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
    announce('Recording started')
    return outputPath
  })

  ipcMain.handle('recorder:stopManual', async () => {
    const outputPath = await recorder.stopManualRecording()
    if (!outputPath) return null

    announce('Recording stopped')
    announceReplaySaved(outputPath, 0)
    return { clipPath: outputPath, clipUrl: registerClipFile(outputPath), durationSeconds: 0 }
  })

  ipcMain.handle('recorder:getCacheSize', () => recorder.cacheSizeBytes())

  ipcMain.handle('recorder:clearCache', () => recorder.clearCache())
}
