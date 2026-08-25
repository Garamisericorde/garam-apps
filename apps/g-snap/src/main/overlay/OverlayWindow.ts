import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Logger } from '@garam/core'
import { EVENTS, type OverlayInit } from '@shared/types'
import { captureAllDisplays } from '../capture/ScreenCapture.js'

export interface OverlayDefaults {
  color: string
  thickness: number
  showMagnifier: boolean
}

/**
 * Tum ekranlari kaplayan tek bir cercevesiz pencere acar ve icine dondurulmus
 * ekran goruntusunu cizer — Lightshot'un "ekran donmus" hissi bundan geliyor.
 *
 * Tek pencere (ekran basina bir pencere yerine) tercih edildi: secim birden
 * fazla monitore tasabiliyor ve pencereler arasi durum esitlemesi gerekmiyor.
 */
export class OverlayController {
  private win: BrowserWindow | null = null
  private opening = false
  /** Modal dialog acikken odak kaybi overlay'i kapatmamali. */
  private ignoreBlur = false

  constructor(
    private readonly log: Logger,
    private readonly getDefaults: () => OverlayDefaults,
  ) {}

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  /**
   * Ekrani yakalar, overlay'i acar ve renderer hazir olunca gosterir.
   * Zaten aciksa hicbir sey yapmaz (kisayola arka arkaya basmayi tolere eder).
   */
  async open(): Promise<void> {
    if (this.isOpen || this.opening) {
      this.log.debug('Overlay zaten acik, yeni istek yok sayildi')
      return
    }
    this.opening = true

    try {
      const started = Date.now()
      const { shots, union, diagnostics } = await captureAllDisplays()
      this.log.debug(`Ekran yakalandi: ${shots.length} ekran, ${Date.now() - started} ms`)

      // Bulaniklik teshisi: istenen ve gercekte alinan piksel sayisi ayrilirsa
      // goruntu buyutulur ve yumusar.
      for (const d of diagnostics) {
        const exact =
          d.actualPixels.width === d.wantedPixels.width &&
          d.actualPixels.height === d.wantedPixels.height
        const message =
          `Ekran ${d.displayId}: DIP ${d.dipBounds.width}x${d.dipBounds.height} ` +
          `@${d.scaleFactor}x -> istenen ${d.wantedPixels.width}x${d.wantedPixels.height}, ` +
          `alinan ${d.actualPixels.width}x${d.actualPixels.height}` +
          (d.matchedById ? '' : ' (display_id eslesmedi, sira tahmini)')

        if (exact) this.log.debug(message)
        else this.log.warn(`${message} — OLCU UYUSMUYOR, goruntu bulanik olacak`)
      }

      const win = new BrowserWindow({
        x: union.x,
        y: union.y,
        width: union.width,
        height: union.height,
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
        // Goruntu cizilmeden gosterirsek siyah bir flash olur.
        show: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          // Overlay tam ekran ve kisa omurlu; arka plan kisitlamalari istemiyoruz.
          backgroundThrottling: false,
        },
      })

      this.win = win

      // Gorev cubugunun ustunde kalmasi icin en yuksek pratik seviye.
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      // Windows pencere olustururken bounds'u bazen ayarliyor; kesinlestirelim.
      win.setBounds({ x: union.x, y: union.y, width: union.width, height: union.height })

      const payload: OverlayInit = { shots, union, defaults: this.getDefaults() }

      win.webContents.once('did-finish-load', () => {
        win.webContents.send(EVENTS.OVERLAY_INIT, payload)
      })

      win.on('closed', () => {
        this.win = null
      })

      // Odak kaybinda kapat: kullanici Alt+Tab yaparsa overlay asili kalmasin.
      // Kaydetme dialogu da odagi aldigi icin modal sirasinda bastiriliyor,
      // gelistirmede ise DevTools'a gecince kapanmasin diye tamamen kapali.
      win.on('blur', () => {
        if (this.ignoreBlur || is.dev) return
        if (!win.isDestroyed()) this.close()
      })

      await this.load(win)
    } catch (err) {
      this.log.error('Overlay acilamadi', err)
      this.close()
      throw err
    } finally {
      this.opening = false
    }
  }

  /** Renderer cizimi bitirdiginde cagrilir; pencereyi gorunur yapar. */
  markReady(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return

    win.show()
    win.focus()
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  close(): void {
    const win = this.win
    this.win = null
    this.ignoreBlur = false
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }

  /**
   * Kaydetme dialogu gibi modal bir pencere acilirken cagrilir.
   * Acikken overlay odak kaybi yuzunden kapanmaz.
   */
  async withModal<T>(fn: () => Promise<T>): Promise<T> {
    this.ignoreBlur = true
    try {
      return await fn()
    } finally {
      this.ignoreBlur = false
    }
  }

  /** Overlay penceresini dondurur — IPC olaylarinin kaynagini dogrulamak icin. */
  get window(): BrowserWindow | null {
    return this.win
  }

  private load(win: BrowserWindow): Promise<void> {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
    }
    return win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }
}

/** Imlecin uzerinde bulundugu ekranin kimligi — tam ekran yakalama icin. */
export function activeDisplayId(): number {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
}
