import { isHeld, parseBinding } from '../../shared/gamepad'
import { MAX_PADS, readPad, xinputAvailable } from '../native/xinput'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'
import type { HotkeyActions } from './HotkeyManager'

/**
 * How often the pads are read while a binding is armed.
 *
 * 60 Hz: fast enough that a chord held for a fifth of a second cannot be
 * missed, slow enough to be free. Each read is a driver-state copy measured in
 * microseconds, and only slots known to hold a pad are read at this rate.
 */
const POLL_MS = 16

/**
 * How often an empty slot is checked for a pad that has just been plugged in.
 *
 * Separate and slow on purpose: XInputGetState on an EMPTY slot is the one
 * expensive call in this API — historically about a millisecond, because it
 * goes looking for hardware. Four of those at 60 Hz would be a background app
 * burning a core for nothing.
 */
const RESCAN_MS = 2000

type ActionName = keyof HotkeyActions

interface Binding {
  action: ActionName
  mask: number
}

/**
 * Controller shortcuts.
 *
 * These exist because the keyboard is not where your hands are. Saving a replay
 * mid-fight means reaching for Alt+F10 with a pad in both hands, by which time
 * the thing worth keeping has scrolled out of the buffer.
 *
 * Nothing runs unless a binding is set: with none configured the poll never
 * starts, and the app costs exactly what it did before.
 */
export class GamepadHotkeys {
  private timer: NodeJS.Timeout | null = null
  private rescanAt = 0
  private bindings: Binding[] = []

  /** Slots known to hold a pad, so empty ones are not read at poll rate */
  private connected = new Set<number>()

  /** Bindings currently held, so a chord fires once rather than 60 times a second */
  private firing = new Set<string>()

  /** Set while Settings is listening for a combination to bind */
  private capture: ((mask: number) => void) | null = null
  private captureHeld = 0

  constructor(private readonly actions: HotkeyActions) {}

  /** Re-read the settings and start or stop polling to match */
  register(): void {
    const settings = SettingsStore.getInstance().get()
    const wanted: [ActionName, string | null][] = [
      ['saveReplay', settings.padSaveReplay],
      ['toggleRecording', settings.padToggleRecording],
      ['recordToFile', settings.padRecordToFile],
    ]

    this.bindings = []
    for (const [action, binding] of wanted) {
      const mask = parseBinding(binding)
      if (mask !== null) this.bindings.push({ action, mask })
    }

    this.firing.clear()
    this.sync()

    if (this.bindings.length > 0) {
      logger.info('Controller shortcuts armed', {
        count: this.bindings.length,
        xinput: xinputAvailable(),
      })
    }
  }

  /**
   * Listen for a combination and report it once it is released.
   *
   * Resolving on release, with the union of everything held during the press,
   * is what makes a chord bindable at all: a callback that fired on the first
   * button down could only ever capture one.
   */
  beginCapture(onCaptured: (mask: number) => void): void {
    this.capture = onCaptured
    this.captureHeld = 0
    this.sync()
  }

  cancelCapture(): void {
    this.capture = null
    this.captureHeld = 0
    this.sync()
  }

  /** What is held right now, for the live preview while binding */
  heldMask(): number {
    return this.captureHeld
  }

  available(): boolean {
    return xinputAvailable()
  }

  /** Whether a pad has actually answered, which is what users want to know */
  padConnected(): boolean {
    return this.connected.size > 0
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Poll only while there is something to poll for */
  private sync(): void {
    const needed = this.bindings.length > 0 || this.capture !== null
    if (needed && !this.timer) {
      this.rescanAt = 0
      this.timer = setInterval(() => this.poll(), POLL_MS)
      this.timer.unref?.()
    } else if (!needed) {
      this.stop()
    }
  }

  private poll(): void {
    const now = Date.now()
    if (now >= this.rescanAt) {
      this.rescanAt = now + RESCAN_MS
      for (let index = 0; index < MAX_PADS; index += 1) {
        if (readPad(index) === null) this.connected.delete(index)
        else this.connected.add(index)
      }
    }

    for (const index of [...this.connected]) {
      const mask = readPad(index)
      if (mask === null) {
        this.connected.delete(index)
        continue
      }

      if (this.capture) {
        this.trackCapture(mask)
        continue
      }

      this.fireMatches(index, mask)
    }
  }

  /** Gather buttons while they go down; report the set once all are released */
  private trackCapture(mask: number): void {
    if (mask !== 0) {
      this.captureHeld |= mask
      return
    }

    if (this.captureHeld === 0) return

    const captured = this.captureHeld
    const report = this.capture
    this.capture = null
    this.captureHeld = 0
    this.sync()
    report?.(captured)
  }

  private fireMatches(index: number, mask: number): void {
    for (const { action, mask: binding } of this.bindings) {
      const key = `${index}:${binding}`
      const held = isHeld(mask, binding)

      if (!held) {
        this.firing.delete(key)
        continue
      }
      // Already counted; a chord held down is one press, not a stream of them.
      if (this.firing.has(key)) continue

      this.firing.add(key)
      logger.info('Controller shortcut fired', { action, pad: index })
      try {
        this.actions[action]()
      } catch (err) {
        logger.warn(`Controller shortcut "${action}" failed`, String(err))
      }
    }
  }
}
