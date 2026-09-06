/**
 * Vectors, rectangles and affine matrices.
 *
 * Everything here is pure and allocation-light: the snap engine runs this code
 * on every pointer move, against every candidate in the document.
 */

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const vec = (x: number, y: number): Vec => ({ x, y })
export const addVec = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const subVec = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scaleVec = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
export const lenVec = (a: Vec): number => Math.hypot(a.x, a.y)
export const distVec = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * A 2x3 affine matrix, in SVG's own order: [a, b, c, d, e, f] maps
 * (x, y) -> (a·x + c·y + e, b·x + d·y + f).
 *
 * Node transforms only ever hold rotation and translation. Resizing edits the
 * node's local geometry instead of scaling the matrix, which is what keeps a
 * 2 pt stroke 2 pt after a resize — the single most common complaint about
 * editors that scale the matrix.
 */
export type Matrix = readonly [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function applyMatrix(m: Matrix, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/** `a` after `b` — the matrix that applies b first, then a. */
export function multiplyMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (det === 0) return IDENTITY
  const k = 1 / det
  return [
    m[3] * k,
    -m[1] * k,
    -m[2] * k,
    m[0] * k,
    (m[2] * m[5] - m[3] * m[4]) * k,
    (m[1] * m[4] - m[0] * m[5]) * k,
  ]
}

export function translationMatrix(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy]
}

/** Rotation by `degrees` about `about`, in the same space as the matrix. */
export function rotationMatrix(degrees: number, about: Vec = { x: 0, y: 0 }): Matrix {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, sin, -sin, cos, about.x - cos * about.x + sin * about.y, about.y - sin * about.x - cos * about.y]
}

/** The rotation baked into a rigid matrix, in degrees. */
export function matrixRotation(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0
}

export function matrixToSvg(m: Matrix): string {
  return `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})`
}

/* ── Rectangles ──────────────────────────────────────────────────────────── */

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 }

export function rectFromCorners(a: Vec, b: Vec): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function rectFromPoints(points: readonly Vec[]): Rect {
  if (points.length === 0) return EMPTY_RECT
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectCorners(r: Rect): Vec[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
}

export function rectCenter(r: Rect): Vec {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  )
}

/** True when `inner` sits entirely inside `outer` — the marquee's hit rule. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

/** Rounds to a sane number of decimals — path data and inspector fields alike. */
export function round(value: number, decimals = 2): number {
  const k = 10 ** decimals
  return Math.round(value * k) / k
}
