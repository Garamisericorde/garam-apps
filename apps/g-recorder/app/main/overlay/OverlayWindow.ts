import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { logger } from '../logging/logger'

const WIDTH = 26
const HEIGHT = 26
const MARGIN = 12

/**
 * Pushed down the left edge to clear Steam's frame counter, which claims the
 * very top-left corner and would otherwise sit on top of this.
 */
const TOP_OFFSET = 34

/** How often to re-claim the top of the window stack while visible */
const ON_TOP_REASSERT_MS = 2_000

/**
 * A small always-on-top dot showing whether capture is running. It is
 * click-through, so it never gets in the way of whatever is being recorded.
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null
  private keepOnTop: ReturnType<typeof setInterval> | null = null

  create(): void {
    if (this.win && !this.win.isDestroyed()) return

    // Top-left, measured from the work area rather than the screen size so it
    // lands correctly on a secondary monitor and above a taskbar.
    const { x: workX, y: workY } = screen.getPrimaryDisplay().workArea

    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: workX + MARGIN,
      y: workY + TOP_OFFSET,
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
    this.assertOnTop()

    // A game going fullscreen re-orders the window stack and drops the badge
    // behind it, permanently — Windows does not put it back. Re-asserting on a
    // slow timer costs nothing and is what keeps it visible across alt-tabs and
    // mode changes. Note this cannot win against *exclusive* fullscreen, which
    // bypasses the desktop compositor entirely; borderless is the fix there.
    this.keepOnTop = setInterval(() => this.assertOnTop(), ON_TOP_REASSERT_MS)

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

  /**
   * Claim the top of the window stack.
   *
   * 'screen-saver' is the highest level Electron exposes and the only one that
   * clears borderless-fullscreen games; setVisibleOnAllWorkspaces keeps it from
   * being left behind on a virtual-desktop switch.
   */
  private assertOnTop(): void {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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
    if (this.keepOnTop) clearInterval(this.keepOnTop)
    this.keepOnTop = null
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
