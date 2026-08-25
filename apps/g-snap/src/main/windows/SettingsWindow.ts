import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

/**
 * Ayarlar penceresi. Tek ornek — zaten aciksa one getirilir.
 * Cercevesiz; baslik cubugu @garam/ui TitleBar bileseninden geliyor.
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
