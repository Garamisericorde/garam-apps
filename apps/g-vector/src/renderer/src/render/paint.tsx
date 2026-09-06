/**
 * Paint -> SVG.
 *
 * A gradient is stored as an ANGLE and turned into endpoints here, in
 * objectBoundingBox space. That is the whole reason rotating a gradient in this
 * editor is a number and not a hunt for a handle: the document holds the angle,
 * the renderer derives the geometry, and both the on-canvas ring and a typed
 * field write the same field.
 */
import type { ReactElement } from 'react'
import type { Paint } from '../doc/types'

export interface PaintAttrs {
  /** What goes in the `fill` or `stroke` attribute. */
  value: string
  opacity: number
  /** The <linearGradient> / <radialGradient> this reference needs, if any. */
  def: ReactElement | null
}

export const NONE_ATTRS: PaintAttrs = { value: 'none', opacity: 1, def: null }

export function paintAttrs(paint: Paint, id: string): PaintAttrs {
  switch (paint.kind) {
    case 'none':
      return NONE_ATTRS

    case 'solid':
      return { value: paint.color, opacity: paint.opacity, def: null }

    case 'linear': {
      const r = (paint.angle * Math.PI) / 180
      const dx = Math.cos(r) / 2
      const dy = Math.sin(r) / 2
      return {
        value: `url(#${id})`,
        opacity: paint.opacity,
        def: (
          <linearGradient
            key={id}
            id={id}
            x1={0.5 - dx}
            y1={0.5 - dy}
            x2={0.5 + dx}
            y2={0.5 + dy}
          >
            {paint.stops.map((stop, i) => (
              <stop
                key={i}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </linearGradient>
        ),
      }
    }

    case 'radial':
      return {
        value: `url(#${id})`,
        opacity: paint.opacity,
        def: (
          <radialGradient
            key={id}
            id={id}
            cx={paint.center.x}
            cy={paint.center.y}
            r={paint.radius}
          >
            {paint.stops.map((stop, i) => (
              <stop
                key={i}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </radialGradient>
        ),
      }
  }
}

/** A short, readable description for the inspector's paint row. */
export function paintLabel(paint: Paint): string {
  switch (paint.kind) {
    case 'none':
      return 'None'
    case 'solid':
      return paint.color.toUpperCase()
    case 'linear':
      return `Linear ${Math.round(paint.angle)}°`
    case 'radial':
      return 'Radial'
  }
}

/** The colour to show in a swatch, for a paint that may not have just one. */
export function paintSwatch(paint: Paint): string {
  switch (paint.kind) {
    case 'none':
      return 'transparent'
    case 'solid':
      return paint.color
    case 'linear':
      return `linear-gradient(${paint.angle + 90}deg, ${paint.stops
        .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
        .join(', ')})`
    case 'radial':
      return `radial-gradient(circle, ${paint.stops
        .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
        .join(', ')})`
  }
}
