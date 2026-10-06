import { describe, expect, it } from 'vitest'
import type { AnchorRef } from '../src/renderer/src/doc/anchors'
import { createDrawnPath, emptyDoc } from '../src/renderer/src/doc/defaults'
import { rotationMatrix } from '../src/renderer/src/doc/geom'
import { corner } from '../src/renderer/src/doc/path'
import {
  loneSegment,
  measureSegment,
  segmentFromAnchors,
  setSegmentAngle,
  setSegmentLength,
  type SegmentRef,
} from '../src/renderer/src/doc/segment'
import type { Doc, PathNode } from '../src/renderer/src/doc/types'

const DOC = emptyDoc()
const LAYER = DOC.layers[0].id

/** A single run: (100, 100) to (200, 100), pointing right and 100 long. */
function line(): { doc: Doc; ref: SegmentRef } {
  const node = createDrawnPath(LAYER, [
    { closed: false, anchors: [corner(100, 100), corner(200, 100)] },
  ])
  return {
    doc: { ...DOC, nodes: [node] },
    ref: { nodeId: node.id, subpath: 0, from: 0, to: 1 },
  }
}

function pathOf(doc: Doc, id: string): PathNode {
  const node = doc.nodes.find((n) => n.id === id)
  if (!node || node.type !== 'path') throw new Error('not a path')
  return node
}

describe('measuring a segment', () => {
  it('reads the length and the angle of the line between two points', () => {
    const { doc, ref } = line()
    const measured = measureSegment(doc, ref)
    expect(measured?.length).toBeCloseTo(100)
    expect(measured?.angle).toBeCloseTo(0) // pointing right
  })

  /** Zero points right and the angle grows clockwise, because y points down. */
  it('reports a downward run as a positive angle', () => {
    const node = createDrawnPath(LAYER, [
      { closed: false, anchors: [corner(0, 0), corner(100, 100)] },
    ])
    const doc: Doc = { ...DOC, nodes: [node] }
    const measured = measureSegment(doc, { nodeId: node.id, subpath: 0, from: 0, to: 1 })
    expect(measured?.angle).toBeCloseTo(45)
  })

  it('measures through the node transform', () => {
    const { doc, ref } = line()
    const rotated: Doc = {
      ...doc,
      nodes: [{ ...pathOf(doc, ref.nodeId), transform: rotationMatrix(90, { x: 0, y: 0 }) }],
    }
    const measured = measureSegment(rotated, ref)
    expect(measured?.length).toBeCloseTo(100)
    expect(measured?.angle).toBeCloseTo(90)
  })
})

describe('setting the angle', () => {
  /**
   * `from` is the pivot and `to` is what swings. Something has to be — turning
   * about the midpoint would move a point the user was not talking about — and
   * which one it is comes from the order the two were selected in.
   */
  it('swings the second end and leaves the first alone', () => {
    const { doc, ref } = line()
    const turned = pathOf(setSegmentAngle(doc, ref, 90), ref.nodeId)
    expect(turned.subpaths[0].anchors[0].p).toEqual({ x: 100, y: 100 })
    expect(turned.subpaths[0].anchors[1].p.x).toBeCloseTo(100)
    expect(turned.subpaths[0].anchors[1].p.y).toBeCloseTo(200)
  })

  it('keeps the length while it turns', () => {
    const { doc, ref } = line()
    const turned = setSegmentAngle(doc, ref, 137)
    expect(measureSegment(turned, ref)?.length).toBeCloseTo(100)
    expect(measureSegment(turned, ref)?.angle).toBeCloseTo(137)
  })

  /**
   * The anchors live in the node's own space, so an edit on a rotated path has
   * to come back through the transform. Without that, typing 90 into a path
   * that is itself turned puts the point somewhere else entirely.
   */
  it('lands correctly on a rotated path', () => {
    const { doc, ref } = line()
    const rotated: Doc = {
      ...doc,
      nodes: [{ ...pathOf(doc, ref.nodeId), transform: rotationMatrix(90, { x: 0, y: 0 }) }],
    }
    const turned = setSegmentAngle(rotated, ref, 180)
    expect(measureSegment(turned, ref)?.angle).toBeCloseTo(180)
    expect(measureSegment(turned, ref)?.length).toBeCloseTo(100)
  })
})

