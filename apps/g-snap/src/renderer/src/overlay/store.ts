import { create } from 'zustand'
import type { Rect } from '@shared/types'
import type { Shape, SizedTool, ToolId } from './types'
import { clampSize, MARKER_SIZE_SCALE, SIZED_TOOLS } from './types'

let shapeCounter = 0
const nextId = (): string => `s${++shapeCounter}`

export type Phase = 'loading' | 'idle' | 'ready'

interface OverlayState {
  phase: Phase
  /** Area the overlay window covers (DIP). Stage coordinates are 0,0 based. */
  stage: { width: number; height: number }
  /** Origin in screen space — kept for file names and logging. */
  origin: { x: number; y: number }

  selection: Rect | null
  tool: ToolId
  color: string
  /**
   * One size per tool, not one size for all of them.
   *
   * A highlighter and a pen are never the same width, so a shared slider means
   * changing one ruins the other — which is why the size control never seemed
   * to do anything useful.
   */
  sizes: Record<SizedTool, number>

  shapes: Shape[]
  redoStack: Shape[]
  /** The shape being drawn while the mouse is down, not yet committed. */
  draft: Shape | null

  /** Position being edited with the text tool; null when not editing. */
  textDraft: { x: number; y: number; value: string } | null

  /** Wipes all per-capture state and applies the settings defaults. */
  reset: (payload: {
    origin: { x: number; y: number }
    color: string
    thickness: number
    }) => void

  /** Set once the composite canvas is built and the real stage size is known. */
  setStage: (size: { width: number; height: number }) => void

  setSelection: (rect: Rect | null) => void
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setSize: (tool: SizedTool, value: number) => void

  setDraft: (shape: Shape | null) => void
  commitDraft: () => void
  addShape: (shape: Omit<Shape, 'id'> & { id?: string }) => void

  undo: () => void
  redo: () => void
  clearShapes: () => void

  startText: (x: number, y: number) => void
  updateText: (value: string) => void
  commitText: () => void
  cancelText: () => void

  /** Clears the selection and every shape, ready for a new selection. */
  resetSelection: () => void
}

export const useOverlay = create<OverlayState>((set, get) => ({
  phase: 'loading',
  stage: { width: 0, height: 0 },
  origin: { x: 0, y: 0 },

  selection: null,
  tool: 'none',
  color: '#e94560',
  sizes: defaultSizes(3),

  shapes: [],
  redoStack: [],
  draft: null,
  textDraft: null,

  reset: ({ origin, color, thickness }) =>
    set({
      phase: 'idle',
      origin,
      color,
      sizes: defaultSizes(thickness),
      selection: null,
      tool: 'none',
      shapes: [],
      redoStack: [],
      draft: null,
      textDraft: null,
    }),

  setStage: (size) => set({ stage: size }),

  setSelection: (rect) =>
    set({ selection: rect, phase: rect ? 'ready' : 'idle' }),

  setTool: (tool) => {
    // Commit any half-typed text when switching tools.
    const { textDraft } = get()
    if (textDraft) get().commitText()
    set({ tool })
  },

  setColor: (color) => set({ color }),

  setSize: (tool, value) =>
    set((state) => ({ sizes: { ...state.sizes, [tool]: clampSize(tool, value) } })),

  setDraft: (draft) => set({ draft }),

  commitDraft: () => {
    const { draft, shapes } = get()
    if (!draft) return
    set({ shapes: [...shapes, draft], draft: null, redoStack: [] })
  },

  addShape: (shape) =>
    set((state) => ({
      shapes: [...state.shapes, { ...shape, id: shape.id ?? nextId() } as Shape],
      redoStack: [],
    })),

  undo: () => {
    const { shapes, redoStack } = get()
    if (shapes.length === 0) return
    const last = shapes[shapes.length - 1]
    set({ shapes: shapes.slice(0, -1), redoStack: [...redoStack, last] })
  },

  redo: () => {
    const { shapes, redoStack } = get()
    if (redoStack.length === 0) return
    const last = redoStack[redoStack.length - 1]
    set({ shapes: [...shapes, last], redoStack: redoStack.slice(0, -1) })
  },

  clearShapes: () => set({ shapes: [], redoStack: [], draft: null }),

  startText: (x, y) => set({ textDraft: { x, y, value: '' } }),

  updateText: (value) =>
    set((state) => (state.textDraft ? { textDraft: { ...state.textDraft, value } } : {})),

  commitText: () => {
    const { textDraft, color, sizes, shapes } = get()
    const thickness = sizes.text
    if (!textDraft) return

    const text = textDraft.value.trim()
    if (text) {
      set({
        shapes: [
          ...shapes,
          {
            id: nextId(),
            type: 'text',
            x: textDraft.x,
            y: textDraft.y,
            text,
            color,
            thickness,
            fontSize: textFontSize(thickness),
          },
        ],
        redoStack: [],
      })
    }
    set({ textDraft: null })
  },

  cancelText: () => set({ textDraft: null }),

  resetSelection: () =>
    set({ selection: null, phase: 'idle', shapes: [], redoStack: [], draft: null, textDraft: null }),
}))

/** For the text tool the thickness slider is read as a font size. */
export function textFontSize(thickness: number): number {
  return 10 + thickness * 4
}

/**
 * Seeds every tool from the one size the settings store.
 *
 * The highlighter starts wider, because the settings default is a pen default
 * and a pen-width highlighter is useless.
 */
function defaultSizes(thickness: number): Record<SizedTool, number> {
  const sizes = {} as Record<SizedTool, number>
  for (const tool of SIZED_TOOLS) {
    sizes[tool] = clampSize(tool, tool === 'marker' ? thickness * MARKER_SIZE_SCALE : thickness)
  }
  return sizes
}

export { nextId }
