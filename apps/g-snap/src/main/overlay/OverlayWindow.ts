import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Logger } from '@garam/core'
import { resourcePath } from '@garam/core'
import { EVENTS, type OverlayInit } from '@shared/types'
import { getLocale } from '@shared/i18n/index.js'
import {
  blankShots,
  captureAllDisplays,
  lastGdiError,
  setOverlayHwnd,
} from '../capture/ScreenCapture.js'
import {
  currentForeground,
  disableWindowAnimations,
  forceForeground,
  nativeHandleOf,
  restoreForeground,
} from './WindowFocus.js'

/** Blur events within this window of a reveal are focus churn, not the user leaving. */
const REVEAL_GRACE_MS = 700
/** How long to wait before believing a blur. */
const BLUR_CONFIRM_MS = 150

export interface OverlayDefaults {
  color: string
  thickness: number
}

/**
 * One frameless window spanning every display, painted with the frozen
 * screenshot — that is where the "screen froze" feel comes from.
 *
 * A single window (rather than one per display) was chosen because a selection
 * can then cross monitors and there is no cross-window state to keep in sync.
 *
 * The window is created ONCE at startup and hidden between captures. Building a
 * full-screen BrowserWindow and loading the renderer costs a few hundred
 * milliseconds, and a screenshot tool that lags behind the hotkey feels broken,
 * so that cost is paid before the user ever presses anything.
 */
export class OverlayController {
  private win: BrowserWindow | null = null
  private loaded: Promise<void> | null = null
  /** Set once the renderer has loaded, so the hotkey path can skip the await. */
  private isLoaded = false
  private visible = false
  private opening = false
  /** Timestamp of the hotkey press, so the visible latency can be logged. */
  private openedAt = 0
  /** Whatever had the foreground before we took it, so it can be handed back. */
  private previousForeground: bigint | null = null
  /** When the overlay was last revealed, used to ignore focus churn. */
  private revealedAt = 0
  /**
   * Cursor sent with the last init, logged on reveal.
   *
   * The readout reappearing at the previous capture's position has now been
   * chased twice. This line settles the next round without guessing: if it
   * matches where the box actually appeared, the state was right and the
   * window's painted surface is at fault; if it does not, the arithmetic is.
   */
  private lastCursor = { x: 0, y: 0 }
  /** Pending confirmation that a blur is real and not a transient. */
  private blurTimer: NodeJS.Timeout | null = null
  /** While a modal dialog is up, losing focus must not close the overlay. */
  private ignoreBlur = false

  constructor(
    private readonly log: Logger,
    private readonly getDefaults: () => OverlayDefaults,
  ) {}

  get isOpen(): boolean {
    return this.visible
  }

  /**
   * Builds the hidden window and loads the renderer. Safe to call at startup;
   * nothing is shown until `open()`.
   */
  prewarm(): void {
    if (this.win && !this.win.isDestroyed()) return

    const win = new BrowserWindow({
      width: 800,
      height: 600,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      icon: resourcePath('icons', 'icon.png'),
      // Created fully transparent rather than hidden: Chromium produces no
      // frames for a hidden window, so the first show displayed an unpainted
      // (white) surface. At opacity 0 it keeps rendering and the first real
      // capture is already on screen the moment opacity goes to 1.
      show: false,
      opacity: 0,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // The overlay is short-lived and must paint instantly when shown.
        backgroundThrottling: false,
      },
    })

    this.win = win

    // Do this once, up front: otherwise the first reveal fades in instead of
    // snapping open.
    if (!disableWindowAnimations(win)) {
      this.log.debug('Could not disable window transitions (non-fatal)')
    }

    // The overlay is always-on-top and screen-sized, so without this the
    // full-screen-app detector would see it and route every capture down the
    // slow path.
    setOverlayHwnd(nativeHandleOf(win))

    win.on('closed', () => {
      this.win = null
      this.loaded = null
      this.visible = false
    })

