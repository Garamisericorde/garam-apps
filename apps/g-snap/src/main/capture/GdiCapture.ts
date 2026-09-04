import { ffiFailure, lazyBindings } from '../native/ffi.js'

/**
 * Screen capture through GDI BitBlt.
 *
 * WHY NOT `desktopCapturer`: it costs a flat ~350 ms per call on this machine,
 * and that is session setup, not pixels — asking for a 1x1 thumbnail still
 * takes 322 ms. A screenshot tool that lags a third of a second behind the
 * hotkey feels broken. BitBlt measures 31-68 ms for the same 2560x1440 frame.
 *
 * WHY NOT `getUserMedia`: faster than desktopCapturer (~170 ms) but it runs the
 * frame through WebRTC, which chroma-subsamples it — measured 12.8% of pixels
 * wrong, worst channel error 189. Unusable for a screenshot tool.
 *
 * BitBlt is a straight memory blit of the composited desktop: no scaling, no
 * colour conversion, so it cannot soften the image. Measured against
 * desktopCapturer on pixels static for both, it differs on 0.6% with a worst
 * error of 9 — i.e. noise from the screen changing between the two grabs.
 *
 * KNOWN LIMIT: BitBlt reads the DWM-composited desktop, so a game running in
 * exclusive fullscreen will not appear. `captureAllDisplays` falls back to
 * desktopCapturer when this throws.
 */

/**
 * Built on first use, not at import. See ../native/ffi.ts — an eager load here
 * took the whole app down when the native module was missing.
 */
const gdi = lazyBindings((koffi) => {
  const user32 = koffi.load('user32.dll')
  const gdi32 = koffi.load('gdi32.dll')

  koffi.pointer('HDC', koffi.opaque())
  koffi.pointer('HBITMAP', koffi.opaque())
  koffi.pointer('HGDIOBJ', koffi.opaque())

  return {
    GetDC: user32.func('HDC GetDC(void *hWnd)'),
    ReleaseDC: user32.func('int ReleaseDC(void *hWnd, HDC hDC)'),
    GetSystemMetrics: user32.func('int GetSystemMetrics(int nIndex)'),

    CreateCompatibleDC: gdi32.func('HDC CreateCompatibleDC(HDC hdc)'),
    CreateCompatibleBitmap: gdi32.func(
      'HBITMAP CreateCompatibleBitmap(HDC hdc, int cx, int cy)',
    ),
    SelectObject: gdi32.func('HGDIOBJ SelectObject(HDC hdc, HGDIOBJ h)'),
    BitBlt: gdi32.func(
      'int BitBlt(HDC hdc, int x, int y, int cx, int cy, HDC hdcSrc, int x1, int y1, uint32_t rop)',
    ),
    DeleteObject: gdi32.func('int DeleteObject(HGDIOBJ ho)'),
    DeleteDC: gdi32.func('int DeleteDC(HDC hdc)'),
    GetDIBits: gdi32.func(
      'int GetDIBits(HDC hdc, HBITMAP hbm, uint32_t start, uint32_t cLines, void *lpvBits, void *lpbmi, uint32_t usage)',
    ),
  }
})

/** The bindings, or a throw the caller's fallback path already handles. */
function requireGdi(): NonNullable<ReturnType<typeof gdi>> {
  const api = gdi()
  if (!api) throw new Error(`GDI unavailable: ${ffiFailure() ?? 'bindings could not be built'}`)
  return api
}

const SRCCOPY = 0x00cc0020
/** Also pulls in layered windows, which plain SRCCOPY skips. */
const CAPTUREBLT = 0x40000000
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79

export interface VirtualScreen {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Bounds of the whole virtual desktop in PHYSICAL pixels.
 *
 * Electron declares itself per-monitor DPI aware, so these are real pixels
 * rather than the scaled values a DPI-unaware process would see.
 */
export function virtualScreen(): VirtualScreen {
  const api = requireGdi()

  return {
    x: api.GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: api.GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: api.GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: api.GetSystemMetrics(SM_CYVIRTUALSCREEN),
  }
}

/**
 * Is every sampled pixel the same colour?
 *
 * Sampled on a coarse grid rather than scanned in full — this runs on the
 * hotkey path and a real desktop differs within the first few samples.
 */
function isUniform(data: Buffer, width: number, height: number): boolean {
  const first = data.readUInt32LE(0)
  const stepX = Math.max(1, Math.floor(width / 64))
  const stepY = Math.max(1, Math.floor(height / 64))

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      if (data.readUInt32LE((y * width + x) * 4) !== first) return false
    }
  }
  return true
}

/** 32bpp BITMAPINFOHEADER; a negative height asks for top-down rows. */
function bitmapInfo(width: number, height: number): Buffer {
  const buf = Buffer.alloc(40 + 12)
  buf.writeUInt32LE(40, 0) // biSize
  buf.writeInt32LE(width, 4) // biWidth
  buf.writeInt32LE(-height, 8) // biHeight, negative = top-down
  buf.writeUInt16LE(1, 12) // biPlanes
  buf.writeUInt16LE(32, 14) // biBitCount
  buf.writeUInt32LE(BI_RGB, 16) // biCompression
  return buf
}

export interface GdiFrame {
  /** BGRA, top-down — the same layout `nativeImage.toBitmap()` returns. */
  data: Buffer
  width: number
  height: number
  bounds: VirtualScreen
}

/**
 * Grabs the whole virtual desktop.
 * Throws if any GDI call fails, so the caller can fall back.
 */
export function captureVirtualScreen(): GdiFrame {
  const api = requireGdi()
  const vs = virtualScreen()
  if (vs.width <= 0 || vs.height <= 0) {
    throw new Error(`Bad virtual screen size: ${vs.width}x${vs.height}`)
  }

  const screenDC = api.GetDC(null)
  if (!screenDC) throw new Error('GetDC failed')

  let memDC: unknown = null
  let bitmap: unknown = null
  let oldObj: unknown = null

  try {
    memDC = api.CreateCompatibleDC(screenDC)
    if (!memDC) throw new Error('CreateCompatibleDC failed')

    bitmap = api.CreateCompatibleBitmap(screenDC, vs.width, vs.height)
    if (!bitmap) throw new Error('CreateCompatibleBitmap failed')

    oldObj = api.SelectObject(memDC, bitmap)

    const blitted = api.BitBlt(
      memDC,
      0,
      0,
      vs.width,
      vs.height,
      screenDC,
      vs.x,
      vs.y,
      SRCCOPY | CAPTUREBLT,
    )
    if (!blitted) throw new Error('BitBlt failed')

    const data = Buffer.alloc(vs.width * vs.height * 4)
    const lines = api.GetDIBits(
      memDC,
      bitmap,
      0,
      vs.height,
      data,
      bitmapInfo(vs.width, vs.height),
      DIB_RGB_COLORS,
    )
    if (lines === 0) throw new Error('GetDIBits returned no scanlines')

    if (isUniform(data, vs.width, vs.height)) {
      // A game in exclusive fullscreen owns the display, so BitBlt of the
      // desktop DC comes back blank instead of failing. Treat a completely flat
      // frame as a failure so the caller can fall back to a capture API that
      // does see the game.
      throw new Error('BitBlt returned a uniform frame (exclusive fullscreen app?)')
    }

    return { data, width: vs.width, height: vs.height, bounds: vs }
  } finally {
    if (memDC && oldObj) api.SelectObject(memDC, oldObj)
    if (bitmap) api.DeleteObject(bitmap)
    if (memDC) api.DeleteDC(memDC)
    api.ReleaseDC(null, screenDC)
  }
}
