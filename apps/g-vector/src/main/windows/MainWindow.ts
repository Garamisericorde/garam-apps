import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { resourcePath } from '@garam/core'
import { violetSurfaces } from '@garam/theme'
import { EVENTS, NO_INSET, type WindowInset } from '@shared/types'

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

  /**
   * Tells the renderer how much of itself is off screen.
   *
   * Windows maximises a frameless window to the work area PLUS the invisible
   * resize border, so roughly eight pixels on every edge end up outside the
   * display: the top of the title bar, and with it the strip you drag the
   * window by, is simply not there to grab. The overflow is measured rather
   * than assumed, because the border is a different thickness at every DPI.
   *
   * This also fires for a maximize by any other route — a double-click on the
   * bar, Win+Up, a snap to the edge.
   */
  // 'resize' fires on every frame of a drag, so the message only goes out when
  // the answer actually changed.
  let last = ''
  const reportState = (): void => {
    // 'resize' can fire while the window is being torn down, and sending to a
    // destroyed webContents throws out of an event handler with nothing to
    // catch it.
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    const maximized = win.isMaximized()
    let inset: WindowInset = NO_INSET
    if (maximized) {
      const bounds = win.getBounds()
      const work = screen.getDisplayMatching(bounds).workArea
      inset = {
        top: Math.max(0, work.y - bounds.y),
        left: Math.max(0, work.x - bounds.x),
        right: Math.max(0, bounds.x + bounds.width - (work.x + work.width)),
        bottom: Math.max(0, bounds.y + bounds.height - (work.y + work.height)),
      }
    }
    const state = { maximized, inset }
    const signature = JSON.stringify(state)
    if (signature === last) return
    last = signature
    win.webContents.send(EVENTS.WINDOW_STATE, state)
  }
  win.on('maximize', reportState)
  win.on('unmaximize', reportState)
  win.on('resize', reportState)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
