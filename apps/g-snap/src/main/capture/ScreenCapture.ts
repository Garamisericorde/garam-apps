import { desktopCapturer, nativeImage, screen } from 'electron'
import type { DisplayShot, Rect } from '@shared/types'
import { captureVirtualScreen, virtualScreen } from './GdiCapture.js'
import { foregroundWindowRect, isFullscreenAppInForeground } from '../overlay/WindowFocus.js'

/** Measurements logged so we can see what the capture actually produced. */
export interface CaptureDiagnostic {
  displayId: number
  dipBounds: Rect
  scaleFactor: number
  /** Requested size, in physical pixels. */
  wantedPixels: { width: number; height: number }
  /** Size desktopCapturer actually returned. */
  actualPixels: { width: number; height: number }
  /** Whether the source matched by display_id, or fell back to index order. */
  matchedById: boolean
  /** Which capture engine produced this frame. */
  engine: 'gdi' | 'desktopCapturer'
}

export interface CaptureResult {
  shots: DisplayShot[]
  /** Rectangle covering every display (DIP). */
  union: Rect
  diagnostics: CaptureDiagnostic[]
}

/**
 * Works out a display's true pixel size.
 *
 * WHY THIS IS SO FUSSY:
 * `desktopCapturer` FITS the image into the requested box. At a fractional DPI
 * scale (e.g. 110% -> scaleFactor 1.1041666) `bounds * scaleFactor` is not a
 * whole number:
 *   2319 x 1.1041666 = 2560.56  ->  rounds to 2561
 * A 2560px screen then gets upscaled to 2561, every pixel is resampled, and the
 * image visibly softens (measured: sharpness 5.28 -> 4.37).
 *
 * Because the DIP value is itself `round(native / scaleFactor)`, multiplying
 * back can miss the true native size by one pixel either way. Real display
 * modes are ALWAYS even in both dimensions, so rounding to the nearest even
 * integer lands on the right value (2560.56 -> 2560, 1440.94 -> 1440).
 */
function nativePixelSize(bounds: Rect, scaleFactor: number): { width: number; height: number } {
  return {
    width: roundToEven(bounds.width * scaleFactor),
    height: roundToEven(bounds.height * scaleFactor),
  }
}

/** Rounds to the nearest even integer. */
function roundToEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Captures every display at once.
 *
 * Windows notes:
 * - `screen.getAllDisplays()` reports DIP coordinates with the primary display's
 *   top-left at (0,0), so displays to the left or above get NEGATIVE x/y.
 * - A single `thumbnailSize` applies to all sources, so we ask for the largest
 *   display's size. Electron fits each source into that box while preserving
 *   aspect ratio, so smaller displays still come back at their own resolution.
 * - `source.display_id` can be empty on some driver / virtual-display setups;
 *   we fall back to matching by index there.
 */
/** Set by the overlay so its own always-on-top window is never mistaken for a game. */
export let overlayHwnd: bigint | null = null
export function setOverlayHwnd(h: bigint | null): void {
  overlayHwnd = h
}

/**
 * The same shape a real capture produces, with blank pixels.
 *
 * Used to warm the renderer at startup. A synthetic frame rather than a real
 * screenshot on purpose: it exercises exactly the same code (the same byte
 * count through the same BGRA swap, ImageBitmap and Konva paths) without this
 * app taking a picture of the screen nobody asked for.
 */
export function blankShots(): CaptureResult {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) throw new Error('No display found')

  const shots: DisplayShot[] = displays.map((display) => {
    const native = nativePixelSize(display.bounds, display.scaleFactor)
    return {
      displayId: display.id,
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      nativeSize: native,
      pixels: Buffer.alloc(native.width * native.height * 4),
    }
  })

  return { shots, union: unionBounds(displays.map((d) => d.bounds)), diagnostics: [] }
}

