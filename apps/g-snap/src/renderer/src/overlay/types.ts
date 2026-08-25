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

/** Serbest cizim (kalem) ve fosforlu kalem — ikisi de nokta dizisi. */
export interface FreehandShape extends ShapeBase {
  type: 'pen' | 'marker'
  /** Konva Line formati: [x1, y1, x2, y2, ...] */
  points: number[]
}

/** Duz cizgi ve ok. */
export interface SegmentShape extends ShapeBase {
  type: 'line' | 'arrow'
  from: Point
  to: Point
}

/** Dikdortgen ve elips (icleri bos, yalnizca kenarlik). */
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

/** Secim dikdortgeninin sekiz tutamagi. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Bir tutamacin secim icindeki goreli konumu (0 = sol/ust, 1 = sag/alt). */
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

/** Negatif genislik/yukseklik uretmeden iki noktadan dikdortgen kurar. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** Dikdortgeni sinirlar icine hapseder (boyutunu korur). */
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

/** Fosforlu kalem seffafligi — normal kalemden ayirt edilmesi icin. */
export const MARKER_OPACITY = 0.35

/** Fosforlu kalem kalinlik carpani. */
export const MARKER_THICKNESS_SCALE = 4

/** Bu boyutun altindaki secim "kaza eseri tiklama" sayilir. */
export const MIN_SELECTION_SIZE = 8
