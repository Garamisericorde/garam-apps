/**
 * Bezier paths: the anchor model, SVG path data, and exact bounds.
 *
 * Handles are stored RELATIVE to their anchor point. Dragging an anchor then
 * moves its handles for free, which is the operation a path editor performs
 * more than any other; absolute handles have to be fixed up on every move and
 * drift the moment one fix-up is missed.
 */
import { distVec, rectFromPoints, type Rect, type Vec } from './geom'

export interface Anchor {
  /** The on-path point, in the node's local space. */
  p: Vec
  /** Incoming handle, relative to `p`. Zero-length means a corner. */
  in: Vec
  /** Outgoing handle, relative to `p`. */
  out: Vec
  /**
   * Marks a point the curvature tool must leave sharp.
   *
   * It cannot be inferred from the handles. The curvature tool refits the whole
   * subpath after every edit, and at the moment of the refit a corner and a
   * point that has simply not been fitted yet look identical: two zero handles.
   * The flag is the only thing that survives the refit.
   */
  corner?: boolean
}

export interface SubPath {
  anchors: Anchor[]
  closed: boolean
}

export const corner = (x: number, y: number): Anchor => ({
  p: { x, y },
  in: { x: 0, y: 0 },
  out: { x: 0, y: 0 },
})

export function isCorner(a: Anchor): boolean {
  return a.in.x === 0 && a.in.y === 0 && a.out.x === 0 && a.out.y === 0
}

/* ── SVG path data ───────────────────────────────────────────────────────── */

const n = (v: number): string => String(Math.round(v * 1000) / 1000)

export function subPathToData(sp: SubPath): string {
  const a = sp.anchors
  if (a.length === 0) return ''
  if (a.length === 1) return `M ${n(a[0].p.x)} ${n(a[0].p.y)}`

  let d = `M ${n(a[0].p.x)} ${n(a[0].p.y)}`
  const last = sp.closed ? a.length : a.length - 1
  for (let i = 0; i < last; i++) {
    const from = a[i]
    const to = a[(i + 1) % a.length]
    d += segmentToData(from, to)
  }
  if (sp.closed) d += ' Z'
  return d
}

function segmentToData(from: Anchor, to: Anchor): string {
  const straight =
    from.out.x === 0 && from.out.y === 0 && to.in.x === 0 && to.in.y === 0
  if (straight) return ` L ${n(to.p.x)} ${n(to.p.y)}`
  const c1 = { x: from.p.x + from.out.x, y: from.p.y + from.out.y }
  const c2 = { x: to.p.x + to.in.x, y: to.p.y + to.in.y }
  return ` C ${n(c1.x)} ${n(c1.y)}, ${n(c2.x)} ${n(c2.y)}, ${n(to.p.x)} ${n(to.p.y)}`
}

export function pathToData(subpaths: readonly SubPath[]): string {
  return subpaths.map(subPathToData).filter(Boolean).join(' ')
}

/* ── Bounds ──────────────────────────────────────────────────────────────── */

/**
 * Exact bounds of one cubic segment.
 *
 * The control points' bounding box is not the curve's: a curve can sit well
 * inside its hull, and using the hull makes every snap target and every
 * selection frame wrong by a visible margin. So the extrema are solved for
 * properly — the derivative of a cubic is a quadratic, two roots per axis.
 */
export function cubicBounds(p0: Vec, c1: Vec, c2: Vec, p1: Vec): Rect {
  const points: Vec[] = [p0, p1]
  for (const axis of ['x', 'y'] as const) {
    for (const t of cubicExtrema(p0[axis], c1[axis], c2[axis], p1[axis])) {
      points.push(cubicAt(p0, c1, c2, p1, t))
    }
  }
  return rectFromPoints(points)
}

function cubicExtrema(v0: number, v1: number, v2: number, v3: number): number[] {
  // Derivative coefficients of the cubic in Bernstein form.
  const a = -3 * v0 + 9 * v1 - 9 * v2 + 3 * v3
  const b = 6 * v0 - 12 * v1 + 6 * v2
  const c = 3 * v1 - 3 * v0

  const roots: number[] = []
  const keep = (t: number): void => {
    if (t > 0 && t < 1) roots.push(t)
  }

  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) keep(-c / b)
    return roots
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return roots
  const s = Math.sqrt(disc)
  keep((-b + s) / (2 * a))
  keep((-b - s) / (2 * a))
  return roots
}

