import { lazyBindings } from '../native/ffi.js'
import type { BrowserWindow } from 'electron'

/**
 * Windows-specific window behaviour the Electron API does not cover.
 *
 * Two problems, both only visible on the FIRST capture of a session:
 *
 * 1. The overlay faded in instead of appearing instantly. That is the DWM
 *    window transition; `DWMWA_TRANSITIONS_FORCEDISABLED` turns it off.
 *
 * 2. Esc did not close the overlay, although right-click did. Mouse events do
 *    not need focus, keyboard events do — so the window was visible but not
 *    focused. Windows refuses foreground activation to a process that is not
 *    already in the foreground, and a tray app never is. Once the user clicked
 *    the overlay our process became foreground, which is why every later
 *    capture behaved.
 *
 *    `AttachThreadInput` to the current foreground thread lifts that
 *    restriction for the duration of the call, which is the documented way to
 *    do this.
 */

/**
 * Built on first use, not at import. See ../native/ffi.ts — an eager load here
 * took the whole app down when the native module was missing.
 */
const win32 = lazyBindings((koffi) => {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const dwmapi = koffi.load('dwmapi.dll')

  return {
    SetForegroundWindow: user32.func('int SetForegroundWindow(uintptr_t hWnd)'),
    GetForegroundWindow: user32.func('uintptr_t GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func(
      'uint32_t GetWindowThreadProcessId(uintptr_t hWnd, void *lpdwProcessId)',
    ),
    AttachThreadInput: user32.func(
      'int AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int fAttach)',
    ),
    BringWindowToTop: user32.func('int BringWindowToTop(uintptr_t hWnd)'),
    SetActiveWindow: user32.func('uintptr_t SetActiveWindow(uintptr_t hWnd)'),
    GetCurrentThreadId: kernel32.func('uint32_t GetCurrentThreadId()'),
    DwmSetWindowAttribute: dwmapi.func(
      'int32_t DwmSetWindowAttribute(uintptr_t hwnd, uint32_t dwAttribute, void *pvAttribute, uint32_t cbAttribute)',
    ),
    GetWindowRect: user32.func('int GetWindowRect(uintptr_t hWnd, void *lpRect)'),
    GetWindowLongPtrW: user32.func('intptr_t GetWindowLongPtrW(uintptr_t hWnd, int nIndex)'),
    GetClassNameW: user32.func('int GetClassNameW(uintptr_t hWnd, void *lpClassName, int nMaxCount)'),
  }
})

const DWMWA_TRANSITIONS_FORCEDISABLED = 3
const GWL_STYLE = -16
const WS_CAPTION = 0x00c00000

/** Desktop shell windows, which always cover the screen and are not apps. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd'])

/**
 * Is a full-screen application (typically a game) in front right now?
 *
 * Matters because a borderless-fullscreen game usually runs in "independent
 * flip": DWM stops compositing it and hands its buffer straight to the display.
 * GDI then reads that region as black while the rest of the desktop still looks
 * fine — so the blank-frame check does not catch it and the screenshot comes
 * back with a black hole where the game was.
 *
 * When this returns true the caller skips the GDI fast path and uses a capture
 * API that can see such a surface, trading speed for actually working.
 *
 * Size alone is NOT enough: a maximised ordinary window is exactly screen-sized
 * too, and treating those as games sent every normal capture down the slow path.
 * A real full-screen app has no title bar, so the caption style is what
 * separates the two.
 */
export function isFullscreenAppInForeground(
  screenWidth: number,
  screenHeight: number,
  ownHwnd: bigint | null = null,
): boolean {
  const api = win32()
  if (!api) return false

  try {
    const hwnd = api.GetForegroundWindow()
    if (!hwnd) return false
    if (ownHwnd !== null && BigInt(hwnd) === ownHwnd) return false

    // Ignore the desktop shell itself.
    const nameBuf = Buffer.alloc(256 * 2)
    const len = api.GetClassNameW(hwnd, nameBuf, 256)
    if (len > 0) {
      const className = nameBuf.toString('ucs2', 0, len * 2)
      if (SHELL_CLASSES.has(className)) return false
    }

    // RECT { LONG left, top, right, bottom }
    const rect = Buffer.alloc(16)
    if (!api.GetWindowRect(hwnd, rect)) return false

    const width = rect.readInt32LE(8) - rect.readInt32LE(0)
    const height = rect.readInt32LE(12) - rect.readInt32LE(4)

    if (width < screenWidth - 2 || height < screenHeight - 2) return false

    // A maximised regular window is screen-sized but keeps its title bar.
    const style = api.GetWindowLongPtrW(hwnd, GWL_STYLE)
    const hasCaption = (BigInt(style) & BigInt(WS_CAPTION)) === BigInt(WS_CAPTION)
    return !hasCaption
  } catch {
    return false
  }
}

