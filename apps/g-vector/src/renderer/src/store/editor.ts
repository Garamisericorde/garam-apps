/**
 * Editor state.
 *
 * There are two documents, on purpose. `doc` is what has been committed and
 * what undo walks; `preview` is what a drag in progress looks like. A drag
 * never touches history — otherwise dragging a rectangle across the canvas
 * leaves 200 undo steps behind it — and dropping a drag is a matter of
 * clearing `preview` rather than replaying anything.
 */
import { create } from 'zustand'
import { starterDoc } from '../doc/defaults'
import { newId, type Doc, type LayerId, type NodeId, type SceneNode } from '../doc/types'
import { createImage, createLayer } from '../doc/defaults'
import { ensurePath, removeAnchors, sameAnchor, type AnchorRef } from '../doc/anchors'
import {
  addLayer,
  addNodes,
  assignLayer,
  moveLayerTo,
  moveNodeWithinLayer,
  removeLayer,
  removeNodes,
  reorderNodes,
  setLayerFlags,
  setNodeFlags,
  translateNodes,
} from '../doc/ops'
import type { Guide, SpacingGuide } from '../snap/types'
import { clampZoom, fitRect, zoomAt, type Viewport } from '../view/viewport'

export type ToolId = 'select' | 'direct' | 'pen' | 'curvature' | 'rect' | 'ellipse' | 'hand'

/** The path a pen or curvature drawing session is currently extending. */
export interface PenDraft {
  nodeId: NodeId
  subpath: number
}

/** Tools that edit anchors, and so want the path chrome on screen. */
export function isPathTool(tool: ToolId): boolean {
  return tool === 'direct' || tool === 'pen' || tool === 'curvature'
}

const HISTORY_LIMIT = 200

export interface EditorState {
  doc: Doc
  preview: Doc | null
  past: Doc[]
  future: Doc[]

  selection: NodeId[]
  /** Anchors picked out inside the selected paths, for the direct tool. */
  anchorSelection: AnchorRef[]
  /** Set while a pen or curvature path is being drawn. */
  penDraft: PenDraft | null
  tool: ToolId
  viewport: Viewport
  /**
   * The canvas element's size in CSS pixels, published by the canvas itself.
   * Zoom and fit are about a point on screen, so they cannot be computed
   * anywhere that does not know how big the screen is.
   */
  canvasSize: { width: number; height: number }

  snapEnabled: boolean
  gridVisible: boolean
  gridSize: number

  /** Live snap feedback; cleared the moment a drag ends. */
  guides: Guide[]
  spacing: SpacingGuide[]

  /**
   * The layer everything new goes onto. Never empty and never stale: a document
   * always has at least one layer, and this always names one of them.
   */
  activeLayer: LayerId

  /** Nodes copied inside the editor, waiting for a paste. */
  clipboard: SceneNode[]

  setTool: (tool: ToolId) => void
  setViewport: (viewport: Viewport) => void
  setCanvasSize: (size: { width: number; height: number }) => void
  /** Zooms about the middle of the canvas, which is where the eye already is. */
  setZoom: (zoom: number) => void
  fitArtboard: () => void

  setSelection: (ids: readonly NodeId[]) => void
  toggleSelection: (id: NodeId) => void
  clearSelection: () => void
  selectAll: () => void

  setAnchorSelection: (refs: readonly AnchorRef[]) => void
  toggleAnchorSelection: (ref: AnchorRef) => void
  clearAnchorSelection: () => void
  deleteAnchorSelection: () => void

  setPenDraft: (draft: PenDraft | null) => void
  /** Ends a drawing session, discarding a path too short to be one. */
  finishDrawing: () => void

  /** Writes a drag-in-progress document. Does not touch history. */
  setPreview: (doc: Doc | null) => void
  /** Folds the preview into the document as one undoable step. */
  commitPreview: () => void
  /** Commits an edit made outside a drag. */
  commit: (doc: Doc) => void

  setGuides: (guides: Guide[], spacing: SpacingGuide[]) => void
  clearGuides: () => void

  toggleSnap: () => void
  toggleGrid: () => void

