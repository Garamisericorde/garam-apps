import { app, dialog, ipcMain, screen, shell } from 'electron'
import { mkdirSync } from 'fs'
import type { AppSettings, AudioDevices, DisplayInfo, FfmpegStatus } from '../../shared/types'
import { logsDir } from '../../shared/paths'
import { listAudioDevices } from '../ffmpeg/AudioDevices'
import { detectEncoders } from '../ffmpeg/EncoderDetect'
import { FfmpegManager } from '../ffmpeg/FfmpegManager'
import { RecorderService } from '../ffmpeg/RecorderService'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'
import { broadcast } from './broadcast'

export function registerSettingsIpc(): void {
  const store = SettingsStore.getInstance()
  const ffmpeg = FfmpegManager.getInstance()

  ffmpeg.onStatusChange((status: FfmpegStatus) => {
    broadcast('ffmpeg:statusChange', status)
  })

  store.onChange((settings) => {
    broadcast('settings:changed', settings)
  })

  // ── Settings ──
  ipcMain.handle('settings:get', () => store.get())

  ipcMain.handle('settings:set', (_event, partial: Partial<AppSettings>) => store.set(partial))

  ipcMain.handle('settings:pickOutputPath', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose where clips are saved',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:openLogsFolder', async () => {
    const dir = logsDir()
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  ipcMain.handle('settings:openOutputFolder', async () => {
    const dir = store.get().outputPath
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // ── FFmpeg ──
  ipcMain.handle('ffmpeg:getStatus', () => ffmpeg.getStatus())

  ipcMain.handle('ffmpeg:ensureReady', () => ffmpeg.ensureReady())

  ipcMain.handle('ffmpeg:download', () => ffmpeg.download())

  // Replaces a working-but-unusable FFmpeg — see FfmpegManager.reinstall.
  //
  // The buffer has to come down first: it is running ffmpeg.exe, and Windows
  // will not let a running executable be overwritten (EBUSY). It goes back up
  // afterwards, so the replacement costs the user a few seconds of buffer
  // rather than a manual restart. The encoder probes are cached, so they are
  // re-run against the new binary or the UI would keep reporting the old one's
  // failures.
  ipcMain.handle('ffmpeg:reinstall', async () => {
    const recorder = RecorderService.getInstance()
    const before = recorder.getStatus()

    if (before.isRecording) await recorder.stop()

    try {
      const status = await ffmpeg.reinstall()
      if (status.state === 'ready') await detectEncoders(ffmpeg.path, true)
      return status
    } finally {
      // Restore the buffer whatever happened: leaving it off after a failed
      // download would silently stop recording the user's games.
      if (before.isRecording) {
        await recorder.start().catch((err) => {
          logger.error('Could not restart the buffer after replacing FFmpeg', String(err))
        })
      }
    }
  })

  // ── Hardware / devices ──
  ipcMain.handle('devices:audio', async (_event, force?: boolean): Promise<AudioDevices> => {
    if (!ffmpeg.isReady) return { devices: [], noLoopbackFound: true }
    return listAudioDevices(ffmpeg.path, force === true)
  })

  ipcMain.handle('devices:displays', (): DisplayInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id

    return screen.getAllDisplays().map((display, index) => ({
      index,
      label: `Display ${index + 1} — ${display.size.width}×${display.size.height}`,
      width: display.size.width,
      height: display.size.height,
      // Rounded to even: both dimensions of a real display mode always are, and
      // bounds x scaleFactor is not a whole number under fractional scaling.
      nativeHeight: Math.round((display.bounds.height * display.scaleFactor) / 2) * 2,
      refreshRate: Math.round(display.displayFrequency),
      isPrimary: display.id === primaryId,
    }))
  })

  ipcMain.handle('devices:encoders', async () => {
    if (!ffmpeg.isReady) return null
    try {
      return await detectEncoders(ffmpeg.path)
    } catch (err) {
      logger.warn('Encoder detection failed', String(err))
      return null
    }
  })

  // ── App ──
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:quit', () => app.quit())
}
