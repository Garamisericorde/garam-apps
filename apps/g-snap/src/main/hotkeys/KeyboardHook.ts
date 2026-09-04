import { lazyBindings } from '../native/ffi.js'

/**
 * Low-level keyboard hook (WH_KEYBOARD_LL) for the PrintScreen key.
 *
 * WHY NOT `globalShortcut`: registering PrintScreen through Electron works, but
 * Windows still runs its own PrintScreen handling, and that measurably blocks
 * this process. Measured on a 2560x1440 screen: a capture triggered from the
 * tray reaches a bare `await Promise.resolve()` in 0 ms, while the identical
 * capture triggered by PrintScreen takes 532 ms to get there. Half a second of
 * dead time before any of our own work starts.
 *
 * A low-level hook sees the key first and can SWALLOW it by returning 1, so
 * Windows never starts that work. This is what native screenshot tools do.
 *
 * PRIVACY: this hook is called for every keystroke on the system. The callback
 * below reads only `vkCode`, and forwards anything that is not PrintScreen
 * straight to the next hook. Nothing is stored, logged or transmitted.
 *
 * TIMING: Windows drops a hook whose callback exceeds LowLevelHooksTimeout
 * (300 ms by default), so the callback only checks a key code and defers the
 * real work with `setImmediate`.
 */

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_SYSKEYDOWN = 0x0104
const HC_ACTION = 0

export const VK = {
  SNAPSHOT: 0x2c,
  CONTROL: 0x11,
  SHIFT: 0x10,
  MENU: 0x12, // Alt
} as const

/**
 * Built on first use, not at import. See ../native/ffi.ts — an eager load here
 * took the whole app down when the native module was missing.
 */
const win32 = lazyBindings((koffi) => {
  const user32 = koffi.load('user32.dll')

  koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32_t',
    scanCode: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  })

  const HookProc = koffi.proto(
    'intptr_t HookProc(int nCode, uintptr_t wParam, KBDLLHOOKSTRUCT *lParam)',
  )

  return {
    koffi,
    HookProc,
    SetWindowsHookExW: user32.func(
      'void* SetWindowsHookExW(int idHook, HookProc *lpfn, void *hmod, uint32_t dwThreadId)',
    ),
    UnhookWindowsHookEx: user32.func('int UnhookWindowsHookEx(void *hhk)'),
    CallNextHookEx: user32.func(
      'intptr_t CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, KBDLLHOOKSTRUCT *lParam)',
    ),
    GetAsyncKeyState: user32.func('int16_t GetAsyncKeyState(int vKey)'),
  }
})

type Win32 = NonNullable<ReturnType<typeof win32>>

function isDown(api: Win32, vk: number): boolean {
  return (api.GetAsyncKeyState(vk) & 0x8000) !== 0
}

export interface HookBinding {
  /** Virtual key code to match. */
  vk: number
  ctrl: boolean
  shift: boolean
  alt: boolean
  run: () => void
}

/**
 * Installs a single system-wide hook and dispatches to the given bindings.
 * Only keys named by a binding are swallowed; everything else passes through.
 */
export class KeyboardHook {
  private handle: unknown = null
  /** Held so the JS callback is not garbage collected while native code owns it. */
  private callback: unknown = null
  private bindings: HookBinding[] = []

  get installed(): boolean {
    return this.handle !== null
  }

  /** Replaces the current bindings. Installs the hook on first use. */
  apply(bindings: HookBinding[]): boolean {
    this.bindings = bindings

    if (bindings.length === 0) {
      this.dispose()
      return true
    }
    if (this.handle) return true

    // No FFI: the caller falls back to globalShortcut, which still works — it
    // just pays the Windows PrintScreen tax this hook exists to avoid.
    const api = win32()
    if (!api) return false

    try {
      this.callback = api.koffi.register((nCode: number, wParam: number, lParam: unknown) => {
        if (nCode === HC_ACTION && (wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN)) {
          const info = api.koffi.decode(lParam, 'KBDLLHOOKSTRUCT') as { vkCode: number }
          const match = this.match(api, info.vkCode)
          if (match) {
            // Defer: the hook must return immediately or Windows unhooks us.
            setImmediate(() => {
              try {
                match.run()
              } catch {
                // A handler must never take the hook down.
              }
            })
            return 1 // swallow, so Windows never runs its own PrintScreen work
          }
        }
        return api.CallNextHookEx(null, nCode, wParam, lParam)
      }, api.koffi.pointer(api.HookProc))

      this.handle = api.SetWindowsHookExW(WH_KEYBOARD_LL, this.callback, null, 0)
      if (!this.handle) {
        this.callback = null
        return false
      }
      return true
    } catch {
      this.callback = null
      this.handle = null
      return false
    }
  }

  private match(api: Win32, vkCode: number): HookBinding | null {
    for (const b of this.bindings) {
      if (b.vk !== vkCode) continue
      if (b.ctrl !== isDown(api, VK.CONTROL)) continue
      if (b.shift !== isDown(api, VK.SHIFT)) continue
      if (b.alt !== isDown(api, VK.MENU)) continue
      return b
    }
    return null
  }

  dispose(): void {
    if (this.handle) {
      try {
        // The handle only exists if the bindings were built, so this cannot be
        // null here — but reaching for it defensively costs nothing.
        win32()?.UnhookWindowsHookEx(this.handle)
      } catch {
        // Nothing useful to do if the unhook fails during shutdown.
      }
    }
    this.handle = null
    this.callback = null
    this.bindings = []
  }
}

/**
 * Parses an Electron accelerator into hook terms.
 * Returns null for anything the hook does not handle, so the caller can fall
 * back to `globalShortcut`.
 */
export function parseAccelerator(
  accelerator: string,
): Omit<HookBinding, 'run'> | null {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const key = parts[parts.length - 1].toLowerCase()
  // Only PrintScreen needs the hook; everything else works fine via Electron.
  if (key !== 'printscreen') return null

  const mods = parts.slice(0, -1).map((m) => m.toLowerCase())
  return {
    vk: VK.SNAPSHOT,
    ctrl: mods.includes('ctrl') || mods.includes('control') || mods.includes('commandorcontrol'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
  }
}
