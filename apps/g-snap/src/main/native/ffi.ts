import type Koffi from 'koffi'

/**
 * Access to koffi, the FFI every native fast path in this app is built on.
 *
 * WHY THIS EXISTS: the three native modules used to call `koffi.load()` at
 * module scope, so a koffi that could not be required threw while the main
 * process was still building its module graph — before a window, a logger or
 * an error handler existed. The user got Electron's raw "A JavaScript error
 * occurred in the main process" dialog and the app never started at all.
 *
 * That is the wrong failure mode. Everything native here is a FAST PATH with a
 * documented fallback: GDI capture falls back to `desktopCapturer`, the
 * keyboard hook falls back to `globalShortcut`, and focus control degrades to
 * Electron's own `focus()`. A screenshot tool without an FFI should be slower,
 * not dead.
 *
 * Seen in the wild: an install left `koffi.node` marked unpacked in the asar
 * header but absent from `app.asar.unpacked`, and every launch died on the
 * dialog. Missing native code must stay a degraded mode, never a crash.
 */

export type Ffi = typeof Koffi

let loaded: Ffi | null | undefined
let failure: string | null = null

/**
 * The FFI, or null when it cannot be loaded. Never throws.
 *
 * A runtime `require` on purpose: a static import is hoisted to the top of the
 * bundle, which is exactly the eager load this module exists to avoid.
 */
export function ffi(): Ffi | null {
  if (loaded !== undefined) return loaded

  try {
    loaded = require('koffi') as Ffi
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
    loaded = null
  }
  return loaded
}

/** Why the native layer is unavailable, or null when it loaded fine. */
export function ffiFailure(): string | null {
  ffi()
  return failure
}

/**
 * Declares a set of native bindings without building them yet.
 *
 * The returned accessor builds them on first use and remembers the result —
 * including failure, so a broken install is not retried on every keystroke.
 * It returns null rather than throwing, which lets each caller degrade in the
 * way that makes sense for it.
 */
export function lazyBindings<T>(create: (koffi: Ffi) => T): () => T | null {
  let value: T | null | undefined

  return () => {
    if (value !== undefined) return value

    const koffi = ffi()
    if (!koffi) {
      value = null
      return value
    }

    try {
      value = create(koffi)
    } catch (err) {
      // Declaring a prototype can fail on its own (a missing DLL, a signature
      // koffi rejects). Same outcome for the caller: no native path.
      failure ??= err instanceof Error ? err.message : String(err)
      value = null
    }
    return value
  }
}
