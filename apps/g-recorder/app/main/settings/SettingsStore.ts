import { app } from 'electron'
import { dirname } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
      logger.info('No settings file found, using defaults')
      this.applyStartupPreference()
      return
    }

    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const { settings, warnings } = sanitizeSettings(raw)

      if (warnings.length > 0) {
        logger.warn('Some settings were invalid and reset to defaults', warnings)
      }

      this.settings = settings
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
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(this.settings, null, 2), 'utf8')
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
