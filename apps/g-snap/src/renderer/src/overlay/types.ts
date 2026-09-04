import type { Rect } from '@shared/types'

export type ToolId = 'none' | 'pen' | 'marker' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text'

export interface Point {
  x: number
  y: number
}

interface ShapeBase {
  id: string
  color: string
  thickness: number
}

/** Freehand pen and highlighter — both are point lists. */
export interface FreehandShape extends ShapeBase {
  type: 'pen' | 'marker'
  /** Konva Line format: [x1, y1, x2, y2, ...] */
  points: number[]
}

/** Straight line and arrow. */
export interface SegmentShape extends ShapeBase {
  type: 'line' | 'arrow'
  from: Point
  to: Point
}

/** Rectangle and ellipse (outline only, no fill). */
export interface BoxShape extends ShapeBase {
  type: 'rect' | 'ellipse'
  rect: Rect
}

export interface TextShape extends ShapeBase {
  type: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export type Shape = FreehandShape | SegmentShape | BoxShape | TextShape

/** The eight handles on the selection rectangle. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** A handle's relative position within the selection (0 = left/top, 1 = right/bottom). */
export const HANDLE_ANCHOR: Record<HandleId, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

export const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/** Builds a rectangle from two points without producing negative sizes. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** Confines a rectangle to the given bounds, preserving its size. */
export function clampRect(rect: Rect, bounds: Rect): Rect {
  const width = Math.min(rect.width, bounds.width)
  const height = Math.min(rect.height, bounds.height)
  return {
    width,
    height,
    x: Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.height - height),
  }
}

export function pointInRect(p: Point, rect: Rect): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
}

/** Highlighter opacity — so it reads differently from the pen. */
export const MARKER_OPACITY = 0.35

/**
 * How much fatter the highlighter STARTS than the pen.
 *
 * Only a starting point now. Each tool carries its own size, so the highlighter
 * is no longer the pen's size multiplied at draw time — its slider sets the
 * real stroke width, the way every other tool's does.
 */
export const MARKER_SIZE_SCALE = 4

/** Every tool except the pointer carries a size. */
export type SizedTool = Exclude<ToolId, 'none'>

export const SIZED_TOOLS: SizedTool[] = [
  'pen',
  'marker',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
]

/**
 * Slider range per tool, in stroke pixels — font size for text.
 *
 * The highlighter gets its own, much wider range: a 3px highlighter is not a
 * highlighter, and clamping it to the pen's scale was why its size never felt
 * adjustable.
 */
export const SIZE_RANGE: Record<SizedTool, { min: number; max: number }> = {
  pen: { min: 1, max: 16 },
  marker: { min: 6, max: 60 },
  line: { min: 1, max: 16 },
  arrow: { min: 1, max: 16 },
  rect: { min: 1, max: 16 },
  ellipse: { min: 1, max: 16 },
  text: { min: 1, max: 16 },
}

/** Keeps a size inside its tool's range. */
export function clampSize(tool: SizedTool, value: number): number {
  const { min, max } = SIZE_RANGE[tool]
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** A selection smaller than this counts as an accidental click. */
export const MIN_SELECTION_SIZE = 8