  /** Places a bitmap in the middle of the view, scaled to fit it. */
  placeImage: (image: { src: string; natural: { width: number; height: number }; name: string }) => void

  setNodeFlag: (id: NodeId, flags: { visible?: boolean; locked?: boolean; name?: string }) => void
  /** Moves a node within its own layer's stack. */
  moveNode: (id: NodeId, slot: number) => void

  setActiveLayer: (id: LayerId) => void
  newLayer: () => void
  deleteLayer: (id: LayerId) => void
  setLayerFlag: (
    id: LayerId,
    flags: { visible?: boolean; locked?: boolean; name?: string; opacity?: number },
  ) => void
  moveLayer: (id: LayerId, index: number) => void
  /** Sends the current selection to another layer. */
  moveSelectionToLayer: (id: LayerId) => void

  copySelection: () => void
  pasteClipboard: () => void

  deleteSelection: () => void
  duplicateSelection: () => void
  nudgeSelection: (dx: number, dy: number) => void
  reorderSelection: (move: 'front' | 'forward' | 'backward' | 'back') => void

  undo: () => void
  redo: () => void
}

/**
 * The active layer, or the topmost one when undo has taken it away.
 *
 * There is always a layer to be active on, so this never returns nothing — the
 * alternative is a drawing tool with nowhere to put what it draws.
 */
function keepLayer(doc: Doc, wanted: LayerId): LayerId {
  return doc.layers.some((layer) => layer.id === wanted)
    ? wanted
    : doc.layers[doc.layers.length - 1].id
}

/** The document a renderer should draw: the drag if there is one, else the doc. */
export function activeDoc(state: Pick<EditorState, 'doc' | 'preview'>): Doc {
  return state.preview ?? state.doc
}

const INITIAL_DOC = starterDoc()

