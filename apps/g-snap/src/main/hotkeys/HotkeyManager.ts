import { globalShortcut } from 'electron'
import type { Logger } from '@garam/core'
import type { HotkeyStatus } from '@shared/types'
import { KeyboardHook, parseAccelerator, type HookBinding } from './KeyboardHook.js'

export interface HotkeyBindings {
  hotkeyRegion: string
  hotkeyFullscreen: string
}

export interface HotkeyActions {
  onRegion: () => void
  onFullscreen: () => void
}

/**
 * Manages the global shortcuts.
 *
 * PrintScreen is registered TWICE, on purpose:
 *
 * - A low-level keyboard hook. Electron can register PrintScreen directly, but
 *   Windows then runs its own PrintScreen handling and that blocks this process
 *   for ~530 ms before any of our code runs. The hook swallows the key so that
 *   never starts. See KeyboardHook.ts.
 * - `globalShortcut` as well. Anti-cheat software in games routinely blocks or
 *   strips low-level keyboard hooks to stop macro tools, and then the hook
 *   never fires — the capture simply did not happen, with nothing in the log.
 *   `RegisterHotKey`, which is what globalShortcut uses, is a different
 *   mechanism and can still work there.
 *
 * The two do not collide: when the hook fires it swallows the key, so the OS
 * hotkey never sees it. When the hook is blocked, the key reaches the OS and
 * globalShortcut fires instead. A double trigger would be harmless anyway,
 * since opening an already-open overlay is a no-op.
 *
 * Any other accelerator just uses `globalShortcut`, which has no such tax.
 *
 * If another app (OneDrive, GeForce Experience, Dropbox) already owns a
 * shortcut, `globalShortcut.register` quietly returns false. We track that and
 * surface a warning in the Settings window.
 */
export class HotkeyManager {
  private status: HotkeyStatus = { hotkeyRegion: false, hotkeyFullscreen: false }
  private readonly hook = new KeyboardHook()

  constructor(
    private readonly log: Logger,
    private readonly actions: HotkeyActions,
  ) {}

  /** Releases previous registrations and registers the given shortcuts. */
  apply(bindings: HotkeyBindings): HotkeyStatus {
    globalShortcut.unregisterAll()

    const wanted: Array<{
      accelerator: string
      handler: () => void
      label: string
      key: keyof HotkeyStatus
    }> = [
      {
        accelerator: bindings.hotkeyRegion,
        handler: this.actions.onRegion,
        label: 'region select',
        key: 'hotkeyRegion',
      },
      {
        accelerator: bindings.hotkeyFullscreen,
        handler: this.actions.onFullscreen,
        label: 'full screen',
        key: 'hotkeyFullscreen',
      },
    ]

    const hookBindings: HookBinding[] = []
    const status: HotkeyStatus = { hotkeyRegion: false, hotkeyFullscreen: false }

    for (const item of wanted) {
      if (!item.accelerator.trim()) continue

      const parsed = parseAccelerator(item.accelerator)
      if (parsed) {
        hookBindings.push({ ...parsed, run: item.handler })
        // Also register the OS hotkey as a fallback for contexts where the hook
        // is blocked (anti-cheat). Failure here is not fatal — the hook is the
        // primary path.
        const osOk = this.register(item.accelerator, item.handler, `${item.label}, fallback`)
        status[item.key] = true
        if (!osOk) {
          this.log.debug(`No OS-level fallback for ${item.accelerator}; hook only`)
        }
        continue
      }

      status[item.key] = this.register(item.accelerator, item.handler, item.label)
    }

    if (hookBindings.length > 0) {
      const ok = this.hook.apply(hookBindings)
      if (ok) {
        this.log.info(
          `Keyboard hook active for ${hookBindings.length} PrintScreen shortcut(s) — Windows' own handling is bypassed`,
        )
      } else {
        // The hook is the fast path, not the only path; fall back so the
        // shortcut still works, just with the Windows tax.
        this.log.warn('Keyboard hook could not be installed; the OS hotkey fallback carries it')
      }
    } else {
      this.hook.apply([])
    }

    this.status = status
    return this.status
  }

  get current(): HotkeyStatus {
    return this.status
  }

  dispose(): void {
    globalShortcut.unregisterAll()
    this.hook.dispose()
  }

  private register(accelerator: string, handler: () => void, label: string): boolean {
    try {
      const ok = globalShortcut.register(accelerator, handler)
      if (ok) {
        this.log.info(`Shortcut registered (${label}): ${accelerator}`)
      } else {
        this.log.warn(
          `Could not register shortcut (${label}): ${accelerator} — another app may be using it`,
        )
      }
      return ok
    } catch (err) {
      // An invalid accelerator string throws.
      this.log.error(`Invalid shortcut (${label}): ${accelerator}`, err)
      return false
    }
  }
}
