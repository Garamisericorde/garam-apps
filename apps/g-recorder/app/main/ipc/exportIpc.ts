import { ipcMain } from 'electron'
import type { ExportOptions } from '../../shared/types'
import type { UserExportPreset } from '../../shared/types'
import { ExportService } from '../ffmpeg/ExportService'
import {
  deleteUserPreset,
  listUserPresets,
  saveUserPreset,
} from '../settings/ExportPresetStore'
import { registerClipFile } from '../protocol/clipProtocol'
import { broadcast } from './broadcast'

export function registerExportIpc(): void {
  const exportService = ExportService.getInstance()

  exportService.onProgress((progress) => {
    broadcast('export:progress', progress)
  })

  // ── Saved export setups ──
  ipcMain.handle('presets:list', () => listUserPresets())
  ipcMain.handle('presets:save', (_event, preset: UserExportPreset) => saveUserPreset(preset))
  ipcMain.handle('presets:delete', (_event, name: string) => deleteUserPreset(name))

  ipcMain.handle('export:start', async (_event, options: ExportOptions) => {
    const outputPath = await exportService.start(options)
    // Let the renderer preview the result through the clip:// protocol
    return { outputPath, outputUrl: registerClipFile(outputPath) }
  })

  ipcMain.handle('export:cancel', () => exportService.cancel())

  ipcMain.handle('export:isBusy', () => exportService.isBusy)
}