/** Handle of whatever window is in front right now, or null. */
export function currentForeground(): bigint | null {
  const api = win32()
  if (!api) return null

  try {
    const hwnd = api.GetForegroundWindow()
    return hwnd ? BigInt(hwnd) : null
  } catch {
    return null
  }
}

/** Rect of the foreground window in physical pixels, or null. */
export function foregroundWindowRect(): {
  x: number
  y: number
  width: number
  height: number
} | null {
  const api = win32()
  if (!api) return null

  try {
    const hwnd = api.GetForegroundWindow()
    if (!hwnd) return null
    const rect = Buffer.alloc(16)
    if (!api.GetWindowRect(hwnd, rect)) return null
    const left = rect.readInt32LE(0)
    const top = rect.readInt32LE(4)
    return {
      x: left,
      y: top,
      width: rect.readInt32LE(8) - left,
      height: rect.readInt32LE(12) - top,
    }
  } catch {
    return null
  }
}

/**
 * Hands the foreground back to whatever owned it before the overlay appeared.
 *
 * Without this the game keeps rendering but stops receiving keyboard input —
 * WASD does nothing until the user clicks it, because we took the foreground
 * and never returned it.
 */
export function restoreForeground(hwnd: bigint | null): boolean {
  if (hwnd === null) return false

  const api = win32()
  if (!api) return false

  let attached = false
  let targetThread = 0
  let ourThread = 0

  try {
    ourThread = api.GetCurrentThreadId()
    targetThread = api.GetWindowThreadProcessId(hwnd, null)
    if (targetThread && targetThread !== ourThread) {
      attached = api.AttachThreadInput(ourThread, targetThread, 1) !== 0
    }
    api.SetForegroundWindow(hwnd)
    api.SetActiveWindow(hwnd)
    return true
  } catch {
    return false
  } finally {
    if (attached) {
      try {
        api.AttachThreadInput(ourThread, targetThread, 0)
      } catch {
        // Best effort.
      }
    }
  }
}

/** Exposes the window handle so the caller can exclude its own overlay. */
export function nativeHandleOf(win: BrowserWindow): bigint | null {
  return hwndOf(win)
}

/** Reads the HWND out of Electron's native handle buffer. */
function hwndOf(win: BrowserWindow): bigint | null {
  try {
    const buf = win.getNativeWindowHandle()
    if (buf.length >= 8) return buf.readBigUInt64LE(0)
    if (buf.length >= 4) return BigInt(buf.readUInt32LE(0))
    return null
  } catch {
    return null
  }
}

/** Turns off the DWM open/close animation so the overlay appears instantly. */
export function disableWindowAnimations(win: BrowserWindow): boolean {
  const hwnd = hwndOf(win)
  if (hwnd === null) return false

  const api = win32()
  if (!api) return false

  try {
    const value = Buffer.alloc(4)
    value.writeInt32LE(1, 0) // TRUE = transitions disabled
    return api.DwmSetWindowAttribute(hwnd, DWMWA_TRANSITIONS_FORCEDISABLED, value, 4) === 0
  } catch {
    return false
  }
}

/**
 * Forces the window to the foreground with keyboard focus.
 *
 * Plain `SetForegroundWindow` is refused when the calling process is not
 * already in the foreground. Attaching our input queue to the current
 * foreground thread makes Windows treat the call as coming from that thread,
 * which it accepts.
 */
export function forceForeground(win: BrowserWindow): boolean {
  const hwnd = hwndOf(win)
  if (hwnd === null) return false

  const api = win32()
  if (!api) return false

  let attached = false
  let foregroundThread = 0
  let ourThread = 0

  try {
    ourThread = api.GetCurrentThreadId()
    const foreground = api.GetForegroundWindow()

    if (foreground) {
      foregroundThread = api.GetWindowThreadProcessId(foreground, null)
      if (foregroundThread && foregroundThread !== ourThread) {
        attached = api.AttachThreadInput(ourThread, foregroundThread, 1) !== 0
      }
    }

    api.BringWindowToTop(hwnd)
    api.SetForegroundWindow(hwnd)
    api.SetActiveWindow(hwnd)
    return true
  } catch {
    return false
  } finally {
    if (attached) {
      try {
        api.AttachThreadInput(ourThread, foregroundThread, 0)
      } catch {
        // Detaching is best-effort; leaving it attached would be worse but
        // there is nothing useful to do if it fails.
      }
    }
  }
}
