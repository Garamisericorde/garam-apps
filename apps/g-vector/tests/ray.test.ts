import { describe, expect, it } from 'vitest'
import { createDrawnPath, emptyDoc } from '../src/renderer/src/doc/defaults'
import { corner } from '../src/renderer/src/doc/path'
import type { Doc } from '../src/renderer/src/doc/types'
import { snapAlongRay } from '../src/renderer/src/snap/ray'
import { collectTargets } from '../src/renderer/src/snap/targets'
import { anchorPoints } from '../src/renderer/src/tools/paths'

/** One base document, so every factory below names the layer it really has. */
const DOC = emptyDoc()
const LAYER = DOC.layers[0].id


/**
 * Two sides of a triangle, drawn already: down the left, along the bottom.
 * The pen is now at the bottom-right corner, heading back up.
 */
function triangleInProgress(): Doc {
  const node = createDrawnPath(LAYER, [
    { closed: false, anchors: [corner(200, 300), corner(200, 600), corner(600, 600)] },
  ])
  return { ...DOC, nodes: [node] }
}

function targetsOf(doc: Doc) {
  return collectTargets(doc, { points: anchorPoints(doc) })
}

const UP_LEFT = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }
const ORIGIN = { x: 600, y: 600 }

describe('snapping along a constrained ray', () => {
  /**
   * The case this exists for: Shift holds the line at 45 degrees and the point
   * still has to stop level with the left edge. A two-axis snap cannot do it —
   * any pull it applies takes the point off the ray, which is the one thing
   * Shift was asked to guarantee — so the direction stays fixed and the snap
   * chooses the distance.
   */
  it('slides the point until it lines up with an edge', () => {
    const doc = triangleInProgress()
    // The ray crosses x = 200 at 400·sqrt(2) along it.
    const crossing = 400 * Math.SQRT2
    const result = snapAlongRay({
      origin: ORIGIN,
      direction: UP_LEFT,
      distance: crossing - 6,
      targets: targetsOf(doc),
      zoom: 1,
      threshold: 9,
    })
    expect(result?.distance).toBeCloseTo(crossing)

    const point = {
      x: ORIGIN.x + UP_LEFT.x * result!.distance,
      y: ORIGIN.y + UP_LEFT.y * result!.distance,
    }
    expect(point.x).toBeCloseTo(200)
    expect(result!.guides.some((g) => g.axis === 'x' && Math.abs(g.value - 200) < 0.01)).toBe(true)
  })

  it('stays put when nothing is within reach', () => {
    const doc = triangleInProgress()
    const result = snapAlongRay({
      origin: ORIGIN,
      direction: UP_LEFT,
      distance: 100,
      targets: targetsOf(doc),
      zoom: 1,
      threshold: 9,
    })
    expect(result).toBeNull()
  })

  /** The reach is in screen pixels, so zooming out lets it grab from further. */
  it('reaches the same distance on screen at every zoom', () => {
    const doc = triangleInProgress()
    const crossing = 400 * Math.SQRT2
    const ask = (zoom: number) =>
      snapAlongRay({
        origin: ORIGIN,
        direction: UP_LEFT,
        distance: crossing - 20,
        targets: targetsOf(doc),
        zoom,
        threshold: 9,
      })
    expect(ask(1)).toBeNull()
    expect(ask(0.25)?.distance).toBeCloseTo(crossing)
  })

  it('ignores anything behind the point it started from', () => {
    const doc = triangleInProgress()
    // Heading down-right, away from everything: x = 200 is now behind us, and a
    // negative distance along the ray is not somewhere the user is drawing.
    const result = snapAlongRay({
      origin: ORIGIN,
      direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      distance: 400 * Math.SQRT2,
      targets: targetsOf(doc),
      zoom: 1,
      threshold: 9,
    })
    expect(result === null || result.distance > 0).toBe(true)
  })

  it('survives a ray that runs parallel to an axis', () => {
    const doc = triangleInProgress()
    // Straight up from the corner never crosses any x, and dividing by that
    // zero would put the point at infinity.
    const result = snapAlongRay({
      origin: ORIGIN,
      direction: { x: 0, y: -1 },
      distance: 296,
      targets: targetsOf(doc),
      zoom: 1,
      threshold: 9,
    })
    expect(result?.distance).toBeCloseTo(300) // y = 300, the top of the left edge
    expect(Number.isFinite(result!.distance)).toBe(true)
  })
})
