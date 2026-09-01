/**
 * @garam/theme — JS access to the token values.
 *
 * CSS is the source of truth; this is a mirror for places that cannot read CSS
 * variables (Konva, canvas). When you change a token, update tokens.css too.
 */

export const palette = {
  bg: '#14142a',
  bgSurface: '#1a1a2e',
  bgElevated: '#1e1e3f',
  bgHover: '#16213e',
  bgActive: '#0f3460',

  border: '#2d3748',
  borderStrong: '#3d4a63',

  text: '#eaeaea',
  textMuted: '#a0a0a0',
  textFaint: '#6b7280',
  textOnAccent: '#ffffff',
  textOnLight: '#1a1a1a',

  accent: '#e94560',
  accentHover: '#ff6b6b',
  accentActive: '#d13350',

  danger: '#ef4444',
  success: '#4ade80',
  warning: '#f59e0b',
  info: '#3b82f6',
} as const

/**
 * The violet accent ramp, mirroring accent-violet.css.
 *
 * Konva paints on a canvas and cannot read CSS variables, so a canvas that
 * wants to match the accent reads it from here.
 */
export const violetAccent = {
  from: '#2563eb',
  to: '#9333ea',
  mid: '#5c4bea',
} as const

/**
 * The surfaces that ship with the violet accent, mirroring accent-violet.css.
 *
 * A BrowserWindow paints its `backgroundColor` before any stylesheet loads, and
 * the main process cannot read CSS variables — so a window that does not read
 * its opening colour from here flashes the previous palette on every launch.
 */
export const violetSurfaces = {
  bg: '#0c0c14',
  surface: '#12121e',
} as const

/**
 * Blends two hex colours. Used to sample a point on a gradient for something
 * too small to paint a gradient into, such as a resize handle.
 */
export function mixHex(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const out = [1, 3, 5].map((at) => {
    const a = channel(from, at)
    const b = channel(to, at)
    return Math.round(a + (b - a) * clamped)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${out.join('')}`
}

/** Default palette for annotation tools (g-snap / g-note drawing mode). */
export const annotationColors = [
  '#e94560',
  '#ff6b6b',
  '#f59e0b',
  '#facc15',
  '#4ade80',
  '#22d3ee',
  '#3b82f6',
  '#a855f7',
  '#ffffff',
  '#1a1a1a',
] as const

/** Sticky-note / highlight colors. */
export const highlightColors = [
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fbcfe8',
  '#fed7aa',
  '#e9d5ff',
] as const

export type Palette = typeof palette
