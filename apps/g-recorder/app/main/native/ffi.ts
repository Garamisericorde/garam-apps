import type Koffi from 'koffi'

/**
 * Access to koffi, the FFI the controller bindings are built on.
 *
 * WHY THIS EXISTS: the main process evaluates its whole import graph before a
 * window, a logger or an error handler exists, so a `koffi.load()` at module
 * scope that throws is an unlogged crash dialog rather than a caught error.
 * Seen in g-snap in the wild: an install left `koffi.node` marked unpacked in
 * the asar header but absent from `app.asar.unpacked`, and every launch died on
 * Electron's raw "A JavaScript error occurred in the main process".
 *
 * A recorder without an FFI must lose its controller shortcuts, not its ability
 * to record. Nothing here throws; it returns null and the caller degrades.
 */

export type Ffi = typeof Koffi

let loaded: Ffi | null | undefined
let failure: string | null = null

/**
 * The FFI, or null when it cannot be loaded.
 *
 * A runtime `require` on purpose: a static import is hoisted to the top of the
 * bundle, which is exactly the eager load this module exists to avoid.
 */
export function ffi(): Ffi | null {
  if (loaded !== undefined) return loaded

  try {
    /*
     * A runtime require is the whole point. A static import is hoisted to the
     * top of the bundle and loads koffi eagerly, which is the crash this
     * module exists to prevent.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
 * Declares native bindings without building them yet.
 *
 * The accessor builds them on first use and remembers the result — including
 * failure, so a broken install is not retried on every poll.
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
      // Declaring a prototype can fail on its own — a missing DLL, a signature
      // koffi rejects. Same outcome for the caller: no native path.
      failure ??= err instanceof Error ? err.message : String(err)
      value = null
    }
    return value
  }
}
