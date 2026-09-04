import { ipcMain } from 'electron'
import { formatBinding } from '../../shared/gamepad'
import type { GamepadHotkeys } from '../hotkeys/GamepadHotkeys'
import type { PadStatus } from '../../shared/types'
import { ffiFailure } from '../native/ffi'
import { broadcast } from './broadcast'

/** How often the live preview is sent while a combination is being bound */
const PREVIEW_MS = 60

/**
 * Binding a controller combination.
 *
 * The capture runs in the main process rather than the renderer for the same
 * reason the shortcuts do: Chromium only reports pads to a focused document,
 * and even here the window is focused only while the field is open. Reading it
 * through XInput keeps one code path for binding and for firing.
 */
export function registerGamepadIpc(getPad: () => GamepadHotkeys | null): void {
  let preview: NodeJS.Timeout | null = null

  const stopPreview = (): void => {
    if (preview) clearInterval(preview)
    preview = null
  }

  ipcMain.handle('gamepad:status', (): PadStatus => {
    const pad = getPad()
    return {
      available: pad?.available() ?? false,
      connected: pad?.padConnected() ?? false,
      reason: ffiFailure(),
    }
  })

  /**
   * Resolves with the combination once every button is released, or null if
   * the capture is cancelled first. The buttons held are broadcast meanwhile so
   * the field can show them going down.
   */
  ipcMain.handle('gamepad:capture', async (): Promise<string | null> => {
    const pad = getPad()
    if (!pad) return null

    return new Promise<string | null>((resolve) => {
      let settled = false

      stopPreview()
      preview = setInterval(() => {
        broadcast('gamepad:held', formatBinding(pad.heldMask()))
      }, PREVIEW_MS)
      preview.unref?.()

      pad.beginCapture((mask) => {
        if (settled) return
        settled = true
        stopPreview()
        resolve(formatBinding(mask))
      })

      // A cancel from the renderer ends the same promise, so the field is
      // never left waiting on a capture nobody is watching.
      ipcMain.once('gamepad:cancelCapture', () => {
        if (settled) return
        settled = true
        stopPreview()
        pad.cancelCapture()
        resolve(null)
      })
    })
  })

  ipcMain.on('gamepad:cancelCapture', () => {
    // Handled by the once() above while a capture is running; this keeps a
    // stray cancel from piling up an unhandled channel warning.
  })
}
