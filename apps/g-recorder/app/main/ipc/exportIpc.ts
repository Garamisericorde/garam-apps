import { ipcMain } from 'electron'
import type { ExportOptions } from '../../shared/types'
import { ExportService } from '../ffmpeg/ExportService'
import { registerClipFile } from '../protocol/clipProtocol'
import { broadcast } from './broadcast'

export function registerExportIpc(): void {
  const exportService = ExportService.getInstance()

  exportService.onProgress((progress) => {
    broadcast('export:progress', progress)
  })

  ipcMain.handle('export:start', async (_event, options: ExportOptions) => {
    const outputPath = await exportService.start(options)
    // Let the renderer preview the result through the clip:// protocol
    return { outputPath, outputUrl: registerClipFile(outputPath) }
  })

  ipcMain.handle('export:cancel', () => exportService.cancel())

  ipcMain.handle('export:isBusy', () => exportService.isBusy)
}
