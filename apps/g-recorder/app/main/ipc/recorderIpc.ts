import { ipcMain } from 'electron'
import type { RecorderStatus } from '../../shared/types'
import { RecorderService } from '../ffmpeg/RecorderService'
import { isSaving, runSaveReplay } from '../ffmpeg/saveReplayPipeline'
import { registerClipFile } from '../protocol/clipProtocol'
import { receiveSystemAudioChunk } from '../audio/SystemAudioBridge'
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

  ipcMain.handle('recorder:getCacheSize', () => recorder.cacheSizeBytes())

  ipcMain.handle('recorder:clearCache', () => recorder.clearCache())
}
