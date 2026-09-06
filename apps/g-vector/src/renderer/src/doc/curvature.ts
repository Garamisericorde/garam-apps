/**
 * The curvature tool's maths: a smooth curve THROUGH a set of points.
 *
 * This is the thing the pen cannot do. With a pen you place control handles and
 * the curve happens somewhere nearby; here you place the points the curve has
 * to pass through and the handles are derived. It is the difference between
 * describing a shape and drawing one.
 *
 * Interior points get the Catmull-Rom tangent (P(i+1) - P(i-1)) / 2, which is
 * what makes the curve smooth as it passes through them.
 */
import type { Vec } from './geom'
import type { Anchor, SubPath } from './path'

const ZERO: Vec = { x: 0, y: 0 }

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
const isZero = (a: Vec): boolean => Math.abs(a.x) < 1e-9 && Math.abs(a.y) < 1e-9

/**
 * Refits every smooth anchor's handles from its neighbours.
 *
 * Anchors flagged `corner` are left with no handles at all, so a curvature path
 * can hold sharp points without the refit quietly rounding them off on the next
 * click.
 */
export function refitCurvature(sp: SubPath): SubPath {
  const points = sp.anchors
  const n = points.length
  if (n < 2) {
    return { closed: sp.closed, anchors: points.map((a) => ({ ...a, in: ZERO, out: ZERO })) }
  }

  const tangents = tangentsFor(points, sp.closed)

  const anchors: Anchor[] = points.map((anchor, i) => {
    if (anchor.corner) return { ...anchor, in: ZERO, out: ZERO }
    const t = scale(tangents[i], 1 / 3)
    return { ...anchor, in: scale(t, -1), out: t }
  })

  if (!sp.closed) {
    // The open ends have nothing beyond them to curve towards.
    anchors[0] = { ...anchors[0], in: ZERO }
    anchors[n - 1] = { ...anchors[n - 1], out: ZERO }
  }

  return { closed: sp.closed, anchors }
}

/**
 * The tangent at every point.
 *
 * Interior points use the Catmull-Rom average of their neighbours. The two ends
 * of an open path are the interesting case, and the obvious answer is wrong:
 * reflecting the neighbour through the endpoint gives that end a tangent
 * PARALLEL TO ITS OWN CHORD, so the last segment arrives dead straight while
 * the whole turn piles up at its start — and, because the control polygon then
 * doubles back on itself, the curve bulges out to one side before straightening.
 * Drawing three points and watching the third segment kink is exactly that.
 *
 * So the ends use the natural cubic condition instead: the second derivative
 * vanishes there, which works out to T0 = (3·(P1 - P0) - T1) / 2. The curvature
 * is then shared across the segment rather than dumped at one end, and three
 * points evenly placed on an arc produce a symmetrical arc.
 */
function tangentsFor(points: readonly Anchor[], closed: boolean): Vec[] {
  const n = points.length
  const at = (i: number): Vec => points[((i % n) + n) % n].p

  const tangents: Vec[] = points.map((anchor, i) => {
    // A corner has no tangent — not a small one, none. Its neighbours still use
    // its POSITION, which is right; what they must not do is inherit a
    // direction from a point that has deliberately been made sharp.
    if (anchor.corner) return ZERO
    const interior = closed || (i > 0 && i < n - 1)
    return interior ? scale(sub(at(i + 1), at(i - 1)), 0.5) : ZERO
  })
  if (closed) return tangents

  if (n === 2) {
    // Two points can only be a straight line, and both of them are ends.
    const chord = sub(at(1), at(0))
    return [chord, chord]
  }

  // Both ends take the same form once the chord is measured ALONG the path
  // rather than outwards from the endpoint.
  tangents[0] = naturalEnd(sub(at(1), at(0)), tangents[1])
  tangents[n - 1] = naturalEnd(sub(at(n - 1), at(n - 2)), tangents[n - 2])
  return tangents
}

/**
 * The tangent at an open end: T = (3·chord - T_neighbour) / 2.
 *
 * A neighbour that is a corner has no tangent to work from — using its zero
 * would stretch this handle to one and a half chords and balloon the end
 * segment — so the chord itself is used instead.
 */
function naturalEnd(forward: Vec, neighbourTangent: Vec): Vec {
  if (isZero(neighbourTangent)) return forward
  return scale(sub(scale(forward, 3), neighbourTangent), 0.5)
}

/** Flips one point between smooth and corner, then refits around it. */
export function toggleCorner(sp: SubPath, index: number): SubPath {
  if (index < 0 || index >= sp.anchors.length) return sp
  const anchors = sp.anchors.map((anchor, i) =>
    i === index ? { ...anchor, corner: !anchor.corner } : anchor,
  )
  return refitCurvature({ closed: sp.closed, anchors })
}
