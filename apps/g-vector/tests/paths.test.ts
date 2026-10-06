import { describe, expect, it } from 'vitest'
import {
  ensurePath,
  moveAnchors,
  openEndAt,
  removeAnchors,
  reverseSubPathIn,
  setHandle,
  type AnchorRef,
} from '../src/renderer/src/doc/anchors'
import { localBounds } from '../src/renderer/src/doc/bounds'
import { refitCurvature } from '../src/renderer/src/doc/curvature'
import { createPath, createRect, emptyDoc, toPathNode } from '../src/renderer/src/doc/defaults'
import { rotationMatrix, type Vec } from '../src/renderer/src/doc/geom'
import {
  corner,
  cubicAt,
  insertAnchor,
  reverseSubPath,
  segmentCubic,
  type SubPath,
} from '../src/renderer/src/doc/path'
import type { Doc, PathNode } from '../src/renderer/src/doc/types'
import { penClick } from '../src/renderer/src/tools/penTool'

/** One base document, so every factory below names the layer it really has. */
const DOC = emptyDoc()
const LAYER = DOC.layers[0].id


/** A single S-curve: two anchors, both with handles. */
function curve(): SubPath {
  return {
    closed: false,
    anchors: [
      { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 40, y: 0 } },
      { p: { x: 100, y: 60 }, in: { x: -40, y: 0 }, out: { x: 0, y: 0 } },
    ],
  }
}

function sample(sp: SubPath, segment: number, t: number): Vec {
  const c = segmentCubic(sp, segment)
  return cubicAt(c.p0, c.c1, c.c2, c.p1, t)
}

function pathOf(doc: Doc, id: string): PathNode {
  const node = doc.nodes.find((n) => n.id === id)
  if (!node || node.type !== 'path') throw new Error('not a path')
  return node
}

describe('inserting an anchor', () => {
  /**
   * The single most important property of a path editor: adding a point must
   * not move the curve. An insert that reshapes the outline by even a pixel is
   * what makes people stop trusting the tool and start undoing everything.
   */
  it('leaves the curve exactly where it was', () => {
    const before = curve()
    const after = insertAnchor(before, 0, 0.4)
    expect(after.anchors).toHaveLength(3)

    for (let k = 0; k <= 20; k++) {
      const u = k / 20
      const original = sample(before, 0, u)
      // The split point lands at t = 0.4, so the first half covers u <= 0.4.
      const split =
        u <= 0.4 ? sample(after, 0, u / 0.4) : sample(after, 1, (u - 0.4) / 0.6)
      expect(split.x).toBeCloseTo(original.x, 6)
      expect(split.y).toBeCloseTo(original.y, 6)
    }
  })
})

describe('curvature fit', () => {
  it('gives every interior point two opposite handles', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(0, 0), corner(50, 40), corner(100, 0)],
    })
    const middle = fitted.anchors[1]
    expect(middle.in.x).toBeCloseTo(-middle.out.x)
    expect(middle.in.y).toBeCloseTo(-middle.out.y)
    expect(Math.hypot(middle.out.x, middle.out.y)).toBeGreaterThan(0)
  })

  it('keeps a corner sharp through a refit', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(0, 0), { ...corner(50, 40), corner: true }, corner(100, 0)],
    })
    expect(fitted.anchors[1].in).toEqual({ x: 0, y: 0 })
    expect(fitted.anchors[1].out).toEqual({ x: 0, y: 0 })
  })

  /**
   * The curve has to pass THROUGH the clicked points — that is the whole
   * proposition of the tool, as against a pen where the points are only
   * suggestions.
   */
  it('passes through the points it was given', () => {
    const points = [corner(0, 0), corner(50, 40), corner(120, 10), corner(160, 70)]
    const fitted = refitCurvature({ closed: false, anchors: points })
    for (let i = 0; i < points.length - 1; i++) {
      expect(sample(fitted, i, 0)).toEqual(points[i].p)
      expect(sample(fitted, i, 1)).toEqual(points[i + 1].p)
    }
  })

  it('curves at both ends of an open path instead of flattening', () => {
    const fitted = refitCurvature({
      closed: false,
      anchors: [corner(0, 0), corner(50, 40), corner(100, 0)],
    })
    // The endpoints have no outward handle, but the handle facing INTO the path
    // must exist or the first and last segments come out as straight lines.
    expect(Math.hypot(fitted.anchors[0].out.x, fitted.anchors[0].out.y)).toBeGreaterThan(0)
    expect(Math.hypot(fitted.anchors[2].in.x, fitted.anchors[2].in.y)).toBeGreaterThan(0)
  })
})

