import { app, dialog, ipcMain, screen, shell } from 'electron'
import { mkdirSync } from 'fs'
import type { AppSettings, AudioDevices, DisplayInfo, FfmpegStatus } from '../../shared/types'
import { logsDir } from '../../shared/paths'
import { listAudioDevices } from '../ffmpeg/AudioDevices'
import { detectEncoders } from '../ffmpeg/EncoderDetect'
import { FfmpegManager } from '../ffmpeg/FfmpegManager'
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
