import { describe, expect, it } from 'vitest'
import { createRect, emptyDoc } from '../src/renderer/src/doc/defaults'
import type { Doc } from '../src/renderer/src/doc/types'
import { snapBounds } from '../src/renderer/src/snap/engine'
import { collectTargets } from '../src/renderer/src/snap/targets'

/** One base document, so every factory below names the layer it really has. */
const DOC = emptyDoc()
const LAYER = DOC.layers[0].id


function docOf(...boxes: { x: number; y: number; width: number; height: number }[]): Doc {
  return { ...DOC, nodes: boxes.map((b) => createRect({ ...b, layer: LAYER })) }
}

/** Three 100x100 boxes with 100 units between them. */
const row = docOf(
  { x: 100, y: 100, width: 100, height: 100 },
  { x: 300, y: 100, width: 100, height: 100 },
  { x: 500, y: 100, width: 100, height: 100 },
)
const rowTargets = collectTargets(row, { exclude: [row.nodes[0].id] })

describe('alignment', () => {
  it('pulls an edge onto a neighbour and draws a guide', () => {
    const result = snapBounds({
      bounds: { x: 297, y: 400, width: 100, height: 100 },
      targets: rowTargets,
      zoom: 1,
    })
    expect(result.dx).toBeCloseTo(3)
    expect(result.guides.length).toBeGreaterThan(0)
  })

  /**
   * The threshold is in SCREEN pixels, not document units.
   *
   * The same 9-unit gap is out of reach at 100% and comfortably inside it at
   * 50%. Nothing about the document changed; only the zoom did. A threshold
   * measured in document units grabs from half a screen away when zoomed out
   * and stops working entirely when zoomed in.
   */
  it('reaches the same distance on screen at every zoom', () => {
    const targets = collectTargets(docOf({ x: 300, y: 100, width: 100, height: 100 }), {})
    const bounds = { x: 291, y: 400, width: 40, height: 40 }
    expect(snapBounds({ bounds, targets, zoom: 1 }).dx).toBe(0)
    expect(snapBounds({ bounds, targets, zoom: 0.5 }).dx).toBeCloseTo(9)
  })

  /**
   * On an exact tie a centre beats an edge, even when the edge is found first
   * and pulls the other way — so this fails loudly if the tie-break is dropped
   * for a first-past-the-post scan.
   */
  it('prefers a centre to an edge at equal distance', () => {
    const targets = collectTargets(docOf({ x: 95, y: 400, width: 120, height: 40 }), {})
    const result = snapBounds({
      bounds: { x: 100, y: 900, width: 100, height: 100 },
      targets,
      zoom: 1,
    })
    expect(result.dx).toBeCloseTo(5)
    expect(result.guides.some((g) => g.kind === 'center')).toBe(true)
  })

  it('merges objects sharing an edge into one guide spanning all of them', () => {
    const result = snapBounds({
      bounds: { x: 700, y: 102, width: 100, height: 100 },
      targets: rowTargets,
      zoom: 1,
    })
    const tops = result.guides.filter((g) => g.axis === 'y' && Math.round(g.value) === 100)
    expect(tops).toHaveLength(1)
    expect(tops[0].from).toBeLessThanOrEqual(300)
    expect(tops[0].to).toBeGreaterThanOrEqual(800)
  })
})

describe('equal spacing', () => {
  it('repeats a gap that already exists in the row', () => {
    const result = snapBounds({
      bounds: { x: 703, y: 100, width: 100, height: 100 },
      targets: collectTargets(row, {}),
      zoom: 1,
      spacing: true,
    })
    expect(result.dx).toBeCloseTo(-3)
    expect(result.spacing[0].distance).toBeCloseTo(100)
    expect(result.spacing[0].bars.length).toBeGreaterThanOrEqual(2)
  })

  it('centres an object between its two neighbours', () => {
    const gap = docOf(
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 600, y: 100, width: 100, height: 100 },
    )
    // 400 units of space, less the 100-wide box, leaves 150 a side — so the
    // centred position is x = 350.
    const result = snapBounds({
      bounds: { x: 353, y: 100, width: 100, height: 100 },
      targets: collectTargets(gap, {}),
      zoom: 1,
      spacing: true,
    })
    expect(result.dx).toBeCloseTo(-3)
    expect(result.spacing[0].distance).toBeCloseTo(150)
    expect(result.spacing[0].bars).toHaveLength(2)
  })
})

describe('resize', () => {
  /**
   * Only the edge under the cursor may latch. Without this a shape whose far
   * edge happens to sit near a neighbour jumps out from under the pointer the
   * moment the handle is grabbed.
   */
  it('snaps the dragged edge and no other', () => {
    const bounds = { x: 297, y: 400, width: 37, height: 40 }
    expect(
      snapBounds({ bounds, targets: rowTargets, zoom: 1, refs: { x: ['max'], y: [] } }).dx,
    ).toBe(0)
    expect(
      snapBounds({ bounds, targets: rowTargets, zoom: 1, refs: { x: ['min'], y: [] } }).dx,
    ).toBeCloseTo(3)
  })
})

describe('grid', () => {
  it('rounds to the pitch but draws no guide', () => {
    const targets = collectTargets(DOC, { artboard: false })
    const result = snapBounds({
      bounds: { x: 103, y: 47, width: 50, height: 50 },
      targets,
      zoom: 1,
      grid: 8,
    })
    expect(result.dx).toBeCloseTo(1)
    expect(result.dy).toBeCloseTo(1)
    expect(result.guides).toHaveLength(0)
  })

  it('stays out of the way when an object is in reach', () => {
    const result = snapBounds({
      bounds: { x: 297, y: 400, width: 100, height: 100 },
      targets: rowTargets,
      zoom: 1,
      grid: 8,
    })
    // 297 would round to 296 on the grid; the neighbour at 300 wins instead.
    expect(result.dx).toBeCloseTo(3)
  })
})
