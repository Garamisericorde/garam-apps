import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { resourcePath } from '@garam/core'

/**
 * Settings window. Single instance — an existing one is brought to front.
 * Frameless; the title bar comes from the @garam/ui TitleBar component.
 */
export class SettingsWindowController {
  private win: BrowserWindow | null = null

  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore()
      this.win.show()
      this.win.focus()
      return
    }

    const win = new BrowserWindow({
      width: 620,
      height: 700,
      minWidth: 520,
      minHeight: 520,
      frame: false,
      show: false,
      backgroundColor: '#14142a',
      autoHideMenuBar: true,
      // Without this the taskbar shows Electron's own icon in development,
      // because electron-vite runs the stock electron.exe. The packaged build
      // gets its icon from electron-builder, but this makes dev match.
      icon: resourcePath('icons', 'icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    this.win = win
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.win = null
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/settings.html'))
    }
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.close()
  }
}