describe('moving anchors', () => {
  it('moves a rotated path the way the cursor went, not the way it is turned', () => {
    const node = createPath(LAYER, [{ closed: false, anchors: [corner(0, 0), corner(100, 0)] }])
    const rotated: PathNode = { ...node, transform: rotationMatrix(90, { x: 0, y: 0 }) }
    const doc: Doc = { ...DOC, nodes: [rotated] }
    const ref: AnchorRef = { nodeId: node.id, subpath: 0, index: 1 }

    const moved = pathOf(moveAnchors(doc, [ref], { x: 0, y: 10 }), node.id)
    // A 90-degree rotation maps local +x onto world +y, so pulling the point
    // 10 down the screen has to be stored as 10 along the path's own x.
    expect(moved.subpaths[0].anchors[1].p.x).toBeCloseTo(110)
    expect(moved.subpaths[0].anchors[1].p.y).toBeCloseTo(0)
  })

  it('carries the handles with the point', () => {
    const node = createPath(LAYER, [curve()])
    const doc: Doc = { ...DOC, nodes: [node] }
    const ref: AnchorRef = { nodeId: node.id, subpath: 0, index: 0 }
    const moved = pathOf(moveAnchors(doc, [ref], { x: 5, y: 7 }), node.id)
    expect(moved.subpaths[0].anchors[0].p).toEqual({ x: 5, y: 7 })
    expect(moved.subpaths[0].anchors[0].out).toEqual({ x: 40, y: 0 })
  })
})

describe('handles', () => {
  const smooth: SubPath = {
    closed: false,
    anchors: [
      corner(0, 0),
      { p: { x: 100, y: 0 }, in: { x: -30, y: 0 }, out: { x: 60, y: 0 } },
      corner(200, 0),
    ],
  }

  it('swings the far handle but keeps its own length', () => {
    const node = createPath(LAYER, [smooth])
    const doc: Doc = { ...DOC, nodes: [node] }
    const ref: AnchorRef = { nodeId: node.id, subpath: 0, index: 1 }

    const after = pathOf(setHandle(doc, ref, 'out', { x: 0, y: 40 }, { mirror: true }), node.id)
    const anchor = after.subpaths[0].anchors[1]
    expect(anchor.out).toEqual({ x: 0, y: 40 })
    // The far handle was 30 long and pointed the other way; it must still be 30
    // long and still point the other way.
    expect(anchor.in.x).toBeCloseTo(0)
    expect(anchor.in.y).toBeCloseTo(-30)
  })

  it('leaves the far handle alone when the pair is broken', () => {
    const node = createPath(LAYER, [smooth])
    const doc: Doc = { ...DOC, nodes: [node] }
    const ref: AnchorRef = { nodeId: node.id, subpath: 0, index: 1 }

    const after = pathOf(setHandle(doc, ref, 'out', { x: 0, y: 40 }, { mirror: false }), node.id)
    expect(after.subpaths[0].anchors[1].in).toEqual({ x: -30, y: 0 })
  })

  it('mirrors exactly when the pair is being created', () => {
    const node = createPath(LAYER, [{ closed: false, anchors: [corner(0, 0)] }])
    const doc: Doc = { ...DOC, nodes: [node] }
    const ref: AnchorRef = { nodeId: node.id, subpath: 0, index: 0 }

    const after = pathOf(
      setHandle(doc, ref, 'out', { x: 20, y: 10 }, { mirror: true, symmetric: true }),
      node.id,
    )
    expect(after.subpaths[0].anchors[0].in).toEqual({ x: -20, y: -10 })
  })
})

describe('removing anchors', () => {
  it('drops a subpath that no longer draws anything', () => {
    const node = createPath(LAYER, [{ closed: false, anchors: [corner(0, 0), corner(10, 0)] }])
    const doc: Doc = { ...DOC, nodes: [node] }
    const after = removeAnchors(doc, [{ nodeId: node.id, subpath: 0, index: 1 }])
    // One point left is not a path, so the node goes with it.
    expect(after.nodes).toHaveLength(0)
  })
})

describe('live shapes', () => {
  /**
   * The direct tool shows a rectangle's anchors from a throwaway conversion and
   * only converts for real on the first edit — so the two conversions have to
   * agree, or the anchor you grabbed is not the anchor that moves.
   */
  it('converts to a path covering exactly the same box', () => {
    const rect = createRect({ layer: LAYER, x: 10, y: 20, width: 100, height: 60, radius: 12 })
    const doc: Doc = { ...DOC, nodes: [rect] }

    const virtual = toPathNode(rect)
    const real = pathOf(ensurePath(doc, rect.id), rect.id)
    expect(real.subpaths).toEqual(virtual.subpaths)

    const box = localBounds(real)
    expect(box.x).toBeCloseTo(10)
    expect(box.y).toBeCloseTo(20)
    expect(box.width).toBeCloseTo(100)
    expect(box.height).toBeCloseTo(60)
  })
})

