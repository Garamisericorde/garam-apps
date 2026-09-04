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
  /**
   * Loudness of this clip alone, 1 being the source untouched.
   *
   * Per item rather than per lane because that is the problem it solves: two
   * recordings made minutes apart are rarely at the same level, and one master
   * control cannot bring one up without taking the other with it.
   */
  gain?: number
  /**
   * Clips that move together, by a shared value.
   *
   * A picture and its own sound are one thing until someone says otherwise, so
   * dragging either moves both. They stay two items: the link decides what a
   * drag does, not what can be cut, trimmed or removed separately.
   */
  linkId?: string
}

export interface Timeline {
  video: TimelineItem[]
  audio: TimelineItem[]
}

/** Shortest item the editor will create or leave behind */
export const MIN_ITEM_SECONDS = 0.05

/**
 * Loudest a clip can be made.
 *
 * Twice the source. Past that the quiet parts a recording actually has are not
 * being recovered any more, only its noise floor.
 */
export const MAX_GAIN = 2

/** A clip's loudness, with the untouched default filled in */
export function itemGain(item: TimelineItem): number {
  return item.gain ?? 1
}

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

/** Every item tied to the one named, including itself */
export function linkedWith(
  timeline: Timeline,
  lane: LaneId,
  id: string,
): { lane: LaneId; item: TimelineItem }[] {
  const item = timeline[lane].find((candidate) => candidate.id === id)
  if (!item) return []
  if (!item.linkId) return [{ lane, item }]

  const found: { lane: LaneId; item: TimelineItem }[] = []
  for (const other of ['video', 'audio'] as LaneId[]) {
    for (const candidate of timeline[other]) {
      if (candidate.linkId === item.linkId) found.push({ lane: other, item: candidate })
    }
  }
  return found
}

/** Tie two clips together so a drag on either moves both */
export function linkItems(
  timeline: Timeline,
  a: { lane: LaneId; id: string },
  b: { lane: LaneId; id: string },
): Timeline {
  const first = timeline[a.lane].find((item) => item.id === a.id)
  const second = timeline[b.lane].find((item) => item.id === b.id)
  if (!first || !second || first.id === second.id) return timeline

  /*
   * Joining two groups keeps everything in both. Linking a clip that already
   * carries a link would otherwise quietly drop whatever it was tied to.
   */
  const merged = first.linkId ?? second.linkId ?? nextId('link')
  const absorbed = new Set([first.linkId, second.linkId, first.id, second.id])

  const relink = (items: TimelineItem[]): TimelineItem[] =>
    items.map((item) =>
      absorbed.has(item.linkId) || absorbed.has(item.id) ? { ...item, linkId: merged } : item,
    )

  return { video: relink(timeline.video), audio: relink(timeline.audio) }
}

/**
 * Cut one clip loose.
 *
 * A partner left alone keeps a link to nothing, which reads as linked and
 * behaves as unlinked, so it is cleared too.
 */
export function unlinkItem(timeline: Timeline, lane: LaneId, id: string): Timeline {
  const group = linkedWith(timeline, lane, id)
  const linkId = group[0]?.item.linkId
  if (!linkId) return timeline

  const remaining = group.filter((entry) => entry.item.id !== id)
  const orphan = remaining.length === 1 ? remaining[0].item.id : null

  const clear = (items: TimelineItem[]): TimelineItem[] =>
    items.map((item) =>
      item.id === id || item.id === orphan ? { ...item, linkId: undefined } : item,
    )

  return { video: clear(timeline.video), audio: clear(timeline.audio) }
}

/**
 * Add a clip to both lanes.
 *
 * Placed at `start`, or after everything when that is not given — a clip
 * landing under the playhead by default would overlap whatever is already
 * there, and an editor that silently covers footage is worse than one that
 * makes you drag.
 *
 * The position belongs here rather than in the caller: a clip with no audio
 * track adds nothing to the audio lane, so a caller moving "the last item on
 * each lane" afterwards would drag an unrelated audio clip along with it.
 */
export function appendClip(
  timeline: Timeline,
  clip: { path: string; durationSeconds: number; hasAudio: boolean },
  start = timelineDuration(timeline),
): Timeline {
  const window = { sourceIn: 0, sourceOut: Math.max(clip.durationSeconds, MIN_ITEM_SECONDS) }

  const at = Math.max(0, start)
  const linkId = clip.hasAudio ? nextId('link') : undefined

  return {
    video: [
      ...timeline.video,
      { id: nextId('v'), path: clip.path, start: at, linkId, ...window },
    ],
    audio: clip.hasAudio
      ? [...timeline.audio, { id: nextId('a'), path: clip.path, start: at, linkId, ...window }]
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

  /*
   * One new link per group, shared by every right-hand half.
   *
   * The lanes are cut in separate passes, so without this the picture's second
   * half and its sound's second half would each invent their own link and the
   * pair would come apart at every cut.
   */
  const rightLinks = new Map<string, string>()

  for (const lane of lanes) {
    next[lane] = next[lane].flatMap((item) => {
      const offset = time - item.start
      // A cut at an edge, or close enough to leave a sliver, changes nothing.
      if (offset < MIN_ITEM_SECONDS || offset > itemDuration(item) - MIN_ITEM_SECONDS) {
        return [item]
      }

      let rightLink = item.linkId
      if (item.linkId) {
        rightLink = rightLinks.get(item.linkId) ?? nextId('link')
        rightLinks.set(item.linkId, rightLink)
      }

      const cut = item.sourceIn + offset
      return [
        { ...item, sourceOut: cut },
        { ...item, id: nextId(lane[0] ?? 'i'), start: time, sourceIn: cut, linkId: rightLink },
      ]
    })
  }

  return next
}

/** Set one clip's loudness, clamped to what the encoder can be asked for */
export function setItemGain(timeline: Timeline, lane: LaneId, id: string, gain: number): Timeline {
  const clamped = Math.min(Math.max(gain, 0), MAX_GAIN)
  return {
    ...timeline,
    [lane]: timeline[lane].map((item) => (item.id === id ? { ...item, gain: clamped } : item)),
  }
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
export function moveItem(timeline: Timeline, lane: LaneId, id: string, start: number): Timeline {
  const moved = timeline[lane].find((item) => item.id === id)
  if (!moved) return timeline

  /*
   * Linked clips move by the same amount, not to the same place: they may have
   * been offset on purpose, and snapping them together on the first drag would
   * throw that away. The clamp is applied to the group, so the one at the front
   * stops the rest at zero rather than everything piling up on it.
   */
  const group = linkedWith(timeline, lane, id)
  const earliest = Math.min(...group.map((entry) => entry.item.start))
  const delta = Math.max(start, 0) - moved.start
  const shift = Math.max(delta, -earliest)

  const ids = new Set(group.map((entry) => entry.item.id))
  const apply = (items: TimelineItem[]): TimelineItem[] =>
    items.map((item) =>
      ids.has(item.id) ? { ...item, start: Math.max(0, item.start + shift) } : item,
    )

  return { video: apply(timeline.video), audio: apply(timeline.audio) }
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