export function cubicAt(p0: Vec, c1: Vec, c2: Vec, p1: Vec, t: number): Vec {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
  }
}

export function subPathBounds(sp: SubPath): Rect | null {
  const a = sp.anchors
  if (a.length === 0) return null
  if (a.length === 1) return { x: a[0].p.x, y: a[0].p.y, width: 0, height: 0 }

  const points: Vec[] = []
  const last = sp.closed ? a.length : a.length - 1
  for (let i = 0; i < last; i++) {
    const from = a[i]
    const to = a[(i + 1) % a.length]
    const c1 = { x: from.p.x + from.out.x, y: from.p.y + from.out.y }
    const c2 = { x: to.p.x + to.in.x, y: to.p.y + to.in.y }
    const b = cubicBounds(from.p, c1, c2, to.p)
    points.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height })
  }
  return rectFromPoints(points)
}

export function pathBounds(subpaths: readonly SubPath[]): Rect | null {
  const points: Vec[] = []
  for (const sp of subpaths) {
    const b = subPathBounds(sp)
    if (!b) continue
    points.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height })
  }
  return points.length > 0 ? rectFromPoints(points) : null
}

/* ── Segments ─────────────────────────────────────────────────────────────────── */

/** How many segments a subpath actually draws — one more when it is closed. */
export function segmentCount(sp: SubPath): number {
  if (sp.anchors.length < 2) return 0
  return sp.closed ? sp.anchors.length : sp.anchors.length - 1
}

export interface Cubic {
  p0: Vec
  c1: Vec
  c2: Vec
  p1: Vec
}

/** The cubic for the segment leaving anchor `index`. */
export function segmentCubic(sp: SubPath, index: number): Cubic {
  const from = sp.anchors[index]
  const to = sp.anchors[(index + 1) % sp.anchors.length]
  return {
    p0: from.p,
    c1: { x: from.p.x + from.out.x, y: from.p.y + from.out.y },
    c2: { x: to.p.x + to.in.x, y: to.p.y + to.in.y },
    p1: to.p,
  }
}

export interface PathHit {
  subpath: number
  /** The anchor the segment leaves from. */
  segment: number
  t: number
  point: Vec
  distance: number
}

/**
 * The closest point on a path to `target`.
 *
 * Coarse sampling followed by a local bisection, rather than solving the
 * quintic properly. The caller is a mouse cursor: the answer only has to be
 * right to within a fraction of a pixel, and this gets there in a few dozen
 * multiplications per segment.
 */
export function nearestOnPath(
  subpaths: readonly SubPath[],
  target: Vec,
  samples = 20,
): PathHit | null {
  let best: PathHit | null = null

  for (let s = 0; s < subpaths.length; s++) {
    const sp = subpaths[s]
    for (let i = 0; i < segmentCount(sp); i++) {
      const c = segmentCubic(sp, i)
      let bestT = 0
      let bestDistance = Infinity
      for (let k = 0; k <= samples; k++) {
        const t = k / samples
        const d = distVec(cubicAt(c.p0, c.c1, c.c2, c.p1, t), target)
        if (d < bestDistance) {
          bestDistance = d
          bestT = t
        }
      }
      // Refine around the winner; three halvings is well under a pixel.
      let step = 1 / samples
      for (let round = 0; round < 12; round++) {
        step /= 2
        for (const t of [bestT - step, bestT + step]) {
          if (t < 0 || t > 1) continue
          const d = distVec(cubicAt(c.p0, c.c1, c.c2, c.p1, t), target)
          if (d < bestDistance) {
            bestDistance = d
            bestT = t
          }
        }
      }
      if (!best || bestDistance < best.distance) {
        best = {
          subpath: s,
          segment: i,
          t: bestT,
          point: cubicAt(c.p0, c.c1, c.c2, c.p1, bestT),
          distance: bestDistance,
        }
      }
    }
  }
  return best
}

