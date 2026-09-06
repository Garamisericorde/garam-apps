import { describe, expect, it } from 'vitest'
import {
  createImage,
  createLayer,
  createRect,
  DEFAULT_LAYER_NAME,
  emptyDoc,
} from '../src/renderer/src/doc/defaults'
import {
  addLayer,
  assignLayer,
  moveLayerTo,
  moveNodeWithinLayer,
  removeLayer,
  reorderNodes,
  setLayerFlags,
  setNodeFlags,
  translateNodes,
  updateNodes,
} from '../src/renderer/src/doc/ops'
import { isEditable, isShown, paintOrder, type Doc } from '../src/renderer/src/doc/types'

/** A document with two layers: three shapes below, two above. */
function twoLayers(): Doc {
  const base = emptyDoc()
  const upper = createLayer('Upper')
  const doc = addLayer(base, upper)
  const lower = base.layers[0].id
  return {
    ...doc,
    nodes: [
      createRect({ layer: lower, x: 0, y: 0, width: 10, height: 10, name: 'back' }),
      createRect({ layer: lower, x: 0, y: 0, width: 10, height: 10, name: 'middle' }),
      createRect({ layer: lower, x: 0, y: 0, width: 10, height: 10, name: 'front' }),
      createRect({ layer: upper.id, x: 0, y: 0, width: 10, height: 10, name: 'over-1' }),
      createRect({ layer: upper.id, x: 0, y: 0, width: 10, height: 10, name: 'over-2' }),
    ],
  }
}

const names = (doc: Doc): string[] => doc.nodes.map((n) => n.name)
const painted = (doc: Doc): string[] => paintOrder(doc).map((n) => n.name)

describe('a document always has a layer', () => {
  it('starts with one, called Default', () => {
    const doc = emptyDoc()
    expect(doc.layers).toHaveLength(1)
    expect(doc.layers[0].name).toBe(DEFAULT_LAYER_NAME)
  })

  /**
   * The last layer cannot go. A document with nowhere to put the next thing
   * drawn is a state nothing else in the editor copes with, and every branch
   * written to handle it would be a branch that is never exercised until the
   * day it breaks.
   */
  it('refuses to remove the only one', () => {
    const doc = emptyDoc()
    expect(removeLayer(doc, doc.layers[0].id)).toBe(doc)
  })

  it('removes a layer with everything on it', () => {
    const doc = twoLayers()
    const upper = doc.layers[1].id
    const after = removeLayer(doc, upper)
    expect(after.layers).toHaveLength(1)
    expect(names(after)).toEqual(['back', 'middle', 'front'])
  })
})

describe('paint order', () => {
  /**
   * `doc.nodes` is a flat bag: its order decides z WITHIN a layer, and the
   * layer list decides the rest. Reading the array as the whole stack is the
   * mistake this exists to catch.
   */
  it('runs layer by layer, bottom to top', () => {
    const doc = twoLayers()
    expect(painted(doc)).toEqual(['back', 'middle', 'front', 'over-1', 'over-2'])

    const flipped = moveLayerTo(doc, doc.layers[1].id, 0)
    expect(painted(flipped)).toEqual(['over-1', 'over-2', 'back', 'middle', 'front'])
  })
})

describe('reordering', () => {
  /**
   * "Bring to front" means the front of the object's OWN layer. Reaching past
   * the layer above would make the layer stack a suggestion.
   */
  it('stays inside the layer', () => {
    const doc = twoLayers()
    const back = doc.nodes[0].id
    const after = reorderNodes(doc, [back], 'front')
    expect(painted(after)).toEqual(['middle', 'front', 'back', 'over-1', 'over-2'])
  })

  it('moves a node to an absolute position within its layer', () => {
    const doc = twoLayers()
    const back = doc.nodes[0].id
    expect(painted(moveNodeWithinLayer(doc, back, 2))).toEqual([
      'middle',
      'front',
      'back',
      'over-1',
      'over-2',
    ])
  })

  it('clamps rather than dropping the node', () => {
    const doc = twoLayers()
    const front = doc.nodes[2].id
    expect(painted(moveNodeWithinLayer(doc, front, 99))).toEqual(painted(doc))
  })

  it('sends a node to another layer', () => {
    const doc = twoLayers()
    const front = doc.nodes[2].id
    const after = assignLayer(doc, [front], doc.layers[1].id)
    expect(painted(after)).toEqual(['back', 'middle', 'over-1', 'over-2', 'front'])
  })
})

describe('locking and hiding', () => {
  /**
   * A locked LAYER locks everything on it, so `node.locked` alone is never the
   * right question — every edit, hit-test and renderer has to ask about both.
   */
  it('cascades from the layer to its nodes', () => {
    const doc = twoLayers()
    const lower = doc.layers[0].id
    const id = doc.nodes[0].id

    const locked = setLayerFlags(doc, lower, { locked: true })
    expect(isEditable(locked, locked.nodes[0])).toBe(false)
    expect(translateNodes(locked, [id], 10, 10).nodes[0].transform[4]).toBe(0)
    expect(updateNodes(locked, [id], { opacity: 0.5 }).nodes[0].opacity).toBe(1)
    // Still painted, though: a locked layer is protected, not hidden.
    expect(isShown(locked, locked.nodes[0])).toBe(true)

    const hidden = setLayerFlags(doc, lower, { visible: false })
    expect(isShown(hidden, hidden.nodes[0])).toBe(false)
  })

  it('can always be undone, even though edits cannot touch a locked node', () => {
    const doc = emptyDoc()
    const withNode: Doc = {
      ...doc,
      nodes: [createRect({ layer: doc.layers[0].id, x: 0, y: 0, width: 10, height: 10 })],
    }
    const id = withNode.nodes[0].id
    const locked = setNodeFlags(withNode, id, { locked: true })
    expect(translateNodes(locked, [id], 10, 10).nodes[0].transform[4]).toBe(0)
    // The flag itself still gets through, or the lock would be a one-way door.
    expect(setNodeFlags(locked, id, { locked: false }).nodes[0].locked).toBe(false)
  })

  it('renames without touching anything else', () => {
    const doc = twoLayers()
    const renamed = setLayerFlags(doc, doc.layers[0].id, { name: 'Reference' })
    expect(renamed.layers.map((l) => l.name)).toEqual(['Reference', 'Upper'])
    expect(names(renamed)).toEqual(names(doc))
  })
})

describe('placed images', () => {
  it('arrive unlocked, so they can be put where they belong', () => {
    const doc = emptyDoc()
    const node = createImage({
      layer: doc.layers[0].id,
      src: 'data:image/png;base64,',
      natural: { width: 800, height: 600 },
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      name: 'ref.png',
    })
    expect(node.locked).toBe(false)
    expect(node.visible).toBe(true)
    // A reference is not artwork: it has no fill or stroke of its own to paint.
    expect(node.fill.kind).toBe('none')
  })
})
