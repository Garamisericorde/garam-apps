// ---------------------------------------------------------------------------
// The editor's timeline model.
//
// Two lanes, video and audio, each an ordered list of items. An item is a
// window onto a source file (`sourceIn`..`sourceOut`) placed at a position on
// the output timeline (`start`). Nothing here touches the DOM or FFmpeg: the
// preview reads it to decide what to play, and the exporter reads it to build a
// filter graph, so it has to mean exactly one thing to both.
//
// Adding a clip creates a video item and an audio item at the same position.
// They are separate from that moment on — no "detach audio" step, because a
// step you always take is not a choice, it is a chore.
// ---------------------------------------------------------------------------

export type LaneId = 'video' | 'audio'

export interface TimelineItem {
  id: string
  /** Source file this item shows */
  path: string
  /** Position on the output timeline, in seconds */
  start: number
  /** Window into the source, in seconds */
  sourceIn: number
  sourceOut: number
}

export interface Timeline {
  video: TimelineItem[]
  audio: TimelineItem[]
}

/** Shortest item the editor will create or leave behind */
export const MIN_ITEM_SECONDS = 0.05

export const EMPTY_TIMELINE: Timeline = { video: [], audio: [] }

/** Length of an item on the output timeline */
export function itemDuration(item: TimelineItem): number {
  return Math.max(item.sourceOut - item.sourceIn, 0)
}

export function itemEnd(item: TimelineItem): number {
  return item.start + itemDuration(item)
}

/** Where the timeline ends — the furthest edge on either lane */
export function timelineDuration(timeline: Timeline): number {
  const ends = [...timeline.video, ...timeline.audio].map(itemEnd)
  return ends.length > 0 ? Math.max(...ends) : 0
}

/** The item covering a moment on a lane, or null in a gap */
export function itemAt(timeline: Timeline, lane: LaneId, time: number): TimelineItem | null {
  return (
    timeline[lane].find((item) => time >= item.start && time < itemEnd(item)) ?? null
  )
}

/** Source position an item is showing at a moment on the output timeline */
export function sourceTimeAt(item: TimelineItem, time: number): number {
  return item.sourceIn + (time - item.start)
}

/** Items in play order, which is how both the preview and the exporter read a lane */
export function sortLane(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => a.start - b.start)
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

/**
 * Append a clip to the end of both lanes.
 *
 * Appended rather than dropped at the playhead: a clip landing under the
 * playhead would overlap whatever is already there, and an editor that silently
 * covers footage is worse than one that makes you drag.
 */
export function appendClip(
  timeline: Timeline,
  clip: { path: string; durationSeconds: number; hasAudio: boolean },
): Timeline {
  const start = timelineDuration(timeline)
  const window = { sourceIn: 0, sourceOut: Math.max(clip.durationSeconds, MIN_ITEM_SECONDS) }

  return {
    video: [...timeline.video, { id: nextId('v'), path: clip.path, start, ...window }],
    audio: clip.hasAudio
      ? [...timeline.audio, { id: nextId('a'), path: clip.path, start, ...window }]
      : timeline.audio,
  }
}

/**
 * Cut every item crossing a moment, on the lanes given.
 *
 * Both lanes by default, because a cut that leaves the audio whole is a cut
 * that has to be made twice. Cutting one lane is still possible, which is the
 * point of the lanes being independent.
 */
export function splitAt(
  timeline: Timeline,
  time: number,
  lanes: LaneId[] = ['video', 'audio'],
): Timeline {
  const next: Timeline = { video: [...timeline.video], audio: [...timeline.audio] }

  for (const lane of lanes) {
    next[lane] = next[lane].flatMap((item) => {
      const offset = time - item.start
      // A cut at an edge, or close enough to leave a sliver, changes nothing.
      if (offset < MIN_ITEM_SECONDS || offset > itemDuration(item) - MIN_ITEM_SECONDS) {
        return [item]
      }

      const cut = item.sourceIn + offset
      return [
        { ...item, sourceOut: cut },
        { ...item, id: nextId(lane[0] ?? 'i'), start: time, sourceIn: cut },
      ]
    })
  }

  return next
}

export function removeItem(timeline: Timeline, lane: LaneId, id: string): Timeline {
  return { ...timeline, [lane]: timeline[lane].filter((item) => item.id !== id) }
}

/**
 * Move an item along its lane.
 *
 * Clamped at zero: the output timeline starts there, and an item dragged past
 * the left edge would export as though its head had been trimmed.
 */
export function moveItem(
  timeline: Timeline,
  lane: LaneId,
  id: string,
  start: number,
): Timeline {
  return {
    ...timeline,
    [lane]: timeline[lane].map((item) =>
      item.id === id ? { ...item, start: Math.max(0, start) } : item,
    ),
  }
}

/**
 * Drag an item's edge.
 *
 * Trimming the head moves the item and its source window together, so the
 * frames under the pointer stay put instead of sliding — the behaviour every
 * editor has, and the reason a head trim is not just a smaller duration.
 * Neither edge may pass the source's own bounds, since there is nothing there.
 */
export function trimItem(
  timeline: Timeline,
  lane: LaneId,
  id: string,
  edge: 'start' | 'end',
  time: number,
  sourceDuration: number,
): Timeline {
  return {
    ...timeline,
    [lane]: timeline[lane].map((item) => {
      if (item.id !== id) return item

      if (edge === 'end') {
        const maxEnd = item.start + (sourceDuration - item.sourceIn)
        const end = Math.min(Math.max(time, item.start + MIN_ITEM_SECONDS), maxEnd)
        return { ...item, sourceOut: item.sourceIn + (end - item.start) }
      }

      const minStart = Math.max(0, item.start - item.sourceIn)
      const start = Math.max(Math.min(time, itemEnd(item) - MIN_ITEM_SECONDS), minStart)
      return { ...item, start, sourceIn: item.sourceIn + (start - item.start) }
    }),
  }
}

/** Every distinct source file the timeline references, in a stable order */
export function sourcePaths(timeline: Timeline): string[] {
  const seen: string[] = []
  for (const item of [...timeline.video, ...timeline.audio]) {
    if (!seen.includes(item.path)) seen.push(item.path)
  }
  return seen
}