const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

/**
 * Splits the segment leaving `index` at `t`, returning the new anchor list.
 *
 * De Casteljau, so the curve does not move by so much as a pixel — the two new
 * segments trace exactly what the one segment traced. An insert that changes
 * the shape is the fastest way to make a path tool feel untrustworthy.
 */
export function insertAnchor(sp: SubPath, index: number, t: number): SubPath {
  const c = segmentCubic(sp, index)
  const a = lerp(c.p0, c.c1, t)
  const b = lerp(c.c1, c.c2, t)
  const d = lerp(c.c2, c.p1, t)
  const e = lerp(a, b, t)
  const f = lerp(b, d, t)
  const mid = lerp(e, f, t)

  const anchors = sp.anchors.map((anchor) => ({ ...anchor }))
  const next = (index + 1) % anchors.length

  anchors[index].out = { x: a.x - c.p0.x, y: a.y - c.p0.y }
  anchors[next].in = { x: d.x - c.p1.x, y: d.y - c.p1.y }

  const inserted: Anchor = {
    p: mid,
    in: { x: e.x - mid.x, y: e.y - mid.y },
    out: { x: f.x - mid.x, y: f.y - mid.y },
  }
  anchors.splice(index + 1, 0, inserted)
  return { closed: sp.closed, anchors }
}

/* ── Primitives as paths ─────────────────────────────────────────────────── */

/** The magic constant that makes four cubics into a circle. */
const KAPPA = 0.5522847498307936

export function ellipseSubPath(cx: number, cy: number, rx: number, ry: number): SubPath {
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return {
    closed: true,
    anchors: [
      { p: { x: cx, y: cy - ry }, in: { x: ox, y: 0 }, out: { x: -ox, y: 0 } },
      { p: { x: cx - rx, y: cy }, in: { x: 0, y: -oy }, out: { x: 0, y: oy } },
      { p: { x: cx, y: cy + ry }, in: { x: -ox, y: 0 }, out: { x: ox, y: 0 } },
      { p: { x: cx + rx, y: cy }, in: { x: 0, y: oy }, out: { x: 0, y: -oy } },
    ],
  }
}

export function rectSubPath(x: number, y: number, w: number, h: number, radius = 0): SubPath {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  if (r === 0) {
    return {
      closed: true,
      anchors: [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)],
    }
  }
  const k = r * KAPPA - r // handle length, signed towards the corner
  const anchors: Anchor[] = [
    { p: { x: x + r, y }, in: { x: k, y: 0 }, out: { x: 0, y: 0 } },
    { p: { x: x + w - r, y }, in: { x: 0, y: 0 }, out: { x: -k, y: 0 } },
    { p: { x: x + w, y: y + r }, in: { x: 0, y: k }, out: { x: 0, y: 0 } },
    { p: { x: x + w, y: y + h - r }, in: { x: 0, y: 0 }, out: { x: 0, y: -k } },
    { p: { x: x + w - r, y: y + h }, in: { x: -k, y: 0 }, out: { x: 0, y: 0 } },
    { p: { x: x + r, y: y + h }, in: { x: 0, y: 0 }, out: { x: k, y: 0 } },
    { p: { x, y: y + h - r }, in: { x: 0, y: -k }, out: { x: 0, y: 0 } },
    { p: { x, y: y + r }, in: { x: 0, y: 0 }, out: { x: 0, y: k } },
  ]
  return { closed: true, anchors }
}

/** Scales every anchor and handle of a path — how a path node is resized. */
export function scaleSubPaths(
  subpaths: readonly SubPath[],
  origin: Vec,
  sx: number,
  sy: number,
): SubPath[] {
  return subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({
      p: { x: origin.x + (a.p.x - origin.x) * sx, y: origin.y + (a.p.y - origin.y) * sy },
      in: { x: a.in.x * sx, y: a.in.y * sy },
      out: { x: a.out.x * sx, y: a.out.y * sy },
    })),
  }))
}
