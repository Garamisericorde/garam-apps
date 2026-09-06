/**
 * The document model.
 *
 * It is deliberately SVG-shaped: the same structure renders to the screen and
 * writes to a file, so there is no translation layer to keep in step and no
 * lossy round trip through a second representation.
 */
import type { Matrix, Vec } from './geom'
import type { SubPath } from './path'

export type NodeId = string
export type LayerId = string

/* ── Paint ───────────────────────────────────────────────────────────────── */

export interface GradientStop {
  /** 0..1 along the gradient axis. */
  offset: number
  color: string
  opacity: number
}

/**
 * A gradient's geometry is an ANGLE plus a length ratio, not two endpoints.
 *
 * Illustrator stores endpoints, which is why rotating a gradient there means
 * grabbing a tiny handle at the end of a line you first have to reveal. An
 * angle is a number: the on-canvas handle writes it, and so can a field.
 */
export interface LinearPaint {
  kind: 'linear'
  /** Degrees, clockwise from "left to right across the shape". */
  angle: number
  stops: GradientStop[]
  opacity: number
}

export interface RadialPaint {
  kind: 'radial'
  /** Centre, in the shape's own 0..1 bounding-box space. */
  center: Vec
  /** Radius as a fraction of the bounding box. */
  radius: number
  stops: GradientStop[]
  opacity: number
}

export type Paint =
  | { kind: 'none' }
  | { kind: 'solid'; color: string; opacity: number }
  | LinearPaint
  | RadialPaint

export const NO_PAINT: Paint = { kind: 'none' }

export const solid = (color: string, opacity = 1): Paint => ({ kind: 'solid', color, opacity })

export interface Stroke {
  paint: Paint
  width: number
  cap: 'butt' | 'round' | 'square'
  join: 'miter' | 'round' | 'bevel'
  /** Dash pattern in document units; empty means solid. */
  dash: number[]
}

export const NO_STROKE: Stroke = {
  paint: NO_PAINT,
  width: 1,
  cap: 'butt',
  join: 'miter',
  dash: [],
}

/* ── Nodes ───────────────────────────────────────────────────────────────── */

interface NodeBase {
  id: NodeId
  /** The layer this belongs to. Every node has one; there is always a layer. */
  layer: LayerId
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  /**
   * Rotation and position only. Resizing edits the geometry below instead of
   * scaling this, so a stroke keeps its width through a resize.
   */
  transform: Matrix
  fill: Paint
  stroke: Stroke
}

/** An axis-aligned rectangle in local space, with optional corner radius. */
export interface RectNode extends NodeBase {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface EllipseNode extends NodeBase {
  type: 'ellipse'
  x: number
  y: number
  width: number
  height: number
}

export interface PathNode extends NodeBase {
  type: 'path'
  subpaths: SubPath[]
}

/**
 * A placed bitmap — a reference to trace over, a logo to sit beside the
 * artwork.
 *
 * The pixels live in the node as a data URL rather than as a path on disk, so
 * the document is self-contained: it survives being moved, and an SVG export
 * carries the image with it instead of a link that only resolves on the machine
 * it was made on.
 */
export interface ImageNode extends NodeBase {
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  src: string
  /** The bitmap's own pixel size, for placing it and for "reset to 100%". */
  natural: { width: number; height: number }
}

export type SceneNode = RectNode | EllipseNode | PathNode | ImageNode
export type NodeType = SceneNode['type']

/** Everything the path tools can work on — that is, everything but a bitmap. */
export type VectorNode = RectNode | EllipseNode | PathNode

export function isVectorNode(node: SceneNode): node is VectorNode {
  return node.type !== 'image'
}

/**
 * A layer.
 *
 * Layers hold nothing themselves — `doc.nodes` stays one flat list and each
 * node names its layer. The alternative, nesting the nodes inside the layers,
 * would rewrite every piece of geometry, hit-testing and snapping code to walk
 * a tree for no gain: the only things a layer actually does are group the paint
 * order, carry a group opacity, and switch a whole set of objects on or off.
 */
export interface Layer {
  id: LayerId
  name: string
  visible: boolean
  locked: boolean
  /** Applied to the whole layer as a group, not per node. */
  opacity: number
}

export interface Artboard {
  width: number
  height: number
  background: string
}

export interface Doc {
  artboard: Artboard
  /** Bottom to top. Never empty: a document always has at least one layer. */
  layers: Layer[]
  /**
   * Every node, in no particular global order.
   *
   * Array order decides z WITHIN a layer; the layer list decides the rest. Read
   * `paintOrder` when the whole stack matters and never assume the last entry
   * is on top — it is only on top of its own layer.
   */
  nodes: SceneNode[]
}

export function layerOf(doc: Doc, node: SceneNode): Layer | undefined {
  return doc.layers.find((layer) => layer.id === node.layer)
}

/** Nodes back to front across the whole document. */
export function paintOrder(doc: Doc): SceneNode[] {
  const out: SceneNode[] = []
  for (const layer of doc.layers) {
    for (const node of doc.nodes) {
      if (node.layer === layer.id) out.push(node)
    }
  }
  return out
}

/**
 * Whether a node is painted at all.
 *
 * A hidden layer hides everything on it, so this is the question every renderer
 * and every hit-test has to ask — not `node.visible` on its own.
 */
export function isShown(doc: Doc, node: SceneNode): boolean {
  return node.visible && (layerOf(doc, node)?.visible ?? true)
}

/** Whether a node may be selected or edited: a locked LAYER locks its nodes. */
export function isEditable(doc: Doc, node: SceneNode): boolean {
  const layer = layerOf(doc, node)
  return node.visible && !node.locked && (layer?.visible ?? true) && !(layer?.locked ?? false)
}

export function findNode(doc: Doc, id: NodeId): SceneNode | undefined {
  return doc.nodes.find((node) => node.id === id)
}

export function nodesById(doc: Doc, ids: readonly NodeId[]): SceneNode[] {
  const wanted = new Set(ids)
  return doc.nodes.filter((node) => wanted.has(node.id))
}

let counter = 0
export function newId(prefix = 'n'): NodeId {
  counter += 1
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
