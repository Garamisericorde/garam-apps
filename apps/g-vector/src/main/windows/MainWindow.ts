import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { resourcePath } from '@garam/core'
import { violetSurfaces } from '@garam/theme'
import { EVENTS } from '@shared/types'

/**
 * The editor window. Frameless — the title bar is the @garam/ui TitleBar, so it
 * matches the rest of the family.
 *
 * `backgroundColor` comes from the theme's JS mirror, not a literal. A frameless
 * window paints WHITE until the first React frame lands, and on a dark editor
 * that flash is very visible; opening on the eventual background hides it.
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: violetSurfaces.bg,
    autoHideMenuBar: true,
    // Without this the taskbar shows Electron's own icon in development,
    // because electron-vite runs the stock electron.exe.
    icon: resourcePath('icons', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // The title bar's maximize button has to redraw when the window is maximized
  // by any other route — a double-click on the bar, Win+Up, a window snap.
  const reportMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send(EVENTS.WINDOW_MAXIMIZED, win.isMaximized())
  }
  win.on('maximize', reportMaximized)
  win.on('unmaximize', reportMaximized)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
