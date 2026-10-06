import { describe, expect, it } from 'vitest'
import { asKind, GRADIENT_END, primaryColor, rampCss, setStop, toLinear } from '../src/renderer/src/doc/paint'
import { solid, type Paint } from '../src/renderer/src/doc/types'
import { paintAttrs } from '../src/renderer/src/render/paint'

const GREEN = '#10b981'

describe('changing the kind of fill', () => {
  /**
   * Switching between a flat fill and a ramp is something people do while
   * deciding, not once at the end. A switch that resets to a stock black and
   * white makes the choice feel like a commitment.
   */
  it('carries the colour into a new gradient', () => {
    const gradient = toLinear(solid(GREEN))
    expect(gradient.stops[0].color).toBe(GREEN)
    expect(gradient.stops[1].color).toBe(GRADIENT_END)
    expect(gradient.angle).toBe(0) // left to right
  })

  it('carries the stops between the two gradients', () => {
    const linear = toLinear(solid(GREEN))
    const radial = asKind(linear, 'radial')
    expect(radial.kind).toBe('radial')
    expect(primaryColor(radial)).toBe(GREEN)

    const back = asKind(radial, 'linear')
    expect(back.kind).toBe('linear')
    expect(primaryColor(back)).toBe(GREEN)
  })

  it('falls back to the first stop when a gradient is flattened', () => {
    const flat = asKind(toLinear(solid(GREEN)), 'solid')
    expect(flat).toEqual({ kind: 'solid', color: GREEN, opacity: 1 })
  })
})

describe('stop positions', () => {
  /**
   * Dominance is a POSITION, not a colour: "mostly green, black only in the
   * corner" means moving the green stop most of the way along so the fade
   * happens late and fast.
   */
  it('moves a stop without touching its colour', () => {
    const moved = setStop(toLinear(solid(GREEN)), 0, { offset: 0.8 })
    const stops = moved.kind === 'linear' ? moved.stops : []
    expect(stops[0].offset).toBeCloseTo(0.8)
    expect(stops[0].color).toBe(GREEN)
  })

  /**
   * A ramp whose stops are out of order renders as if the two colours had
   * swapped, so dragging one past the other has to re-sort rather than invert
   * the fill under the cursor.
   */
  it('keeps the stops in order when one is dragged past the other', () => {
    // Green at 0, black at 0.5 — then green is dragged out to 0.8, past it.
    const ramp = setStop(toLinear(solid(GREEN)), 1, { offset: 0.5 })
    const moved = setStop(ramp, 0, { offset: 0.8 })
    const stops = moved.kind === 'linear' ? moved.stops : []
    expect(stops.map((s) => s.offset)).toEqual([0.5, 0.8])
    // Black really is first along the ramp now, and is listed first.
    expect(stops[0].color).toBe(GRADIENT_END)
    expect(stops[1].color).toBe(GREEN)
  })
})

describe('which way the ramp points', () => {
  /**
   * Zero is left to right and the angle grows clockwise, the way SVG measures
   * it. The dial, the degree field and the renderer all have to agree or
   * turning the gradient moves it somewhere nobody asked for.
   */
  const endpoints = (angle: number) => {
    const attrs = paintAttrs({ ...toLinear(solid(GREEN)), angle }, 'g')
    const props = attrs.def?.props as Record<string, number>
    return {
      x1: Math.round(props.x1 * 100) / 100,
      y1: Math.round(props.y1 * 100) / 100,
      x2: Math.round(props.x2 * 100) / 100,
      y2: Math.round(props.y2 * 100) / 100,
    }
  }

  it('points right at 0 degrees', () => {
    expect(endpoints(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 })
  })

  it('points down at 90 degrees', () => {
    expect(endpoints(90)).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 })
  })

  it('points up at 270 degrees', () => {
    expect(endpoints(270)).toEqual({ x1: 0.5, y1: 1, x2: 0.5, y2: 0 })
  })

  /** CSS measures from the top and clockwise, which is 90 degrees round. */
  it('offsets the CSS preview by a quarter turn', () => {
    const css = rampCss({ ...toLinear(solid(GREEN)), angle: 0 } as Paint)
    expect(css.startsWith('linear-gradient(90deg')).toBe(true)
  })
})
