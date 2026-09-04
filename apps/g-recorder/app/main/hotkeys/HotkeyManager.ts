import { globalShortcut } from 'electron'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'
import type { HotkeyFailure } from '../../shared/types'

export interface HotkeyActions {
  saveReplay: () => void
  recordToFile: () => void
  toggleRecording: () => void
}

export interface HotkeyRegistrationResult {
  saveReplay: boolean
  toggleRecording: boolean
  recordToFile: boolean
  /**
   * Accelerators that did not take, with the reason.
   *
   * The two causes need different advice: 'taken' means another app owns the
   * combination, 'invalid' means the string itself is not a legal accelerator.
   * Reporting both as a conflict sent users hunting for an app that was not
   * there.
   */
  failed: HotkeyFailure[]
}



export class HotkeyManager {
  private lastResult: HotkeyRegistrationResult = {
    saveReplay: false,
    toggleRecording: false,
    recordToFile: false,
    failed: [],
  }

  /** Why the most recent registration attempt failed. */
  private lastReason: 'taken' | 'invalid' = 'taken'

  constructor(private readonly actions: HotkeyActions) {}

  register(): HotkeyRegistrationResult {
    this.unregister()

    const { hotkeySaveReplay, hotkeyToggleRecording, hotkeyRecordToFile } =
      SettingsStore.getInstance().get()

    const saveReplay = this.tryRegister(hotkeySaveReplay, this.actions.saveReplay)
    const toggleRecording = this.tryRegister(hotkeyToggleRecording, this.actions.toggleRecording)
    const recordToFile = this.tryRegister(hotkeyRecordToFile, this.actions.recordToFile)

    const failed: HotkeyFailure[] = []
    if (!saveReplay) failed.push({ accelerator: hotkeySaveReplay, reason: this.lastReason })
    if (!toggleRecording) {
      failed.push({ accelerator: hotkeyToggleRecording, reason: this.lastReason })
    }
    if (!recordToFile) {
      failed.push({ accelerator: hotkeyRecordToFile, reason: this.lastReason })
    }

    this.lastResult = { saveReplay, toggleRecording, recordToFile, failed }
    logger.info('Hotkeys registered', {
      saveReplay: `${hotkeySaveReplay} ok=${saveReplay}`,
      toggleRecording: `${hotkeyToggleRecording} ok=${toggleRecording}`,
      recordToFile: `${hotkeyRecordToFile} ok=${recordToFile}`,
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
      const ok = globalShortcut.register(accelerator, handler)
      this.lastReason = 'taken'
      return ok
    } catch (err) {
      // A malformed accelerator throws; an accelerator another app owns does not.
      this.lastReason = 'invalid'
      logger.warn(`Invalid hotkey "${accelerator}"`, String(err))
      return false
    }
  }
}
