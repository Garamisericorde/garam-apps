import { app } from 'electron'
import { existsSync } from 'fs'
import { readJson, writeJson } from '@garam/core'
import type { AppSettings } from '../../shared/types'
import { settingsFilePath } from '../../shared/paths'
import { DEFAULT_SETTINGS } from './defaults'
import { mergeWithDefaults, sanitizeSettings, validateSettings } from './schema'
import { logger } from '../logging/logger'

type ChangeListener = (settings: AppSettings, changedKeys: (keyof AppSettings)[]) => void

export class SettingsStore {
  private static instance: SettingsStore

  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private listeners: ChangeListener[] = []

  private constructor() {}

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) SettingsStore.instance = new SettingsStore()
    return SettingsStore.instance
  }

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener)
  }

  async load(): Promise<void> {
    const filePath = settingsFilePath()

    if (!existsSync(filePath)) {
      logger.info('No settings file found, writing the defaults')
      // Written out rather than only held in memory, so the file always shows
      // the full set — a settings file you can open and read is half of why
      // settings live in a file at all.
      await this.persist()
      this.applyStartupPreference()
      return
    }

    try {
      // readJson strips a leading BOM. Windows tools write UTF-8 with one, and
      // a bare JSON.parse throws on it — which silently reset every setting.
      const raw = await readJson<unknown>(filePath, null)
      const { settings, warnings } = sanitizeSettings(raw)

      if (warnings.length > 0) {
        logger.warn('Some settings were invalid and reset to defaults', warnings)
      }

      this.settings = settings

      /*
       * A setting added since this file was written is correct in memory but
       * absent from disk, and stays absent until something unrelated is
       * changed. Writing the merged set back on load keeps the file complete,
       * which matters the moment anyone opens it to see what can be set.
       */
      const missing = Object.keys(settings).filter(
        (key) => !Object.prototype.hasOwnProperty.call(raw ?? {}, key),
      )
      if (missing.length > 0) {
        logger.info('Adding settings that were not in the file yet', missing)
        await this.persist()
      }

      logger.info('Settings loaded', filePath)
    } catch (err) {
      logger.error('Failed to load settings, using defaults', String(err))
    }

    this.applyStartupPreference()
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  async set(partial: Partial<AppSettings>): Promise<AppSettings> {
    const { valid, errors } = validateSettings(partial)
    if (!valid) throw new Error(`Invalid settings: ${errors.join(', ')}`)

    const changedKeys = (Object.keys(partial) as (keyof AppSettings)[]).filter(
      (key) => partial[key] !== undefined && partial[key] !== this.settings[key],
    )
    if (changedKeys.length === 0) return this.get()

    this.settings = mergeWithDefaults({ ...this.settings, ...partial })
    await this.persist()

    // What changed, not just that something did. "Settings saved" on its own
    // cannot answer the one question worth asking of this log — whether the
    // value the user chose is the value that was written.
    logger.info(
      'Settings changed',
      Object.fromEntries(changedKeys.map((key) => [key, this.settings[key]])),
    )

    if (changedKeys.includes('launchOnStartup')) this.applyStartupPreference()

    const snapshot = this.get()
    for (const listener of this.listeners) {
      try {
        listener(snapshot, changedKeys)
      } catch (err) {
        logger.error('Settings change listener threw', String(err))
      }
    }

    return snapshot
  }

  private async persist(): Promise<void> {
    const filePath = settingsFilePath()
    try {
      // Atomic: writes to a temp file, fsyncs, then renames. The previous
      // writeFileSync could leave a truncated settings file if the app died
      // mid-write.
      await writeJson(filePath, this.settings)
      logger.info('Settings saved')
    } catch (err) {
      logger.error('Failed to save settings', String(err))
      throw err
    }
  }

  /** Keep the Windows "run at login" entry in sync with the stored preference */
  private applyStartupPreference(): void {
    if (!app.isPackaged) return // dev builds would register the Electron binary
    try {
      app.setLoginItemSettings({
        openAtLogin: this.settings.launchOnStartup,
        args: ['--hidden'],
      })
    } catch (err) {
      logger.warn('Could not update launch-on-startup setting', String(err))
    }
  }
}
