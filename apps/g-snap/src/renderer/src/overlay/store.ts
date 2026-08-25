import { create } from 'zustand'
import type { DisplayShot, Rect } from '@shared/types'
import type { Shape, ToolId } from './types'

let shapeCounter = 0
const nextId = (): string => `s${++shapeCounter}`

export type Phase = 'loading' | 'idle' | 'ready'

interface OverlayState {
  phase: Phase
  shots: DisplayShot[]
  /** Overlay penceresinin kapsadigi alan (DIP). Sahne koordinatlari 0,0 tabanlidir. */
  stage: { width: number; height: number }
  /** Ekran uzayindaki kokene donusum icin — dosya adlari ve gunluk icin saklaniyor. */
  origin: { x: number; y: number }

  selection: Rect | null
  tool: ToolId
  color: string
  thickness: number
  showMagnifier: boolean

  shapes: Shape[]
  redoStack: Shape[]
  /** Fare basiliyken cizilmekte olan, henuz kesinlesmemis sekil. */
  draft: Shape | null

  /** Metin araci ile duzenlenen konum; null ise duzenleme yok. */
  textDraft: { x: number; y: number; value: string } | null

  init: (payload: {
    shots: DisplayShot[]
    stage: { width: number; height: number }
    origin: { x: number; y: number }
    color: string
    thickness: number
    showMagnifier: boolean
  }) => void

  setSelection: (rect: Rect | null) => void
  setTool: (tool: ToolId) => void
  setColor: (color: string) => void
  setThickness: (thickness: number) => void

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

  /** Yeni bir secim baslatmak icin sekilleri ve secimi sifirlar. */
  resetSelection: () => void
}

export const useOverlay = create<OverlayState>((set, get) => ({
  phase: 'loading',
  shots: [],
  stage: { width: 0, height: 0 },
  origin: { x: 0, y: 0 },

  selection: null,
  tool: 'none',
  color: '#e94560',
  thickness: 3,
  showMagnifier: true,

  shapes: [],
  redoStack: [],
  draft: null,
  textDraft: null,

  init: ({ shots, stage, origin, color, thickness, showMagnifier }) =>
    set({ phase: 'idle', shots, stage, origin, color, thickness, showMagnifier }),

  setSelection: (rect) =>
    set({ selection: rect, phase: rect ? 'ready' : 'idle' }),

  setTool: (tool) => {
    // Baska bir araca gecerken yarim kalan metni kaydet.
    const { textDraft } = get()
    if (textDraft) get().commitText()
    set({ tool })
  },

  setColor: (color) => set({ color }),
  setThickness: (thickness) => set({ thickness }),

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
    const { textDraft, color, thickness, shapes } = get()
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

/** Kalinlik kaydiricisi metin araci icin punto olarak yorumlanir. */
export function textFontSize(thickness: number): number {
  return 10 + thickness * 4
}

export { nextId }
