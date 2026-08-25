import { app } from 'electron'
import { join } from 'node:path'
import { palette } from '@garam/theme'
import type { SnapSettings } from '@shared/types'

/**
 * Varsayilan ayarlar. Buradaki anahtar kumesi ayni zamanda gecerli ayar
 * semasini tanimlar — SettingsStore bilinmeyen anahtarlari diskten okurken atar.
 */
export function createDefaults(): SnapSettings {
  return {
    // PrintScreen'i global olarak yakalamak Windows'ta calisir; baska bir
    // uygulama (OneDrive, GeForce Experience) kapmissa kayit basarisiz olur ve
    // Ayarlar penceresinde uyari gosterilir.
    hotkeyRegion: 'PrintScreen',
    hotkeyFullscreen: 'Ctrl+PrintScreen',

    saveDirectory: join(app.getPath('pictures'), 'G-Snap'),
    fileNameTemplate: 'g-snap_{YYYY}-{MM}-{DD}_{HH}{mm}{ss}',
    imageFormat: 'png',
    jpegQuality: 90,

    copyToClipboard: true,
    askWhereToSave: true,

    showMagnifier: true,
    launchAtStartup: false,

    defaultColor: palette.accent,
    defaultThickness: 3,
  }
}

export const SETTINGS_VERSION = 1
