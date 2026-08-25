import { Menu, Tray, nativeImage, app, shell } from 'electron'
import { resourcePath } from '@garam/core'
import type { Logger } from '@garam/core'

export interface TrayActions {
  onCaptureRegion: () => void
  onCaptureFullscreen: () => void
  onOpenSettings: () => void
  onOpenSaveFolder: () => void
  onQuit: () => void
}

/**
 * Sistem tepsisi simgesi — uygulamanin birincil kontrol yuzeyi.
 * G-Snap penceresiz calisir; ana pencere yok, yalnizca tepsi + kisayollar.
 */
export class TrayController {
  private tray: Tray | null = null

  constructor(
    private readonly log: Logger,
    private readonly actions: TrayActions,
  ) {}

  create(hotkeys: { region: string; fullscreen: string }): void {
    const icon = this.loadIcon()
    this.tray = new Tray(icon)
    this.tray.setToolTip('G-Snap — ekran alintisi')
    this.update(hotkeys)

    // Tepsi simgesine cift tiklama: bolge secimi baslat.
    this.tray.on('double-click', () => this.actions.onCaptureRegion())
  }

  /** Kisayol metinleri degistiginde menuyu yeniden kurar. */
  update(hotkeys: { region: string; fullscreen: string }): void {
    if (!this.tray) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Bolge sec',
        accelerator: hotkeys.region,
        click: () => this.actions.onCaptureRegion(),
      },
      {
        label: 'Tum ekran -> panoya',
        accelerator: hotkeys.fullscreen,
        click: () => this.actions.onCaptureFullscreen(),
      },
      { type: 'separator' },
      { label: 'Kayit klasorunu ac', click: () => this.actions.onOpenSaveFolder() },
      { label: 'Ayarlar...', click: () => this.actions.onOpenSettings() },
      { type: 'separator' },
      { label: `Surum ${app.getVersion()}`, enabled: false },
      { label: 'Cikis', click: () => this.actions.onQuit() },
    ])

    this.tray.setContextMenu(menu)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /**
   * Tepsi simgesini yukler. Dosya yoksa uygulama coker yerine gomulu bir
   * yedek simge kullanilir — paketleme sirasinda ikon unutulmus olabilir.
   */
  private loadIcon(): Electron.NativeImage {
    const path = resourcePath('icons', 'tray.png')
    const image = nativeImage.createFromPath(path)

    if (image.isEmpty()) {
      this.log.warn(`Tepsi simgesi bulunamadi: ${path} — yedek simge kullaniliyor`)
      return nativeImage.createFromDataURL(FALLBACK_ICON)
    }

    return image.resize({ width: 16, height: 16 })
  }
}

/** Kayit klasorunu acar; yoksa olusturur. */
export function openFolder(path: string): Promise<string> {
  return shell.openPath(path)
}

/**
 * 16x16 kirmizi yuvarlak kare PNG — simge dosyasi eksikse gorunur bir yedek.
 * nativeImage SVG data URL'lerini DESTEKLEMEZ, bu yuzden gomulu PNG kullaniliyor.
 */
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42mN46' +
  'ZrAQAlG5vwnEaMY8J9MPGrAqAHDzQCKMxPZGABlU01faub9ewAAAABJRU5ErkJggg=='
