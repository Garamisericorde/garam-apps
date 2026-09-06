/**
 * Starting values for a new document and for newly drawn shapes.
 *
 * The hex values here are DOCUMENT CONTENT, not chrome: they are saved into the
 * file and exported, so they cannot be CSS variables — a theme change must not
 * repaint the user's artwork. Every colour the editor itself paints with still
 * comes from @garam/theme.
 */
import { IDENTITY } from './geom'
import { ellipseSubPath, rectSubPath, type SubPath } from './path'
import {
  newId,
  NO_PAINT,
  solid,
  type Doc,
  type EllipseNode,
  type ImageNode,
  type Layer,
  type LayerId,
  type PathNode,
  type RectNode,
  type Stroke,
  type VectorNode,
} from './types'

/** The swatches offered for a new shape's fill. */
export const DOCUMENT_SWATCHES = [
  '#1f2933',
  '#5c4bea',
  '#2563eb',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#ffffff',
] as const

export const DEFAULT_FILL = solid('#5c4bea')

export const DEFAULT_STROKE: Stroke = {
  paint: NO_PAINT,
  width: 1,
  cap: 'butt',
  join: 'miter',
  dash: [],
}

/** The layer every new document starts on, and the one that cannot be removed. */
export const DEFAULT_LAYER_NAME = 'Default'

export function createLayer(name: string): Layer {
  return { id: newId('L'), name, visible: true, locked: false, opacity: 1 }
}

export function emptyDoc(): Doc {
  return {
    artboard: { width: 1200, height: 800, background: '#ffffff' },
    layers: [createLayer(DEFAULT_LAYER_NAME)],
    nodes: [],
  }
}

interface ShapeInit {
  /**
   * Which layer it belongs to.
   *
   * Required rather than defaulted: a node with no layer, or with one that does
   * not exist, would simply never be painted, and nothing would say why.
   */
  layer: LayerId
  x: number
  y: number
  width: number
  height: number
  name?: string
}

export function createRect(init: ShapeInit & { radius?: number }): RectNode {
  return {
    id: newId('r'),
    layer: init.layer,
    type: 'rect',
    name: init.name ?? 'Rectangle',
    visible: true,
    locked: false,
    opacity: 1,
    transform: IDENTITY,
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    radius: init.radius ?? 0,
  }
}

export function createEllipse(init: ShapeInit): EllipseNode {
  return {
    id: newId('e'),
    layer: init.layer,
    type: 'ellipse',
    name: init.name ?? 'Ellipse',
    visible: true,
    locked: false,
    opacity: 1,
    transform: IDENTITY,
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
  }
}

export function createPath(layer: LayerId, subpaths: SubPath[], name = 'Path'): PathNode {
  return {
    id: newId('p'),
    layer,
    type: 'path',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    transform: IDENTITY,
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    subpaths,
  }
}

/** The ink a freshly drawn path carries. */
export const DEFAULT_INK = solid('#1f2933')

/**
 * A path straight off the pen or the curvature tool: STROKED, NOT FILLED.
 *
 * An open path with a fill paints the region between its ends, so drawing a
 * three-point curve with the shape default produced a solid blob that swelled
 * with every click. A line being drawn is a line; a fill is something you add
 * once it encloses anything.
 */
export function createDrawnPath(layer: LayerId, subpaths: SubPath[], name = 'Path'): PathNode {
  return {
    ...createPath(layer, subpaths, name),
    fill: NO_PAINT,
    stroke: { paint: DEFAULT_INK, width: 2, cap: 'round', join: 'round', dash: [] },
  }
}

export interface ImageInit {
  layer: LayerId
  src: string
  natural: { width: number; height: number }
  x: number
  y: number
  width: number
  height: number
  name?: string
}

/**
 * A placed bitmap.
 *
 * It arrives unlocked and selected, because the first thing anyone does with a
 * reference is put it where they want it and set it to something they can draw
 * on top of. Locking it is the SECOND thing, and the layers list is where that
 * lives.
 */
export function createImage(init: ImageInit): ImageNode {
  return {
    id: newId('i'),
    layer: init.layer,
    type: 'image',
    name: init.name ?? 'Image',
    visible: true,
    locked: false,
    opacity: 1,
    transform: IDENTITY,
    fill: NO_PAINT,
    stroke: DEFAULT_STROKE,
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    src: init.src,
    natural: init.natural,
  }
}

/**
 * Turns a primitive into an editable path — what the pen and direct-select
 * tools need before they can touch a rectangle's corners.
 */
export function toPathNode(node: VectorNode): PathNode {
  if (node.type === 'path') return node
  const subpath: SubPath =
    node.type === 'rect'
      ? rectSubPath(node.x, node.y, node.width, node.height, node.radius)
      : ellipseSubPath(
          node.x + node.width / 2,
          node.y + node.height / 2,
          node.width / 2,
          node.height / 2,
        )
  return {
    id: node.id,
    layer: node.layer,
    type: 'path',
    name: node.name,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    transform: node.transform,
    fill: node.fill,
    stroke: node.stroke,
    subpaths: [subpath],
  }
}

/** A small starting scene, so the canvas is not blank on first launch. */
export function starterDoc(): Doc {
  const doc = emptyDoc()
  const layer = doc.layers[0].id
  const card = createRect({ layer, x: 160, y: 140, width: 320, height: 220, radius: 16, name: 'Card' })
  const badge = createEllipse({ layer, x: 560, y: 180, width: 140, height: 140, name: 'Badge' })
  const bar = createRect({ layer, x: 160, y: 420, width: 540, height: 64, radius: 8, name: 'Bar' })
  return {
    ...doc,
    nodes: [
      { ...card, fill: solid('#1f2933') },
      { ...badge, fill: solid('#5c4bea') },
      { ...bar, fill: solid('#2563eb') },
    ],
  }
}