export const useEditor = create<EditorState>((set, get) => ({
  doc: INITIAL_DOC,
  activeLayer: INITIAL_DOC.layers[0].id,
  preview: null,
  past: [],
  future: [],

  selection: [],
  anchorSelection: [],
  penDraft: null,
  tool: 'select',
  viewport: { x: -80, y: -60, zoom: 1 },
  canvasSize: { width: 0, height: 0 },

  snapEnabled: true,
  gridVisible: false,
  gridSize: 8,

  guides: [],
  spacing: [],
  clipboard: [],

  setTool: (tool) => {
    // Leaving a path tool ends whatever was being drawn: a half-finished pen
    // stroke that survives a tool change reappears on the next click somewhere
    // else entirely.
    get().finishDrawing()
    set((s) => ({
      tool,
      guides: [],
      spacing: [],
      anchorSelection: isPathTool(tool) ? s.anchorSelection : [],
    }))
  },
  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),

  setZoom: (zoom) =>
    set((s) => {
      const centre = { x: s.canvasSize.width / 2, y: s.canvasSize.height / 2 }
      return { viewport: zoomAt(s.viewport, centre, clampZoom(zoom)) }
    }),

  fitArtboard: () =>
    set((s) => {
      if (s.canvasSize.width === 0) return {}
      const board = { x: 0, y: 0, width: s.doc.artboard.width, height: s.doc.artboard.height }
      return { viewport: fitRect(board, s.canvasSize) }
    }),

  setSelection: (ids) => set({ selection: [...ids] }),
  toggleSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),
  selectAll: () => set((s) => ({ selection: s.doc.nodes.filter((n) => !n.locked).map((n) => n.id) })),

  setAnchorSelection: (refs) => set({ anchorSelection: [...refs] }),
  toggleAnchorSelection: (ref) =>
    set((s) => ({
      anchorSelection: s.anchorSelection.some((a) => sameAnchor(a, ref))
        ? s.anchorSelection.filter((a) => !sameAnchor(a, ref))
        : [...s.anchorSelection, ref],
    })),
  clearAnchorSelection: () => set({ anchorSelection: [] }),

  deleteAnchorSelection: () => {
    const { doc, anchorSelection, commit } = get()
    if (anchorSelection.length === 0) return
    // A rectangle still showing its live-shape anchors has none to remove until
    // it is a real path, so the conversion happens as part of the same step.
    let next = doc
    for (const id of new Set(anchorSelection.map((ref) => ref.nodeId))) {
      next = ensurePath(next, id)
    }
    commit(removeAnchors(next, anchorSelection))
    set({ anchorSelection: [] })
  },

  setPenDraft: (penDraft) => set({ penDraft }),

  finishDrawing: () => {
    const { penDraft, doc } = get()
    if (!penDraft) return
    const node = doc.nodes.find((n) => n.id === penDraft.nodeId)
    const anchors =
      node?.type === 'path' ? (node.subpaths[penDraft.subpath]?.anchors.length ?? 0) : 0
    // One anchor is a click, not a path. Dropping it here means a stray click
    // with the pen does not litter the document with invisible one-point nodes.
    if (node && anchors < 2) {
      set({
        penDraft: null,
        guides: [],
        spacing: [],
        doc: { ...doc, nodes: doc.nodes.filter((n) => n.id !== penDraft.nodeId) },
        selection: get().selection.filter((id) => id !== penDraft.nodeId),
      })
      return
    }
    set({ penDraft: null, guides: [], spacing: [] })
  },

  setPreview: (doc) => set({ preview: doc }),

  commitPreview: () => {
    const { preview, doc, past } = get()
    if (!preview || preview === doc) {
      set({ preview: null, guides: [], spacing: [] })
      return
    }
    set({
      doc: preview,
      preview: null,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: [],
      guides: [],
      spacing: [],
    })
  },

  commit: (next) => {
    const { doc, past } = get()
    if (next === doc) return
    set({ doc: next, preview: null, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] })
  },

  setGuides: (guides, spacing) => set({ guides, spacing }),
  clearGuides: () => set({ guides: [], spacing: [] }),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled, guides: [], spacing: [] })),
  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),

  placeImage: (image) => {
    const { doc, viewport, canvasSize, commit } = get()
    const viewWidth = (canvasSize.width || 800) / viewport.zoom
    const viewHeight = (canvasSize.height || 600) / viewport.zoom
    // Big references are common and a 4000px screenshot dropped at full size
    // would land mostly off screen, so it comes in fitted to the view.
    const fit = Math.min(
      1,
      (viewWidth * 0.8) / image.natural.width,
      (viewHeight * 0.8) / image.natural.height,
    )
    const width = image.natural.width * fit
    const height = image.natural.height * fit
    const node = createImage({
      ...image,
      layer: get().activeLayer,
      x: viewport.x + viewWidth / 2 - width / 2,
      y: viewport.y + viewHeight / 2 - height / 2,
      width,
      height,
    })
    commit(addNodes(doc, [node]))
    set({ selection: [node.id], anchorSelection: [] })
  },

  setNodeFlag: (id, flags) => {
    const { doc, commit, selection } = get()
    commit(setNodeFlags(doc, id, flags))
    // A node that has just been locked or hidden cannot stay selected, or the
    // next drag moves something the user can no longer see or click.
    if (flags.locked === true || flags.visible === false) {
      set({
        selection: selection.filter((other) => other !== id),
        anchorSelection: get().anchorSelection.filter((ref) => ref.nodeId !== id),
      })
    }
  },

  moveNode: (id, slot) => {
    const { doc, commit } = get()
    commit(moveNodeWithinLayer(doc, id, slot))
  },

  setActiveLayer: (id) => {
    if (get().doc.layers.some((layer) => layer.id === id)) set({ activeLayer: id })
  },

  newLayer: () => {
    const { doc, activeLayer, commit } = get()
    const layer = createLayer(`Layer ${doc.layers.length + 1}`)
    commit(addLayer(doc, layer, activeLayer))
    // A new layer you are not drawing on is a new layer you will wonder about,
    // so it takes over immediately.
    set({ activeLayer: layer.id, selection: [], anchorSelection: [] })
  },

  deleteLayer: (id) => {
    const { doc, commit } = get()
    const next = removeLayer(doc, id)
    // removeLayer refuses the last one, so this is also the guard for it.
    if (next === doc) return
    commit(next)
    set({
      activeLayer: get().activeLayer === id ? next.layers[next.layers.length - 1].id : get().activeLayer,
      selection: [],
      anchorSelection: [],
    })
  },

  setLayerFlag: (id, flags) => {
    const { doc, commit, selection } = get()
    commit(setLayerFlags(doc, id, flags))
    if (flags.locked === true || flags.visible === false) {
      // Nothing on a layer that has just been hidden or locked may stay
      // selected, or the next drag moves what can no longer be seen.
      const doomed = new Set(
        get().doc.nodes.filter((node) => node.layer === id).map((node) => node.id),
      )
      set({
        selection: selection.filter((nodeId) => !doomed.has(nodeId)),
        anchorSelection: get().anchorSelection.filter((ref) => !doomed.has(ref.nodeId)),
      })
    }
  },

  moveLayer: (id, index) => {
    const { doc, commit } = get()
    commit(moveLayerTo(doc, id, index))
  },

  moveSelectionToLayer: (id) => {
    const { doc, selection, commit } = get()
    if (selection.length === 0) return
    commit(assignLayer(doc, selection, id))
    set({ activeLayer: id })
  },

  copySelection: () => {
    const { doc, selection } = get()
    const wanted = new Set(selection)
    set({ clipboard: doc.nodes.filter((node) => wanted.has(node.id)) })
  },

  pasteClipboard: () => {
    const { clipboard, doc, commit } = get()
    if (clipboard.length === 0) return
    // Offset by building the copies already moved, rather than translating them
    // afterwards: a locked node ignores a translate, and a pasted copy landing
    // exactly on its original is indistinguishable from nothing happening.
    const live = new Set(doc.layers.map((layer) => layer.id))
    const fallback = get().activeLayer
    const copies: SceneNode[] = clipboard.map((node) => {
      const t = node.transform
      return {
        ...node,
        id: newId(node.type[0]),
        // The layer it was copied from may have been deleted since.
        layer: live.has(node.layer) ? node.layer : fallback,
        transform: [t[0], t[1], t[2], t[3], t[4] + 16, t[5] + 16],
      }
    })
    commit(addNodes(doc, copies))
    set({ selection: copies.map((node) => node.id), anchorSelection: [] })
  },

  deleteSelection: () => {
    const { doc, selection, commit } = get()
    if (selection.length === 0) return
    commit(removeNodes(doc, selection))
    set({ selection: [], anchorSelection: [] })
  },

  duplicateSelection: () => {
    const { doc, selection, commit } = get()
    if (selection.length === 0) return
    // Offset by a visible amount, so the copy is not hiding exactly behind the
    // original with no way to tell that anything happened.
    const copies: SceneNode[] = doc.nodes
      .filter((node) => selection.includes(node.id))
      .map((node) => ({ ...node, id: newId(node.type[0]) }))
    const ids = copies.map((node) => node.id)
    commit(translateNodes(addNodes(doc, copies), ids, 10, 10))
    set({ selection: ids })
  },

  nudgeSelection: (dx, dy) => {
    const { doc, selection, commit } = get()
    if (selection.length === 0) return
    commit(translateNodes(doc, selection, dx, dy))
  },

  reorderSelection: (move) => {
    const { doc, selection, commit } = get()
    if (selection.length === 0) return
    commit(reorderNodes(doc, selection, move))
  },

  undo: () => {
    const { past, doc, future, selection } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const live = new Set(previous.nodes.map((n) => n.id))
    const layer = keepLayer(previous, get().activeLayer)
    set({
      doc: previous,
      preview: null,
      past: past.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY_LIMIT),
      // A node the undo removed cannot stay selected, or the inspector shows
      // fields for something that is no longer in the document.
      selection: selection.filter((id) => live.has(id)),
      anchorSelection: [],
      activeLayer: layer,
      guides: [],
      spacing: [],
    })
  },

  redo: () => {
    const { past, doc, future, selection } = get()
    if (future.length === 0) return
    const next = future[0]
    const live = new Set(next.nodes.map((n) => n.id))
    const layer = keepLayer(next, get().activeLayer)
    set({
      doc: next,
      preview: null,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      selection: selection.filter((id) => live.has(id)),
      anchorSelection: [],
      activeLayer: layer,
      guides: [],
      spacing: [],
    })
  },
}))
