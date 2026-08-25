import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { logger } from '../logging/logger'

const WIDTH = 96
const HEIGHT = 28
const MARGIN = 12

/**
 * A small always-on-top badge showing whether capture is running. It is
 * click-through, so it never gets in the way of whatever is being recorded.
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null

  create(): void {
    if (this.win && !this.win.isDestroyed()) return

    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize

    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: screenWidth - WIDTH - MARGIN,
      y: MARGIN,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    })

    // Mouse events pass straight through to whatever is underneath
    this.win.setIgnoreMouseEvents(true)
    // 'screen-saver' keeps it visible above borderless-fullscreen games
    this.win.setAlwaysOnTop(true, 'screen-saver')

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void this.win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/overlay`)
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
    }

    this.win.once('ready-to-show', () => {
      this.win?.showInactive()
      logger.info('Overlay window shown')
    })
  }

  /** Show or hide the badge without tearing the window down */
  setVisible(visible: boolean): void {
    if (visible) {
      if (!this.win || this.win.isDestroyed()) {
        this.create()
        return
      }
      this.win.showInactive()
      return
    }
    this.win?.hide()
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