describe('the pen', () => {
  it('starts a path and offers the new point for a handle drag', () => {
    const result = penClick({ doc: DOC, draft: null, point: { x: 10, y: 10 }, onAnchor: null })
    expect(result.draft).not.toBeNull()
    expect(result.handle?.ref.index).toBe(0)
    expect(pathOf(result.doc, result.selection[0]).subpaths[0].anchors).toHaveLength(1)
  })

  it('closes the path when the first point is clicked again', () => {
    let doc = DOC
    let draft = null as ReturnType<typeof penClick>['draft']
    for (const point of [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]) {
      const step = penClick({ doc, draft, point, onAnchor: null })
      doc = step.doc
      draft = step.draft
    }
    const id = draft!.nodeId
    const closing = penClick({
      doc,
      draft,
      point: { x: 0, y: 0 },
      onAnchor: { nodeId: id, subpath: 0, index: 0 },
    })
    expect(closing.draft).toBeNull()
    expect(pathOf(closing.doc, id).subpaths[0].closed).toBe(true)
    expect(pathOf(closing.doc, id).subpaths[0].anchors).toHaveLength(3)
  })

  it('retracts the outgoing handle when the last point is clicked', () => {
    const first = penClick({ doc: DOC, draft: null, point: { x: 0, y: 0 }, onAnchor: null })
    const id = first.draft!.nodeId
    const withHandle = setHandle(
      first.doc,
      { nodeId: id, subpath: 0, index: 0 },
      'out',
      { x: 30, y: 0 },
      { mirror: true, symmetric: true },
    )
    const retracted = penClick({
      doc: withHandle,
      draft: first.draft,
      point: { x: 0, y: 0 },
      onAnchor: { nodeId: id, subpath: 0, index: 0 },
    })
    expect(pathOf(retracted.doc, id).subpaths[0].anchors[0].out).toEqual({ x: 0, y: 0 })
    // The incoming handle is untouched: only the direction the next segment
    // leaves in was being changed.
    expect(pathOf(retracted.doc, id).subpaths[0].anchors[0].in).toEqual({ x: -30, y: -0 })
  })
})

describe('picking a path back up', () => {
  const open = (): SubPath => ({
    closed: false,
    anchors: [
      { p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 20, y: 0 } },
      { p: { x: 100, y: 0 }, in: { x: -30, y: 10 }, out: { x: 40, y: 0 } },
      { p: { x: 200, y: 50 }, in: { x: -10, y: -20 }, out: { x: 0, y: 0 } },
    ],
  })

  /**
   * Reversal is what lets a drawing tool continue from the START of a path: the
   * tools only ever append, so the end being grown has to become the last
   * anchor. The curve must not move while that happens.
   */
  it('reverses a subpath without changing the curve', () => {
    const before = open()
    const after = reverseSubPath(before)
    expect(after.anchors.map((a) => a.p)).toEqual(
      [...before.anchors].reverse().map((a) => a.p),
    )
    // Walking backwards, the handle the curve left along is the one it now
    // arrives along.
    expect(after.anchors[0].in).toEqual(before.anchors[2].out)
    expect(after.anchors[0].out).toEqual(before.anchors[2].in)

    // Sampled point for point, the two describe the same shape.
    for (let i = 0; i < 2; i++) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const forward = sample(before, i, t)
        const backward = sample(after, 1 - i, 1 - t)
        expect(backward.x).toBeCloseTo(forward.x, 6)
        expect(backward.y).toBeCloseTo(forward.y, 6)
      }
    }
  })

  it('reverses in place inside the document', () => {
    const node = createPath(LAYER, [open()])
    const doc: Doc = { ...DOC, nodes: [node] }
    const after = pathOf(reverseSubPathIn(doc, node.id, 0), node.id)
    expect(after.subpaths[0].anchors[0].p).toEqual({ x: 200, y: 50 })
  })

  /**
   * Only the two loose ends resume; an interior point is an edit. The pen has
   * always drawn that line, and the path itself says which is which.
   */
  it('knows which anchors are loose ends', () => {
    const node = createPath(LAYER, [open()])
    const doc: Doc = { ...DOC, nodes: [node] }
    const at = (index: number): string | null =>
      openEndAt(doc, { nodeId: node.id, subpath: 0, index })
    expect(at(0)).toBe('start')
    expect(at(2)).toBe('end')
    expect(at(1)).toBeNull()
  })

  it('has no loose ends once the path is closed', () => {
    const node = createPath(LAYER, [{ ...open(), closed: true }])
    const doc: Doc = { ...DOC, nodes: [node] }
    expect(openEndAt(doc, { nodeId: node.id, subpath: 0, index: 0 })).toBeNull()
    expect(openEndAt(doc, { nodeId: node.id, subpath: 0, index: 2 })).toBeNull()
  })
})
