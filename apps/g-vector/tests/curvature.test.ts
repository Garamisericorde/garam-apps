import { describe, expect, it } from 'vitest'
import { refitCurvature } from '../src/renderer/src/doc/curvature'
import { createDrawnPath, emptyDoc } from '../src/renderer/src/doc/defaults'
import type { Vec } from '../src/renderer/src/doc/geom'
import { corner, segmentCubic } from '../src/renderer/src/doc/path'
import type { Doc } from '../src/renderer/src/doc/types'
import { constrainAngle } from '../src/renderer/src/tools/pathDrag'
import { drawGhost } from '../src/renderer/src/tools/penTool'

/** One base document, so every factory below names the layer it really has. */
const DOC = emptyDoc()
const LAYER = DOC.layers[0].id


const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x

/**
 * The signs of the turns in a segment's control polygon.
 *
 * A cubic bends the way its control polygon turns, so a sign change between the
 * two turns means the curve doubles back — it bulges out one way, then comes
 * back the other. That is what a kink looks like in numbers.
 */
function polygonTurns(sp: ReturnType<typeof refitCurvature>, segment: number): number[] {
  const c = segmentCubic(sp, segment)
  const legs = [sub(c.c1, c.p0), sub(c.c2, c.c1), sub(c.p1, c.c2)]
  return [cross(legs[0], legs[1]), cross(legs[1], legs[2])]
}

function bendsOneWay(turns: number[]): boolean {
  // A zero turn is a straight stretch, which does not count as a reversal.
  const nonZero = turns.filter((t) => Math.abs(t) > 1e-6)
  return nonZero.length < 2 || Math.sign(nonZero[0]) === Math.sign(nonZero[1])
}

describe('curvature end conditions', () => {
  /**
   * The bug this pins: reflecting the neighbour through an open end gives that
   * end a tangent parallel to its own chord, so the last segment arrived dead
   * straight, the whole turn piled up at its start, and the control polygon
   * doubled back — a visible kink just after the point you had placed.
   *
   * The geometry below is the one that showed it: a long run down-right into a
   * point, then away down-left.
   */
  it('does not kink on an asymmetric turn', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(88, 97), corner(373, 476), corner(190, 870)],
    })
    expect(bendsOneWay(polygonTurns(fitted, 0))).toBe(true)
    expect(bendsOneWay(polygonTurns(fitted, 1))).toBe(true)
  })

  it('makes three points on a symmetric arc into a symmetric curve', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(0, 0), corner(50, 40), corner(100, 0)],
    })
    const first = segmentCubic(fitted, 0)
    const second = segmentCubic(fitted, 1)
    // Mirroring the second segment about x = 50 has to reproduce the first.
    expect(100 - second.c2.x).toBeCloseTo(first.c1.x)
    expect(second.c2.y).toBeCloseTo(first.c1.y)
    expect(100 - second.c1.x).toBeCloseTo(first.c2.x)
    expect(second.c1.y).toBeCloseTo(first.c2.y)
  })

  it('keeps two points a straight line', () => {
    const fitted = refitCurvature({ closed: false, anchors: [corner(0, 0), corner(90, 30)] })
    const c = segmentCubic(fitted, 0)
    // Both controls sit on the chord, so there is nothing to bend.
    expect(cross(sub(c.c1, c.p0), sub(c.p1, c.p0))).toBeCloseTo(0)
    expect(cross(sub(c.c2, c.p0), sub(c.p1, c.p0))).toBeCloseTo(0)
  })

  it('does not balloon the end segment next to a corner', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(0, 0), { ...corner(50, 40), corner: true }, corner(100, 0)],
    })
    // With no tangent to inherit from the corner, the end handle falls back to
    // a third of the chord rather than one and a half of it.
    const chord = Math.hypot(50, 40)
    expect(Math.hypot(fitted.anchors[0].out.x, fitted.anchors[0].out.y)).toBeCloseTo(chord / 3)
  })
})

describe('the drawing preview', () => {
  function draftDoc(): { doc: Doc; draft: { nodeId: string; subpath: number } } {
    const node = createDrawnPath(LAYER, [
      { closed: false, anchors: [corner(0, 0), corner(100, 0), corner(150, 80)] },
    ])
    return { doc: { ...DOC, nodes: [node] }, draft: { nodeId: node.id, subpath: 0 } }
  }

  /**
   * A curvature click refits EVERY segment, so previewing only the new one
   * showed a curve the click would not produce. The preview covers the whole
   * subpath and the committed outline steps aside for it.
   */
  it('previews the whole subpath for the curvature tool', () => {
    const { doc, draft } = draftDoc()
    const ghost = drawGhost(doc, draft, { x: 200, y: 200 }, true)
    expect(ghost?.segments).toHaveLength(3)
    expect(ghost?.replaces).toEqual({ nodeId: draft.nodeId, subpath: 0 })
  })

  it('previews only the new segment for the pen', () => {
    const { doc, draft } = draftDoc()
    const ghost = drawGhost(doc, draft, { x: 200, y: 200 }, false)
    expect(ghost?.segments).toHaveLength(1)
    // The pen changes nothing that is already drawn, so the outline stays.
    expect(ghost?.replaces).toBeNull()
    expect(ghost?.segments[0].p1).toEqual({ x: 200, y: 200 })
  })
})

describe('drawn paths', () => {
  /**
   * An open path with a fill paints the region between its ends, so the shape
   * default turned a three-point curve into a swelling blob.
   */
  it('carry a stroke and no fill', () => {
    const node = createDrawnPath(LAYER, [{ closed: false, anchors: [corner(0, 0), corner(10, 10)] }])
    expect(node.fill.kind).toBe('none')
    expect(node.stroke.paint.kind).toBe('solid')
    expect(node.stroke.width).toBeGreaterThan(0)
  })
})

describe('Shift while drawing', () => {
  it('rounds onto the nearest 45 degrees, keeping the distance', () => {
    const from = { x: 100, y: 100 }
    const to = { x: 200, y: 110 } // 5.7 degrees off horizontal
    const snapped = constrainAngle(from, to, 45)
    expect(snapped.y).toBeCloseTo(100)
    expect(Math.hypot(snapped.x - from.x, snapped.y - from.y)).toBeCloseTo(
      Math.hypot(to.x - from.x, to.y - from.y),
    )
  })

  it('reaches the diagonals too', () => {
    const snapped = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 }, 45)
    expect(snapped.x).toBeCloseTo(snapped.y)
  })
})
