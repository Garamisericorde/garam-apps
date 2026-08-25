import { globalShortcut } from 'electron'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'

export interface HotkeyActions {
  saveReplay: () => void
  toggleRecording: () => void
}

export interface HotkeyRegistrationResult {
  saveReplay: boolean
  toggleRecording: boolean
  /** Accelerators Windows refused, usually because another app owns them */
  failed: string[]
}

export class HotkeyManager {
  private lastResult: HotkeyRegistrationResult = {
    saveReplay: false,
    toggleRecording: false,
    failed: [],
  }

  constructor(private readonly actions: HotkeyActions) {}

  register(): HotkeyRegistrationResult {
    this.unregister()

    const { hotkeySaveReplay, hotkeyToggleRecording } = SettingsStore.getInstance().get()

    const saveReplay = this.tryRegister(hotkeySaveReplay, this.actions.saveReplay)
    const toggleRecording = this.tryRegister(hotkeyToggleRecording, this.actions.toggleRecording)

    const failed: string[] = []
    if (!saveReplay) failed.push(hotkeySaveReplay)
    if (!toggleRecording) failed.push(hotkeyToggleRecording)

    this.lastResult = { saveReplay, toggleRecording, failed }
    logger.info('Hotkeys registered', {
      saveReplay: `${hotkeySaveReplay} ok=${saveReplay}`,
      toggleRecording: `${hotkeyToggleRecording} ok=${toggleRecording}`,
    })

    return this.lastResult
  }

  getLastResult(): HotkeyRegistrationResult {
    return { ...this.lastResult }
  }

  unregister(): void {
    globalShortcut.unregisterAll()
  }

  /**
   * `globalShortcut.register` throws on a malformed accelerator and returns
   * false when another application already owns the combination.
   */
  private tryRegister(accelerator: string, handler: () => void): boolean {
    try {
      return globalShortcut.register(accelerator, handler)
    } catch (err) {
      logger.warn(`Invalid hotkey "${accelerator}"`, String(err))
      return false
    }
  }
}