export async function captureAllDisplays(): Promise<CaptureResult> {
  const displays = screen.getAllDisplays()
  if (displays.length === 0) {
    throw new Error('No display found')
  }

  // Fast path: GDI BitBlt, ~58 ms against desktopCapturer's ~394 ms.
  //
  // A full-screen app in front is NOT reason enough to skip it. Many games are
  // still DWM-composited and capture fine, and skipping cost 400 ms for no
  // reason. So take the frame and check whether the game's own rectangle
  // actually came through; only fall back when it did not.
  try {
    lastGdiError = null
    const vs = virtualScreen()
    const result = captureViaGdi(displays)

    if (isFullscreenAppInForeground(vs.width, vs.height, overlayHwnd)) {
      const rect = foregroundWindowRect()
      const frame = result.shots[0]
      if (rect && regionIsUniform(frame.pixels, frame.nativeSize.width, frame.nativeSize.height, rect, vs)) {
        lastGdiError = 'full-screen app rendered outside DWM composition (independent flip)'
        throw new Error(lastGdiError)
      }
    }

    return result
  } catch (err) {
    lastGdiError = err instanceof Error ? `${err.message}
${err.stack ?? ''}` : String(err)
    console.error('[capture] GDI path failed, falling back:', lastGdiError)
  }

  const natives = displays.map((d) => nativePixelSize(d.bounds, d.scaleFactor))
  const maxPixelWidth = Math.max(...natives.map((n) => n.width))
  const maxPixelHeight = Math.max(...natives.map((n) => n.height))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxPixelWidth, height: maxPixelHeight },
    fetchWindowIcons: false,
  })

  if (sources.length === 0) {
    throw new Error('Could not read any screen source (desktopCapturer returned nothing)')
  }

  const diagnostics: CaptureDiagnostic[] = []

  const shots: DisplayShot[] = displays.map((display, index) => {
    const byId = sources.find((s) => s.display_id === String(display.id))
    const source = byId ?? sources[index] ?? sources[0]

    const wanted = natives[index]
    const actual = source.thumbnail.getSize()

    diagnostics.push({
      displayId: display.id,
      dipBounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
      wantedPixels: wanted,
      actualPixels: actual,
      matchedById: Boolean(byId),
      engine: 'desktopCapturer',
    })

    return {
      displayId: display.id,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      scaleFactor: display.scaleFactor,
      // So the renderer can base its scaling on the pixels we ACTUALLY got
      // rather than on scaleFactor. The two diverge at fractional DPI, and the
      // difference shows up as blur.
      nativeSize: { width: actual.width, height: actual.height },
      pixels: source.thumbnail.toBitmap(),
    }
  })

  return {
    shots,
    union: unionBounds(displays.map((d) => d.bounds)),
    diagnostics,
  }
}

/**
 * Captures the display under the cursor as a NativeImage.
 *
 * The full-screen hotkey goes straight to the clipboard, and `clipboard
 * .writeImage` takes a NativeImage, so there is no encode/decode round trip at
 * all here — nothing is ever resampled.
 */
export async function captureActiveDisplayImage(): Promise<Electron.NativeImage> {
  // Fast path: one BitBlt, then wrap the raw pixels without any encode step.
  try {
    const frame = captureVirtualScreen()
    return nativeImage.createFromBitmap(frame.data, {
      width: frame.width,
      height: frame.height,
    })
  } catch (err) {
    lastGdiError = err instanceof Error ? err.message : String(err)
  }

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const native = nativePixelSize(display.bounds, display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: native,
    fetchWindowIcons: false,
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) {
    throw new Error('Could not capture the active display')
  }

  return source.thumbnail
}

/** Captures only the display under the cursor, as raw pixels. */
export async function captureActiveDisplay(): Promise<DisplayShot> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const native = nativePixelSize(display.bounds, display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: native,
    fetchWindowIcons: false,
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) {
    throw new Error('Could not capture the active display')
  }

  const actual = source.thumbnail.getSize()

  return {
    displayId: display.id,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    nativeSize: { width: actual.width, height: actual.height },
    pixels: source.thumbnail.toBitmap(),
  }
}

/** Set when the GDI path fails, so the caller can log why it fell back. */
export let lastGdiError: string | null = null

/**
 * Captures every display in one BitBlt of the virtual desktop.
 *
 * GDI hands back a single buffer covering the whole desktop in physical pixels,
 * which suits us: the renderer wants one composite anyway. It is reported as a
 * single "display" spanning the DIP union.
 */
function captureViaGdi(displays: Electron.Display[]): CaptureResult {
  const frame = captureVirtualScreen()
  const union = unionBounds(displays.map((d) => d.bounds))

  // GDI reports physical pixels, Electron reports DIP. The ratio between them
  // is the scale the renderer needs; deriving it from the two measured sizes
  // avoids trusting scaleFactor, which drifts at fractional DPI.
  const wanted = { width: frame.width, height: frame.height }

  return {
    shots: [
      {
        displayId: displays[0].id,
        bounds: union,
        scaleFactor: displays[0].scaleFactor,
        nativeSize: { width: frame.width, height: frame.height },
        pixels: frame.data,
      },
    ],
    union,
    diagnostics: [
      {
        displayId: displays[0].id,
        dipBounds: union,
        scaleFactor: displays[0].scaleFactor,
        wantedPixels: wanted,
        actualPixels: wanted,
        matchedById: true,
        engine: 'gdi',
      },
    ],
  }
}

/**
 * Is the given screen region a single flat colour in this frame?
 *
 * A game using independent flip is handed straight to the display, so GDI reads
 * its rectangle as solid black while the rest of the desktop looks normal —
 * a whole-frame check would miss it.
 */
function regionIsUniform(
  pixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number },
): boolean {
  const left = Math.max(0, rect.x - origin.x)
  const top = Math.max(0, rect.y - origin.y)
  const right = Math.min(frameWidth, left + rect.width)
  const bottom = Math.min(frameHeight, top + rect.height)
  if (right - left < 8 || bottom - top < 8) return false

  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const first = view.getUint32((top * frameWidth + left) * 4, true)
  const stepX = Math.max(1, Math.floor((right - left) / 48))
  const stepY = Math.max(1, Math.floor((bottom - top) / 48))

  for (let y = top; y < bottom; y += stepY) {
    for (let x = left; x < right; x += stepX) {
      if (view.getUint32((y * frameWidth + x) * 4, true) !== first) return false
    }
  }
  return true
}

/** Smallest rectangle containing all the given rectangles. */
export function unionBounds(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
