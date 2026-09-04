import { app } from 'electron'
import { join } from 'node:path'
import { palette } from '@garam/theme'
import type { SnapSettings } from '@shared/types'
import { DEFAULT_LOCALE } from '@shared/i18n/index.js'

/**
 * Default settings. This key set also defines the valid schema — SettingsStore
 * drops any unknown key it reads from disk.
 */
export function createDefaults(): SnapSettings {
  return {
    // English by default, not the system locale: the app ships in nine
    // languages but a wrong guess is worse than a predictable default, and the
    // picker is the first row in Settings.
    language: DEFAULT_LOCALE,

    // Capturing PrintScreen globally works on Windows, but if another app
    // (OneDrive, GeForce Experience) already grabbed it the registration
    // fails and Settings shows a warning.
    hotkeyRegion: 'PrintScreen',
    hotkeyFullscreen: 'Ctrl+PrintScreen',

    saveDirectory: join(app.getPath('pictures'), 'G-Snap'),
    fileNameTemplate: 'g-snap_{YYYY}-{MM}-{DD}_{HH}{mm}{ss}',
    imageFormat: 'png',
    jpegQuality: 90,

    copyToClipboard: true,
    askWhereToSave: true,

    launchAtStartup: true,

    defaultColor: palette.accent,
    defaultThickness: 3,
  }
}

export const SETTINGS_VERSION = 1
