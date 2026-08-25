/**
 * @garam/theme — token degerlerine JS tarafindan erisim.
 *
 * CSS tarafi tek kaynak; burasi Konva/canvas gibi CSS degiskeni okuyamayan
 * yerler icin ayna. Bir tokeni degistirirken tokens.css ile birlikte guncelle.
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

/** Anotasyon araclarinin varsayilan renk paleti (g-snap / g-note cizim modu). */
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

/** Yapistirilabilir not / vurgu renkleri. */
export const highlightColors = [
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fbcfe8',
  '#fed7aa',
  '#e9d5ff',
] as const

export type Palette = typeof palette