describe('setting the length', () => {
  it('stretches along the same direction', () => {
    const { doc, ref } = line()
    const longer = setSegmentLength(doc, ref, 250)
    const measured = measureSegment(longer, ref)
    expect(measured?.length).toBeCloseTo(250)
    expect(measured?.angle).toBeCloseTo(0)
    expect(pathOf(longer, ref.nodeId).subpaths[0].anchors[1].p.x).toBeCloseTo(350)
  })

  it('refuses a length of nothing', () => {
    const { doc, ref } = line()
    expect(setSegmentLength(doc, ref, 0)).toBe(doc)
  })
})

describe('finding the segment to edit', () => {
  /**
   * The ORDER of the two decides which end moves. Deriving it from path order
   * instead would make "which point does this field move" depend on the
   * direction the path happened to be drawn in — invisible and arbitrary.
   */
  it('keeps the order the points were given in', () => {
    const { doc, ref } = line()
    const forwards: AnchorRef[] = [
      { nodeId: ref.nodeId, subpath: 0, index: 0 },
      { nodeId: ref.nodeId, subpath: 0, index: 1 },
    ]
    expect(segmentFromAnchors(doc, forwards)).toEqual(ref)
    expect(segmentFromAnchors(doc, [...forwards].reverse())).toEqual({
      ...ref,
      from: 1,
      to: 0,
    })
  })

  it('moves the other end once the order is flipped', () => {
    const { doc, ref } = line()
    const flipped = { ...ref, from: 1, to: 0 }
    const turned = pathOf(setSegmentAngle(doc, flipped, 180), ref.nodeId)
    // Anchor 1 is the pivot now, so anchor 0 is the one that swung.
    expect(turned.subpaths[0].anchors[1].p).toEqual({ x: 200, y: 100 })
    expect(turned.subpaths[0].anchors[0].p.x).toBeCloseTo(100)
  })

  it('ignores two points that are not neighbours', () => {
    const node = createDrawnPath(LAYER, [
      { closed: false, anchors: [corner(0, 0), corner(50, 0), corner(100, 0)] },
    ])
    const doc: Doc = { ...DOC, nodes: [node] }
    const refs: AnchorRef[] = [
      { nodeId: node.id, subpath: 0, index: 0 },
      { nodeId: node.id, subpath: 0, index: 2 },
    ]
    expect(segmentFromAnchors(doc, refs)).toBeNull()
  })

  /** A closed path joins its last point back to its first; that join counts. */
  it('takes the closing run of a closed path', () => {
    const node = createDrawnPath(LAYER, [
      { closed: true, anchors: [corner(0, 0), corner(50, 0), corner(100, 40)] },
    ])
    const doc: Doc = { ...DOC, nodes: [node] }
    const found = segmentFromAnchors(doc, [
      { nodeId: node.id, subpath: 0, index: 2 },
      { nodeId: node.id, subpath: 0, index: 0 },
    ])
    expect(found).toEqual({ nodeId: node.id, subpath: 0, from: 2, to: 0 })
  })

  /**
   * A plain two-point line needs no selection at all: there is nothing else the
   * angle could be about, and asking for two clicks first would be ceremony.
   */
  it('finds the only segment of a two-point line on its own', () => {
    const { doc, ref } = line()
    expect(loneSegment(doc, [ref.nodeId])).toEqual(ref)
  })

  it('declines when the path has more than one run', () => {
    const node = createDrawnPath(LAYER, [
      { closed: false, anchors: [corner(0, 0), corner(50, 0), corner(100, 0)] },
    ])
    const doc: Doc = { ...DOC, nodes: [node] }
    expect(loneSegment(doc, [node.id])).toBeNull()
  })
})
