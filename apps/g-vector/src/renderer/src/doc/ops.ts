/**
 * Pure edits on the document. Every one returns a new Doc and leaves the old
 * one untouched, which is what makes undo a matter of keeping the previous
 * reference rather than replaying inverse operations.
 */
import {
  multiplyMatrix,
  rotationMatrix,
  type Matrix,
  type Rect,
  type Vec,
} from './geom'
import { localBounds } from './bounds'
import { scaleSubPaths } from './path'
import {
  isEditable,
  type Doc,
  type EllipseNode,
  type Layer,
  type LayerId,
  type NodeId,
  type PathNode,
  type RectNode,
  type SceneNode,
} from './types'

/**
 * Fields an edit may set.
 *
 * NOT `Partial<Omit<SceneNode, ...>>`: Omit over a union keeps only the keys
 * every member shares, so that version silently rejects `radius` and `width`
 * and leaves only the base fields editable. The intersection of the three
 * partials keeps every field, each optional.
 */
type NodePatch = Partial<Omit<RectNode, 'id' | 'type'>> &
  Partial<Omit<EllipseNode, 'id' | 'type'>> &
  Partial<Omit<PathNode, 'id' | 'type'>>

function mapSelected(
  doc: Doc,
  ids: readonly NodeId[],
  fn: (node: SceneNode) => SceneNode,
): Doc {
  const wanted = new Set(ids)
  let changed = false
  const nodes = doc.nodes.map((node) => {
    // A locked LAYER locks everything on it, so the guard cannot just read
    // node.locked.
    if (!wanted.has(node.id) || !isEditable(doc, node)) return node
    const next = fn(node)
    if (next !== node) changed = true
    return next
  })
  return changed ? { ...doc, nodes } : doc
}

export function updateNode(doc: Doc, id: NodeId, patch: NodePatch): Doc {
  return mapSelected(doc, [id], (node) => ({ ...node, ...patch }) as SceneNode)
}

export function updateNodes(doc: Doc, ids: readonly NodeId[], patch: NodePatch): Doc {
  return mapSelected(doc, ids, (node) => ({ ...node, ...patch }) as SceneNode)
}

export function replaceNodes(doc: Doc, replacements: readonly SceneNode[]): Doc {
  if (replacements.length === 0) return doc
  const byId = new Map(replacements.map((node) => [node.id, node]))
  return { ...doc, nodes: doc.nodes.map((node) => byId.get(node.id) ?? node) }
}

