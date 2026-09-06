/**
 * Node bounds, in local space and in document space.
 *
 * Every snap target, every selection frame and every inspector field reads from
 * here, so it has one rule: bounds cover the GEOMETRY, not the stroke. A 20 pt
 * stroke would otherwise make a shape's reported width disagree with the number
 * the user typed into the width field.
 */
import {
  applyMatrix,
  isIdentity,
  rectCorners,
  rectFromPoints,
  type Matrix,
  type Rect,
  type Vec,
} from './geom'
import { pathBounds } from './path'
import type { SceneNode } from './types'

/** Bounds in the node's own coordinate space, before its transform. */
export function localBounds(node: SceneNode): Rect {
  switch (node.type) {
    case 'rect':
    case 'ellipse':
    case 'image':
      return { x: node.x, y: node.y, width: node.width, height: node.height }
    case 'path':
      return pathBounds(node.subpaths) ?? { x: 0, y: 0, width: 0, height: 0 }
  }
}

/**
 * The four corners of the node's local box, transformed into document space.
 *
 * For a rotated node this is a rotated quad, not a rectangle — which is exactly
 * what the selection frame draws, so the frame hugs the shape instead of the
 * larger axis-aligned box around it.
 */
export function worldCorners(node: SceneNode): Vec[] {
  const corners = rectCorners(localBounds(node))
  if (isIdentity(node.transform)) return corners
  return corners.map((p) => applyMatrix(node.transform, p))
}

/** Axis-aligned bounds in document space. What snapping and hit-testing use. */
export function worldBounds(node: SceneNode): Rect {
  if (isIdentity(node.transform)) return localBounds(node)
  return rectFromPoints(worldCorners(node))
}

export function unionBounds(nodes: readonly SceneNode[]): Rect | null {
  if (nodes.length === 0) return null
  const points: Vec[] = []
  for (const node of nodes) {
    const b = worldBounds(node)
    points.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height })
  }
  return rectFromPoints(points)
}

/**
 * The frame drawn around a selection.
 *
 * One rotated node keeps its own rotated quad, so the handles sit on the shape.
 * Two or more fall back to the axis-aligned box: there is no rotation the group
 * agrees on, and pretending otherwise puts handles where nothing is.
 */
export interface SelectionFrame {
  corners: Vec[]
  bounds: Rect
  /** Degrees; 0 whenever the frame is axis-aligned. */
  rotation: number
}

export function selectionFrame(nodes: readonly SceneNode[]): SelectionFrame | null {
  if (nodes.length === 0) return null
  if (nodes.length === 1) {
    const node = nodes[0]
    const corners = worldCorners(node)
    return {
      corners,
      bounds: rectFromPoints(corners),
      rotation: (Math.atan2(node.transform[1], node.transform[0]) * 180) / Math.PI,
    }
  }
  const bounds = unionBounds(nodes)
  if (!bounds) return null
  return { corners: rectCorners(bounds), bounds, rotation: 0 }
}

/** Converts a point from document space into a node's local space. */
export function toLocal(transformInverse: Matrix, p: Vec): Vec {
  return applyMatrix(transformInverse, p)
}
