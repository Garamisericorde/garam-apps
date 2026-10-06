/**
 * Moving between kinds of paint without losing what the user already chose.
 *
 * Switching a fill from solid to a gradient and back is something people do
 * while deciding, not once at the end — so every conversion here carries the
 * colours across. A switch that resets to a stock black-and-white ramp makes
 * the choice feel like a commitment.
 */
import type { GradientStop, LinearPaint, Paint, RadialPaint } from './types'

export type PaintKind = Paint['kind']

/** The colour a gradient fades towards when one is created from a flat fill. */
export const GRADIENT_END = '#000000'

/** Left to right — what "a gradient" means before anyone has turned it. */
export const DEFAULT_ANGLE = 0

export function gradientStops(paint: Paint): GradientStop[] | null {
  return paint.kind === 'linear' || paint.kind === 'radial' ? paint.stops : null
}

/** The colour a flat fill would take from this paint. */
export function primaryColor(paint: Paint): string {
  if (paint.kind === 'solid') return paint.color
  const stops = gradientStops(paint)
  return stops?.[0]?.color ?? '#000000'
}

function stopsFrom(paint: Paint): GradientStop[] {
  const existing = gradientStops(paint)
  if (existing && existing.length >= 2) return existing.map((stop) => ({ ...stop }))
  return [
    { offset: 0, color: primaryColor(paint), opacity: 1 },
    { offset: 1, color: GRADIENT_END, opacity: 1 },
  ]
}

function opacityOf(paint: Paint): number {
  return paint.kind === 'none' ? 1 : paint.opacity
}

export function toSolid(paint: Paint): Paint {
  return { kind: 'solid', color: primaryColor(paint), opacity: opacityOf(paint) }
}

export function toLinear(paint: Paint): LinearPaint {
  return {
    kind: 'linear',
    // A radial turned linear keeps whatever angle it had before it was radial
    // only if it was linear then; otherwise it starts left to right.
    angle: paint.kind === 'linear' ? paint.angle : DEFAULT_ANGLE,
    stops: stopsFrom(paint),
    opacity: opacityOf(paint),
  }
}

export function toRadial(paint: Paint): RadialPaint {
  return {
    kind: 'radial',
    center: paint.kind === 'radial' ? paint.center : { x: 0.5, y: 0.5 },
    radius: paint.kind === 'radial' ? paint.radius : 0.5,
    stops: stopsFrom(paint),
    opacity: opacityOf(paint),
  }
}

export function asKind(paint: Paint, kind: PaintKind): Paint {
  switch (kind) {
    case 'none':
      return { kind: 'none' }
    case 'solid':
      return toSolid(paint)
    case 'linear':
      return toLinear(paint)
    case 'radial':
      return toRadial(paint)
  }
}

/**
 * Edits one stop.
 *
 * The stops stay sorted by offset, because a ramp whose stops are out of order
 * renders as if the two colours had swapped — dragging one stop past the other
 * would otherwise make the fill jump inside out.
 */
export function setStop(paint: Paint, index: number, patch: Partial<GradientStop>): Paint {
  const stops = gradientStops(paint)
  if (!stops || index < 0 || index >= stops.length) return paint
  const next = stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop))
  next.sort((a, b) => a.offset - b.offset)
  return { ...paint, stops: next } as Paint
}

/** The same ramp as CSS, for a swatch or a preview bar. */
export function rampCss(paint: Paint): string {
  switch (paint.kind) {
    case 'none':
      return 'transparent'
    case 'solid':
      return paint.color
    case 'linear':
      // CSS measures from the top and clockwise; the document measures from the
      // positive x axis, the way SVG and every angle field elsewhere does.
      return `linear-gradient(${paint.angle + 90}deg, ${stopList(paint.stops)})`
    case 'radial':
      return `radial-gradient(circle, ${stopList(paint.stops)})`
  }
}

/** The ramp laid out flat, left to right — what a stop editor shows. */
export function flatRampCss(paint: Paint): string {
  const stops = gradientStops(paint)
  return stops ? `linear-gradient(90deg, ${stopList(stops)})` : rampCss(paint)
}

function stopList(stops: readonly GradientStop[]): string {
  return stops
    .map((stop) => `${withOpacity(stop.color, stop.opacity)} ${Math.round(stop.offset * 100)}%`)
    .join(', ')
}

/** `#rrggbb` plus an alpha, as an `#rrggbbaa` CSS colour. */
function withOpacity(color: string, opacity: number): string {
  if (opacity >= 1) return color
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
  return `${color}${alpha.toString(16).padStart(2, '0')}`
}
