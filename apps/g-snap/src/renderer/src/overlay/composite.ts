import type { DisplayShot, Rect } from '@shared/types'

export interface Composite {
  /** Every display painted into one canvas, at real device pixels. */
  canvas: HTMLCanvasElement
  /** Device-pixel size of that canvas. */
  deviceWidth: number
  deviceHeight: number
  /** Union rectangle in DIP, kept so screen coordinates can be reported. */
  union: Rect
  /** Bumped on every capture so React sees a new object. */
  revision: number
}

let revision = 0

/**
 * Paints every display into ONE canvas at its true resolution.
 *
 * Everything downstream — what is shown, the magnifier, the exported crop —
 * reads from this canvas, so there is exactly one place where scaling could go
 * wrong, and it does not: each display is blitted 1:1.
 *
 * Deliberately NOT a hook. The raw frame is ~14 MB per display, and the overlay
 * window is now long-lived, so those buffers must not end up parked in React
 * state. Called straight from the IPC handler, the pixels become garbage as
 * soon as this returns.
 *
 * A FRESH canvas is allocated every time, on purpose. Reusing one looks like an
 * easy saving, but Konva diffs the `image` prop by identity: hand it the same
 * canvas object twice and it decides nothing changed and keeps showing the
 * PREVIOUS frame. That shipped once and produced a stale screenshot — the
 * overlay froze an image from several seconds earlier.
 */
export async function buildComposite(
  shots: DisplayShot[],
  union: Rect,
): Promise<Composite | null> {
  if (shots.length === 0) return null

  // Use the sharpest display's scale so no display is ever downsampled.
  const scale = Math.max(
    ...shots.map((s) => (s.bounds.width > 0 ? s.nativeSize.width / s.bounds.width : 1)),
  )

  const deviceWidth = Math.round(union.width * scale)
  const deviceHeight = Math.round(union.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = deviceWidth
  canvas.height = deviceHeight

  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null

  for (const shot of shots) {
    const bitmap = await toImageBitmap(shot)

    // Position in device pixels. For the common single-display case this is
    // (0, 0) at an exact 1:1 size, so nothing is resampled.
    ctx.drawImage(
      bitmap,
      Math.round((shot.bounds.x - union.x) * scale),
      Math.round((shot.bounds.y - union.y) * scale),
      Math.round(shot.bounds.width * scale),
      Math.round(shot.bounds.height * scale),
    )
    bitmap.close()
  }

  return { canvas, deviceWidth, deviceHeight, union, revision: ++revision }
}

/** Turns one display's raw BGRA buffer into an ImageBitmap. */
async function toImageBitmap(shot: DisplayShot): Promise<ImageBitmap> {
  const { width, height } = shot.nativeSize
  const src = shot.pixels

  // A Uint32 view needs 4-byte alignment, which an IPC buffer does not promise.
  const aligned = src.byteOffset % 4 === 0 ? src : new Uint8Array(src.slice(0, src.byteLength))

  // Swap B and R with a 32-bit view: one pass, no per-channel indexing.
  const src32 = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 2)
  const out = new Uint8ClampedArray(aligned.byteLength)
  const out32 = new Uint32Array(out.buffer)

  for (let i = 0; i < src32.length; i++) {
    const p = src32[i]
    // little-endian BGRA in memory reads as 0xAARRGGBB here; swap R and B
    out32[i] = (p & 0xff00ff00) | ((p & 0x00ff0000) >>> 16) | ((p & 0x000000ff) << 16)
  }

  return createImageBitmap(new ImageData(out, width, height))
}