export function addNodes(doc: Doc, nodes: readonly SceneNode[]): Doc {
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

export function removeNodes(doc: Doc, ids: readonly NodeId[]): Doc {
  const wanted = new Set(ids)
  return {
    ...doc,
    nodes: doc.nodes.filter((node) => !wanted.has(node.id) || !isEditable(doc, node)),
  }
}

/* ── Transforms ──────────────────────────────────────────────────────────── */

export function translateNodes(doc: Doc, ids: readonly NodeId[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc
  return mapSelected(doc, ids, (node) => {
    const t = node.transform
    const transform: Matrix = [t[0], t[1], t[2], t[3], t[4] + dx, t[5] + dy]
    return { ...node, transform }
  })
}

export function rotateNodes(
  doc: Doc,
  ids: readonly NodeId[],
  degrees: number,
  pivot: Vec,
): Doc {
  if (degrees === 0) return doc
  const r = rotationMatrix(degrees, pivot)
  return mapSelected(doc, ids, (node) => ({
    ...node,
    transform: multiplyMatrix(r, node.transform),
  }))
}

/**
 * Scales a selection about a world-space pivot.
 *
 * The scale goes into the node's GEOMETRY, never into its matrix — a matrix
 * scale would take the stroke with it, so a 2 pt outline becomes 4 pt the
 * moment the shape is dragged twice as wide.
 *
 * A rotated node cannot absorb a non-uniform scale that way: scale and rotation
 * only commute when the scale is uniform, and forcing it produces a skew the
 * model has no place to store. Such a node is scaled uniformly instead, by
 * whichever axis the drag pushed harder. That is a visible compromise, and the
 * honest one — the alternative is silently shearing the shape.
 */
export function scaleNodes(
  doc: Doc,
  ids: readonly NodeId[],
  pivot: Vec,
  sx: number,
  sy: number,
): Doc {
  if (sx === 1 && sy === 1) return doc
  return mapSelected(doc, ids, (node) => {
    const rotated = node.transform[1] !== 0 || node.transform[2] !== 0
    let kx = sx
    let ky = sy
    if (rotated && sx !== sy) {
      const uniform = Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy
      kx = uniform
      ky = uniform
    }

    const t = node.transform
    const transform: Matrix = [
      t[0],
      t[1],
      t[2],
      t[3],
      pivot.x + (t[4] - pivot.x) * kx,
      pivot.y + (t[5] - pivot.y) * ky,
    ]

    switch (node.type) {
      case 'rect':
        return {
          ...node,
          transform,
          x: node.x * kx,
          y: node.y * ky,
          width: node.width * kx,
          height: node.height * ky,
          radius: node.radius * Math.min(Math.abs(kx), Math.abs(ky)),
        }
      case 'ellipse':
      case 'image':
        return {
          ...node,
          transform,
          x: node.x * kx,
          y: node.y * ky,
          width: node.width * kx,
          height: node.height * ky,
        }
      case 'path':
        return {
          ...node,
          transform,
          subpaths: scaleSubPaths(node.subpaths, { x: 0, y: 0 }, kx, ky),
        }
    }
  })
}

/**
 * Sets a single node's LOCAL box, leaving its transform alone.
 *
 * This is how one node is resized, rotated or not: the drag is converted into
 * the node's own space first, so pulling the corner of a shape rotated 30°
 * still lengthens it along its own axis instead of shearing it. It is the exact
 * operation; scaleNodes() is the approximation kept for multi-selections, where
 * no single local space exists.
 */
export function setLocalBox(doc: Doc, id: NodeId, box: Rect): Doc {
  const width = Math.max(1e-4, box.width)
  const height = Math.max(1e-4, box.height)
  return mapSelected(doc, [id], (node) => {
    switch (node.type) {
      case 'rect':
        return {
          ...node,
          x: box.x,
          y: box.y,
          width,
          height,
          radius: Math.min(node.radius, Math.min(width, height) / 2),
        }
      case 'ellipse':
      case 'image':
        return { ...node, x: box.x, y: box.y, width, height }
      case 'path': {
        const from = localBounds(node)
        if (from.width < 1e-6 || from.height < 1e-6) return node
        // Scale about the old box's top-left, which pins it, then slide that
        // corner onto the new one.
        const scaled = scaleSubPaths(
          node.subpaths,
          { x: from.x, y: from.y },
          width / from.width,
          height / from.height,
        )
        const dx = box.x - from.x
        const dy = box.y - from.y
        const subpaths = scaled.map((sp) => ({
          closed: sp.closed,
          anchors: sp.anchors.map((a) => ({
            p: { x: a.p.x + dx, y: a.p.y + dy },
            in: a.in,
            out: a.out,
          })),
        }))
        return { ...node, subpaths }
      }
    }
  })
}

/* ── Z-order ─────────────────────────────────────────────────────────────── */

/**
 * Visibility, lock and name — the three things a layer row changes.
 *
 * These bypass the locked guard every other edit respects, because a locked
 * node that cannot be unlocked is not locked, it is lost.
 */
export function setNodeFlags(
  doc: Doc,
  id: NodeId,
  flags: { visible?: boolean; locked?: boolean; name?: string },
): Doc {
  let changed = false
  const nodes = doc.nodes.map((node) => {
    if (node.id !== id) return node
    changed = true
    return { ...node, ...flags }
  })
  return changed ? { ...doc, nodes } : doc
}

type ZMove = 'front' | 'forward' | 'backward' | 'back'

/**
 * Z-order changes happen INSIDE a layer.
 *
 * "Bring to front" means the front of the layer the object is on, not the front
 * of the document — moving between layers is a different gesture, and one that
 * has to be deliberate.
 */
export function reorderNodes(doc: Doc, ids: readonly NodeId[], move: ZMove): Doc {
  const wanted = new Set(ids)
  const moving = doc.nodes.filter((node) => wanted.has(node.id))
  if (moving.length === 0) return doc

  let next = doc
  for (const layer of new Set(moving.map((node) => node.layer))) {
    next = reorderWithinLayer(next, wanted, layer, move)
  }
  return next
}

/** The positions in `doc.nodes` that belong to one layer, bottom to top. */
function slotsOf(doc: Doc, layer: LayerId): number[] {
  const slots: number[] = []
  doc.nodes.forEach((node, i) => {
    if (node.layer === layer) slots.push(i)
  })
  return slots
}

/** Writes a reordered run of nodes back into the positions it came from. */
function writeBack(doc: Doc, slots: readonly number[], run: readonly SceneNode[]): Doc {
  const nodes = [...doc.nodes]
  slots.forEach((slot, i) => {
    nodes[slot] = run[i]
  })
  return { ...doc, nodes }
}

function reorderWithinLayer(doc: Doc, wanted: Set<NodeId>, layer: LayerId, move: ZMove): Doc {
  const slots = slotsOf(doc, layer)
  const run = slots.map((slot) => doc.nodes[slot])
  const moving = run.filter((node) => wanted.has(node.id))
  if (moving.length === 0) return doc
  const rest = run.filter((node) => !wanted.has(node.id))

  if (move === 'front') return writeBack(doc, slots, [...rest, ...moving])
  if (move === 'back') return writeBack(doc, slots, [...moving, ...rest])

  // One step, preserving the relative order of the moving nodes. Walking from
  // the end for 'forward' and the start for 'backward' keeps a multi-selection
  // from collapsing onto a single index.
  const next = [...run]
  const indices = next.reduce<number[]>((acc, node, i) => {
    if (wanted.has(node.id)) acc.push(i)
    return acc
  }, [])
  const step = move === 'forward' ? 1 : -1
  const order = move === 'forward' ? [...indices].reverse() : indices
  for (const i of order) {
    const j = i + step
    if (j < 0 || j >= next.length || wanted.has(next[j].id)) continue
    const held = next[i]
    next[i] = next[j]
    next[j] = held
  }
  return writeBack(doc, slots, next)
}

/** Moves a node to an absolute position within its own layer. */
export function moveNodeWithinLayer(doc: Doc, id: NodeId, slot: number): Doc {
  const node = doc.nodes.find((entry) => entry.id === id)
  if (!node) return doc
  const slots = slotsOf(doc, node.layer)
  const run = slots.map((position) => doc.nodes[position])
  const from = run.findIndex((entry) => entry.id === id)
  const target = Math.max(0, Math.min(run.length - 1, slot))
  if (from < 0 || from === target) return doc

  const next = [...run]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return writeBack(doc, slots, next)
}

/* ── Layers ───────────────────────────────────────────────────────────── */

/** Adds a layer directly above `above`, or on top when that is omitted. */
export function addLayer(doc: Doc, layer: Layer, above?: LayerId): Doc {
  const at = above ? doc.layers.findIndex((entry) => entry.id === above) : -1
  const layers = [...doc.layers]
  layers.splice(at < 0 ? layers.length : at + 1, 0, layer)
  return { ...doc, layers }
}

/**
 * Removes a layer and everything on it.
 *
 * Refuses the last one. A document with no layers has nowhere to put the next
 * thing drawn, and every path that had to cope with that absence would be a
 * path that is never exercised until the day it breaks.
 */
export function removeLayer(doc: Doc, id: LayerId): Doc {
  if (doc.layers.length <= 1) return doc
  if (!doc.layers.some((layer) => layer.id === id)) return doc
  return {
    ...doc,
    layers: doc.layers.filter((layer) => layer.id !== id),
    nodes: doc.nodes.filter((node) => node.layer !== id),
  }
}

export function setLayerFlags(
  doc: Doc,
  id: LayerId,
  flags: { visible?: boolean; locked?: boolean; name?: string; opacity?: number },
): Doc {
  let changed = false
  const layers = doc.layers.map((layer) => {
    if (layer.id !== id) return layer
    changed = true
    return { ...layer, ...flags }
  })
  return changed ? { ...doc, layers } : doc
}

export function moveLayerTo(doc: Doc, id: LayerId, index: number): Doc {
  const from = doc.layers.findIndex((layer) => layer.id === id)
  if (from < 0) return doc
  const target = Math.max(0, Math.min(doc.layers.length - 1, index))
  if (from === target) return doc
  const layers = [...doc.layers]
  const [moved] = layers.splice(from, 1)
  layers.splice(target, 0, moved)
  return { ...doc, layers }
}

/**
 * Moves nodes onto another layer, on TOP of it.
 *
 * Relabelling them where they sit would drop them somewhere arbitrary in the
 * new layer's stack — usually underneath everything, since array position is
 * what decides z within a layer. Sending them to the front is both the useful
 * answer and the visible one: what you moved is what you can see.
 */
export function assignLayer(doc: Doc, ids: readonly NodeId[], layer: LayerId): Doc {
  const wanted = new Set(ids)
  if (!doc.layers.some((entry) => entry.id === layer)) return doc

  const moving = doc.nodes.filter((node) => wanted.has(node.id) && node.layer !== layer)
  if (moving.length === 0) return doc
  const rest = doc.nodes.filter((node) => !moving.includes(node))
  return { ...doc, nodes: [...rest, ...moving.map((node) => ({ ...node, layer }))] }
}
