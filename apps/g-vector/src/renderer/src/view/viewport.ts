/**
 * The camera: what part of the document the canvas is showing.
 *
 * Two coordinate spaces, and only these two. DOCUMENT space is what nodes,
 * bounds and snap targets are expressed in. SCREEN space is CSS pixels inside
 * the canvas element, and it is where the editor's own chrome lives — handles,
 * guides, labels — so that a handle is 8 px at every zoom without a single
 * `/ zoom` in the drawing code.
 */
import type { Rect, Vec } from '../doc/geom'

export interface Viewport {
  /** The document coordinate sitting at the canvas's top-left corner. */
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

/** The steps Ctrl+= and Ctrl+- walk through — the ones people expect to land on. */
export const ZOOM_STEPS = [
  0.02, 0.03, 0.05, 0.08, 0.13, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48,
  64,
]

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function screenToDoc(vp: Viewport, p: Vec): Vec {
  return { x: vp.x + p.x / vp.zoom, y: vp.y + p.y / vp.zoom }
}

export function docToScreen(vp: Viewport, p: Vec): Vec {
  return { x: (p.x - vp.x) * vp.zoom, y: (p.y - vp.y) * vp.zoom }
}

export function docRectToScreen(vp: Viewport, r: Rect): Rect {
  return {
    x: (r.x - vp.x) * vp.zoom,
    y: (r.y - vp.y) * vp.zoom,
    width: r.width * vp.zoom,
    height: r.height * vp.zoom,
  }
}

/** The SVG viewBox that shows this viewport in a canvas of `size` CSS pixels. */
export function viewBoxOf(vp: Viewport, size: { width: number; height: number }): string {
  return `${vp.x} ${vp.y} ${size.width / vp.zoom} ${size.height / vp.zoom}`
}

/** Zooms while holding the document point under `anchor` (screen px) still. */
export function zoomAt(vp: Viewport, anchor: Vec, zoom: number): Viewport {
  const next = clampZoom(zoom)
  const before = screenToDoc(vp, anchor)
  return {
    zoom: next,
    x: before.x - anchor.x / next,
    y: before.y - anchor.y / next,
  }
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...vp, x: vp.x - dxScreen / vp.zoom, y: vp.y - dyScreen / vp.zoom }
}

/** The next / previous entry in ZOOM_STEPS, so Ctrl+= lands on round numbers. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((z) => z > zoom * 1.001) ?? MAX_ZOOM
  }
  const lower = ZOOM_STEPS.filter((z) => z < zoom * 0.999)
  return lower.length > 0 ? lower[lower.length - 1] : MIN_ZOOM
}

export function fitRect(
  rect: Rect,
  size: { width: number; height: number },
  padding = 48,
): Viewport {
  const availableWidth = Math.max(1, size.width - padding * 2)
  const availableHeight = Math.max(1, size.height - padding * 2)
  const zoom = clampZoom(
    Math.min(availableWidth / Math.max(1, rect.width), availableHeight / Math.max(1, rect.height)),
  )
  return {
    zoom,
    x: rect.x + rect.width / 2 - size.width / 2 / zoom,
    y: rect.y + rect.height / 2 - size.height / 2 / zoom,
  }
}
