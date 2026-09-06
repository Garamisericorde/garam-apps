/**
 * Hit-testing.
 *
 * The scene is real SVG in the real DOM, so the browser already knows which
 * shape is under the pointer — including the hole in a donut and the gap
 * between two letters. Asking it is both exact and free; re-deriving it from
 * bezier maths would be neither.
 */
import { worldBounds } from '../doc/bounds'
import { rectContains, rectsOverlap, type Rect, type Vec } from '../doc/geom'
import { isEditable, paintOrder, type Doc, type NodeId, type SceneNode } from '../doc/types'

/** Client-space point, i.e. straight off a PointerEvent. */
export interface ClientPoint {
  clientX: number
  clientY: number
}

export function hitNode(doc: Doc, client: ClientPoint, docPoint: Vec): SceneNode | null {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]))

  for (const element of document.elementsFromPoint(client.clientX, client.clientY)) {
    const id = element.getAttribute('data-node')
    if (!id) continue
    const node = byId.get(id as NodeId)
    if (node && isEditable(doc, node)) return node
  }

  // An unfilled shape paints nothing in its middle, so the DOM reports no hit
  // there. Falling back to bounds keeps outlines selectable instead of making
  // the user find the one pixel of stroke.
  // Front to back, which is the paint order reversed — and the paint order is
  // the layer stack, not the array.
  const stack = paintOrder(doc)
  for (let i = stack.length - 1; i >= 0; i--) {
    const node = stack[i]
    if (!isEditable(doc, node)) continue
    if (node.fill.kind !== 'none') continue
    if (rectContains(worldBounds(node), docPoint)) return node
  }
  return null
}

/**
 * Everything a rubber band caught.
 *
 * Touching is enough — a marquee that demands full enclosure means dragging
 * across a row of shapes selects none of them, which is never what was meant.
 */
export function hitMarquee(doc: Doc, rect: Rect): NodeId[] {
  return doc.nodes
    .filter((node) => isEditable(doc, node) && rectsOverlap(worldBounds(node), rect))
    .map((node) => node.id)
}
