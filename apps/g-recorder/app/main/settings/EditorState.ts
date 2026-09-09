import { readJson, writeJson } from '@garam/core'
import { join } from 'path'
import type { EditorState, FrameCrop } from '../../shared/types'
import type { TimelineItem } from '../../shared/timeline'
import { userDataDir } from '../../shared/paths'
import { logger } from '../logging/logger'

/*
 * Kept because an edit is work, and until now every restart threw it away —
 * closing the app, or installing an update, meant laying the same clips out
 * again from scratch. Nothing here is a copy of anything: an item is a window
 * onto a file that is still where it was, so the whole arrangement is a few
 * hundred bytes.
 */
export const EMPTY_EDITOR_STATE: EditorState = {
  timeline: { video: [], audio: [] },
  crop: null,
  playhead: 0,
}

function filePath(): string {
  return join(userDataDir(), 'editor.json')
}

/**
 * Read it back, keeping only what still makes sense.
 *
 * Validated rather than trusted: this file survives version changes and a hand
 * edit, and an editor that will not open because one number is a string is
 * worse than an editor that opens empty.
 */
export async function readEditorState(): Promise<EditorState> {
  const stored = await readJson<unknown>(filePath(), EMPTY_EDITOR_STATE)

  try {
    return sanitizeEditorState(stored)
  } catch (err) {
    logger.warn('Could not read the saved timeline; starting empty', String(err))
    return EMPTY_EDITOR_STATE
  }
}

export async function writeEditorState(state: unknown): Promise<void> {
  await writeJson(filePath(), sanitizeEditorState(state))
}

export function sanitizeEditorState(value: unknown): EditorState {
  if (typeof value !== 'object' || value === null) return EMPTY_EDITOR_STATE
  const state = value as Partial<EditorState>

  const timeline = state.timeline
  if (typeof timeline !== 'object' || timeline === null) return EMPTY_EDITOR_STATE

  return {
    timeline: {
      video: lane(timeline.video),
      audio: lane(timeline.audio),
    },
    crop: crop(state.crop),
    playhead: finite(state.playhead, 0),
  }
}

function lane(items: unknown): TimelineItem[] {
  if (!Array.isArray(items)) return []

  const kept: TimelineItem[] = []
  for (const value of items) {
    if (typeof value !== 'object' || value === null) continue
    const item = value as Partial<TimelineItem>

    if (typeof item.id !== 'string' || typeof item.path !== 'string') continue
    if (!Number.isFinite(item.sourceIn) || !Number.isFinite(item.sourceOut)) continue

    kept.push({
      id: item.id,
      path: item.path,
      start: Math.max(finite(item.start, 0), 0),
      sourceIn: Math.max(item.sourceIn as number, 0),
      sourceOut: Math.max(item.sourceOut as number, 0),
      ...(Number.isFinite(item.gain) ? { gain: item.gain as number } : {}),
      ...(typeof item.linkId === 'string' ? { linkId: item.linkId } : {}),
      ...(item.reversed === true ? { reversed: true } : {}),
    })
  }

  return kept
}

function crop(value: unknown): FrameCrop | null {
  if (typeof value !== 'object' || value === null) return null
  const rect = value as Partial<FrameCrop>

  const numbers = [rect.x, rect.y, rect.width, rect.height]
  if (!numbers.every((entry) => Number.isFinite(entry))) return null

  return {
    x: rect.x as number,
    y: rect.y as number,
    width: rect.width as number,
    height: rect.height as number,
  }
}

function finite(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}