    // Close on focus loss so Alt+Tab does not leave the overlay stuck on top.
    // Suppressed while a modal dialog is up, and in development so switching to
    // DevTools is safe.
    //
    // Taking the foreground is not atomic: `forceForeground` hands focus around
    // between threads, and Windows delivers a transient blur in the middle of
    // it. Acting on that closed the overlay the instant it appeared — which
    // only showed in a packaged build, because `is.dev` hid it in development.
    // So a blur has to survive a grace period AND still be true a moment later.
    win.on('blur', () => {
      if (this.ignoreBlur || is.dev || !this.visible) return

      const sinceReveal = Date.now() - this.revealedAt
      if (sinceReveal < REVEAL_GRACE_MS) {
        this.log.debug(`Ignoring blur ${sinceReveal} ms after reveal (focus still settling)`)
        return
      }

      if (this.blurTimer) clearTimeout(this.blurTimer)
      this.blurTimer = setTimeout(() => {
        this.blurTimer = null
        // Re-check: a blur followed straight back by focus is not a real one.
        if (!this.visible || win.isDestroyed() || win.isFocused()) return
        this.close('focus lost')
      }, BLUR_CONFIRM_MS)
    })

    this.isLoaded = false
    this.loaded = this.load(win)
    this.loaded
      .then(() => {
        this.isLoaded = true
        if (win.isDestroyed()) return
        // Make it a live, painting surface: on screen, fully transparent and
        // click-through so it cannot affect anything the user does.
        win.setIgnoreMouseEvents(true)
        win.setOpacity(0)
        win.showInactive()
        win.setSkipTaskbar(true)
        this.warmRenderer(win)
      })
      .catch((err) => this.log.error('Overlay renderer failed to load', err))
  }

  /**
   * Pushes one blank frame through the whole render path, at opacity 0.
   *
   * Loading the page is not the same as having rendered anything. Measured on
   * this machine the first capture took 302 ms against 116 ms for every one
   * after it, and almost none of that gap is the screen grab: `require('koffi')`
   * costs 94 ms (already paid at startup) and the first BitBlt only ~8 ms more
   * than a warm one. The rest is renderer-side and one-off — the BGRA swap,
   * `createImageBitmap`, Konva building its stage, the first paint.
   *
   * So pay it here, at startup, where nobody is waiting. The frame is blank and
   * discarded as soon as it has been drawn, so no screenshot is taken and no
   * pixels are held.
   */
  private warmRenderer(win: BrowserWindow): void {
    try {
      const { shots, union } = blankShots()
      const payload: OverlayInit = {
        shots,
        union,
        cursor: { x: 0, y: 0 },
        defaults: this.getDefaults(),
        language: getLocale(),
        warmup: true,
      }
      const started = Date.now()
      win.webContents.send(EVENTS.OVERLAY_INIT, payload)
      this.log.debug(`Renderer warm-up frame sent in ${Date.now() - started} ms`)
    } catch (err) {
      // A cold first capture is a slow app, not a broken one.
      this.log.warn(`Could not warm the renderer: ${err instanceof Error ? err.message : err}`)
    }
  }

  /**
   * Captures the screen and shows the overlay. Does nothing if already visible,
   * which makes repeated hotkey presses harmless.
   */
  async open(source = 'hotkey'): Promise<void> {
    if (this.visible || this.opening) {
      this.log.debug('Overlay already open, ignoring request')
      return
    }
    this.opening = true
    this.openedAt = Date.now()
    // Remember this BEFORE the overlay takes over, so focus can be returned.
    this.previousForeground = currentForeground()

    try {
      // If prewarm never ran (or the window died), build it now.
      const tPrewarm = Date.now()
      this.prewarm()
      const win = this.win
      if (!win || win.isDestroyed()) throw new Error('Overlay window unavailable')

      // Measure a bare microtask hop: if THIS is slow, the main process event
      // loop is stalling (GC, compositor work) rather than the page loading.
      const tTick = Date.now()
      await Promise.resolve()
      const tickMs = Date.now() - tTick

      const tLoaded = Date.now()
      // Skip the await entirely once the renderer is up — the common case.
      if (!this.isLoaded) await this.loaded
      const tAfterLoaded = Date.now()

      const mem = process.memoryUsage()
      this.log.debug(
        `open() via ${source}: prewarm=${tLoaded - tPrewarm - tickMs}ms tick=${tickMs}ms ` +
          `awaitLoaded=${tAfterLoaded - tLoaded}ms ` +
          `heap=${(mem.heapUsed / 1048576).toFixed(0)}MB external=${(mem.external / 1048576).toFixed(0)}MB`,
      )

      const started = Date.now()
      const { shots, union, diagnostics } = await captureAllDisplays()
      this.log.debug(`Screen captured: ${shots.length} display(s), ${Date.now() - started} ms`)
      if (lastGdiError) this.log.warn(`GDI capture unavailable: ${lastGdiError}`)

      for (const d of diagnostics) {
        const exact =
          d.actualPixels.width === d.wantedPixels.width &&
          d.actualPixels.height === d.wantedPixels.height
        const message =
          `[${d.engine}] Display ${d.displayId}: DIP ${d.dipBounds.width}x${d.dipBounds.height} ` +
          `@${d.scaleFactor}x -> wanted ${d.wantedPixels.width}x${d.wantedPixels.height}, ` +
          `got ${d.actualPixels.width}x${d.actualPixels.height}` +
          (d.matchedById ? '' : ' (display_id did not match, guessed by index)')

        if (exact) this.log.debug(message)
        else this.log.warn(`${message} — SIZE MISMATCH, the image will look blurry`)
      }

      // Position over every display before showing.
      win.setBounds({ x: union.x, y: union.y, width: union.width, height: union.height })

      // The window is reused, so its React state survives the last capture.
      // Nothing in the page can know where the pointer is until it moves, so
      // the position has to come from here.
      const point = screen.getCursorScreenPoint()
      this.lastCursor = { x: point.x - union.x, y: point.y - union.y }
      const payload: OverlayInit = {
        shots,
        union,
        cursor: { x: point.x - union.x, y: point.y - union.y },
        defaults: this.getDefaults(),
        language: getLocale(),
      }
      const tSend = Date.now()
      win.webContents.send(EVENTS.OVERLAY_INIT, payload)
      this.log.debug(`IPC send of ${(shots.reduce((n, s2) => n + s2.pixels.byteLength, 0) / 1048576).toFixed(1)}MB took ${Date.now() - tSend}ms`)

      // The renderer calls markReady() once it has painted.
    } catch (err) {
      this.log.error('Could not open the overlay', err)
      this.close('open failed')
      throw err
    } finally {
      this.opening = false
    }
  }

  /** Called once the renderer has painted; makes the window visible. */
  markReady(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return

    this.visible = true
    this.revealedAt = Date.now()

    // Set the level BEFORE revealing, so the window never appears at the wrong
    // z-order for a frame.
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setIgnoreMouseEvents(false)
    win.setOpacity(1)
    if (!win.isVisible()) win.show()

    // A tray app is not the foreground process, so Electron's focus() alone is
    // refused by Windows and the overlay opens without keyboard focus — Esc
    // then does nothing while right-click still works.
    win.focus()
    forceForeground(win)
    win.webContents.focus()

    if (this.openedAt) {
      this.log.info(
        `Overlay visible in ${Date.now() - this.openedAt} ms ` +
          `(cursor sent: ${this.lastCursor.x},${this.lastCursor.y})`,
      )
      this.openedAt = 0
    }
  }

  /**
   * Puts the overlay away.
   *
   * Goes transparent and click-through rather than hiding: a hidden window
   * stops being painted, and the next capture would then flash an empty
   * surface before its first frame lands.
   */
  close(reason = 'unspecified'): void {
    if (this.visible) this.log.debug(`Overlay closing (${reason})`)
    const win = this.win
    this.visible = false
    this.ignoreBlur = false
    if (this.blurTimer) {
      clearTimeout(this.blurTimer)
      this.blurTimer = null
    }
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(false)
      win.setOpacity(0)
      win.setIgnoreMouseEvents(true)
      // Leave nothing on the surface: see EVENTS.OVERLAY_CLEAR.
      win.webContents.send(EVENTS.OVERLAY_CLEAR)
    }

    // Give the foreground back. Without this the previous app keeps drawing but
    // receives no keyboard input until the user clicks it.
    if (this.previousForeground !== null) {
      restoreForeground(this.previousForeground)
      this.previousForeground = null
    }
  }

  /** Tears the window down for good (app shutdown). */
  destroy(): void {
    const win = this.win
    this.win = null
    this.loaded = null
    this.visible = false
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** The overlay window — used to verify the source of IPC events. */
  get window(): BrowserWindow | null {
    return this.win
  }

  /**
   * Wraps a modal dialog (such as Save As) so the overlay is not torn down by
   * the focus loss the dialog causes.
   */
  async withModal<T>(fn: () => Promise<T>): Promise<T> {
    this.ignoreBlur = true
    try {
      return await fn()
    } finally {
      this.ignoreBlur = false
    }
  }

  private load(win: BrowserWindow): Promise<void> {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
    }
    return win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }
}

/** Id of the display under the cursor — used by the full-screen capture. */
export function activeDisplayId(): number {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
}
