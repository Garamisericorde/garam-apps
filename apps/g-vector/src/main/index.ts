import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/MainWindow'
import { registerIpc } from './ipc/registerIpc'

// One instance. A second launch focuses the window that already exists rather
// than opening a rival editor over the same documents.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.garam.g-vector')
    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    mainWindow = createMainWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
