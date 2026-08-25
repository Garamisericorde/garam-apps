import { globalShortcut } from 'electron'
import type { Logger } from '@garam/core'
import type { HotkeyStatus } from '@shared/types'

export interface HotkeyBindings {
  hotkeyRegion: string
  hotkeyFullscreen: string
}

export interface HotkeyActions {
  onRegion: () => void
  onFullscreen: () => void
}

/**
 * Global kisayollari yonetir.
 *
 * Windows'ta PrintScreen'i baska bir uygulama (OneDrive, GeForce Experience,
 * Dropbox) daha once kaydettiyse `globalShortcut.register` sessizce false doner.
 * Bu yuzden sonucu takip edip Ayarlar penceresinde uyari gosteriyoruz.
 */
export class HotkeyManager {
  private status: HotkeyStatus = { hotkeyRegion: false, hotkeyFullscreen: false }

  constructor(
    private readonly log: Logger,
    private readonly actions: HotkeyActions,
  ) {}

  /** Onceki kayitlari birakip verilen kisayollari kaydeder. */
  apply(bindings: HotkeyBindings): HotkeyStatus {
    globalShortcut.unregisterAll()

    this.status = {
      hotkeyRegion: this.register(bindings.hotkeyRegion, this.actions.onRegion, 'bolge secimi'),
      hotkeyFullscreen: this.register(
        bindings.hotkeyFullscreen,
        this.actions.onFullscreen,
        'tam ekran',
      ),
    }

    return this.status
  }

  get current(): HotkeyStatus {
    return this.status
  }

  dispose(): void {
    globalShortcut.unregisterAll()
  }

  private register(accelerator: string, handler: () => void, label: string): boolean {
    if (!accelerator.trim()) return false

    try {
      const ok = globalShortcut.register(accelerator, handler)
      if (ok) {
        this.log.info(`Kisayol kaydedildi (${label}): ${accelerator}`)
      } else {
        this.log.warn(
          `Kisayol kaydedilemedi (${label}): ${accelerator} — baska bir uygulama kullaniyor olabilir`,
        )
      }
      return ok
    } catch (err) {
      // Gecersiz accelerator metni exception firlatir.
      this.log.error(`Gecersiz kisayol (${label}): ${accelerator}`, err)
      return false
    }
  }
}
