import { t } from '@shared/i18n/index.js'
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
 * System tray icon — the app's primary control surface.
 * G-Snap runs windowless: there is no main window, only the tray and hotkeys.
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
    this.tray.setToolTip(t('tray.tooltip'))
    this.update(hotkeys)

    // Double-clicking the tray icon starts a region selection.
    this.tray.on('double-click', () => this.actions.onCaptureRegion())
  }

  /** Rebuilds the menu when the shortcut labels change. */
  update(hotkeys: { region: string; fullscreen: string }): void {
    if (!this.tray) return

    const menu = Menu.buildFromTemplate([
      {
        label: t('tray.selectRegion'),
        accelerator: hotkeys.region,
        click: () => this.actions.onCaptureRegion(),
      },
      {
        label: t('tray.fullScreen'),
        accelerator: hotkeys.fullscreen,
        click: () => this.actions.onCaptureFullscreen(),
      },
      { type: 'separator' },
      { label: t('tray.openSaveFolder'), click: () => this.actions.onOpenSaveFolder() },
      { label: t('tray.settings'), click: () => this.actions.onOpenSettings() },
      { type: 'separator' },
      { label: t('tray.version', { version: app.getVersion() }), enabled: false },
      { label: t('tray.quit'), click: () => this.actions.onQuit() },
    ])

    this.tray.setContextMenu(menu)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  /**
   * Loads the tray icon. If the file is missing we fall back to an embedded one
   * rather than crashing — the icon may simply not have been generated yet.
   */
  private loadIcon(): Electron.NativeImage {
    const path = resourcePath('icons', 'tray.png')
    const image = nativeImage.createFromPath(path)

    if (image.isEmpty()) {
      this.log.warn(`Tray icon not found at ${path} — using the embedded fallback`)
      return nativeImage.createFromDataURL(FALLBACK_ICON)
    }

    return image.resize({ width: 16, height: 16 })
  }
}

/** Opens the save folder, creating it if it does not exist yet. */
export function openFolder(path: string): Promise<string> {
  return shell.openPath(path)
}

/**
 * 16x16 rounded red square, used when the icon file is missing.
 * nativeImage does NOT support SVG data URLs, hence an embedded PNG.
 */
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42mN46' +
  'ZrAQAlG5vwnEaMY8J9MPGrAqAHDzQCKMxPZGABlU01faub9ewAAAABJRU5ErkJggg=='
