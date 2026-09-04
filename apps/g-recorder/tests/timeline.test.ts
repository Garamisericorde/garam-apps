import { describe, expect, it } from 'vitest'
import {
  EMPTY_TIMELINE,
  appendClip,
  itemAt,
  itemDuration,
  moveItem,
  removeItem,
  sourcePaths,
  sourceTimeAt,
  splitAt,
  timelineDuration,
  trimItem,
} from '../app/shared/timeline'
import type { Timeline } from '../app/shared/timeline'

const CLIP = { path: 'a.mp4', durationSeconds: 10, hasAudio: true }

/** A timeline holding one ten-second clip, the state opening a file produces */
function single(): Timeline {
  return appendClip(EMPTY_TIMELINE, CLIP)
}

/** Ids are allocated from a running counter, so they are read, never assumed */
function idOf(timeline: Timeline, lane: 'video' | 'audio', index = 0): string {
  const id = timeline[lane][index]?.id
  if (!id) throw new Error(`no ${lane} item at ${index}`)
  return id
}

describe('appendClip', () => {
  it('lays audio out beside video, with no step to separate them', () => {
    const timeline = single()
    expect(timeline.video).toHaveLength(1)
    expect(timeline.audio).toHaveLength(1)
    expect(timeline.audio[0]?.start).toBe(timeline.video[0]?.start)
    expect(timeline.audio[0]?.sourceOut).toBe(timeline.video[0]?.sourceOut)
  })

  it('leaves the audio lane empty for a silent clip', () => {
    const timeline = appendClip(EMPTY_TIMELINE, { ...CLIP, hasAudio: false })
    expect(timeline.video).toHaveLength(1)
    expect(timeline.audio).toHaveLength(0)
  })

  it('appends after what is already there rather than overlapping it', () => {
    const timeline = appendClip(single(), { ...CLIP, path: 'b.mp4', durationSeconds: 4 })
    expect(timeline.video[1]?.start).toBe(10)
    expect(timelineDuration(timeline)).toBe(14)
  })
})

describe('splitAt', () => {
  it('cuts both lanes, so a cut never has to be made twice', () => {
    const timeline = splitAt(single(), 4)
    expect(timeline.video).toHaveLength(2)
    expect(timeline.audio).toHaveLength(2)
    expect(timeline.video[0]?.sourceOut).toBe(4)
    expect(timeline.video[1]?.sourceIn).toBe(4)
    expect(timeline.video[1]?.start).toBe(4)
  })

  it('can cut one lane alone — the point of the lanes being independent', () => {
    const timeline = splitAt(single(), 4, ['audio'])
    expect(timeline.video).toHaveLength(1)
    expect(timeline.audio).toHaveLength(2)
  })

  it('leaves the pieces adding up to the original', () => {
    const before = single()
    const after = splitAt(before, 6.25)
    const total = after.video.reduce((sum, item) => sum + itemDuration(item), 0)
    expect(total).toBeCloseTo(itemDuration(before.video[0]!), 6)
  })

  it('ignores a cut at an edge, which would only make a sliver', () => {
    expect(splitAt(single(), 0).video).toHaveLength(1)
    expect(splitAt(single(), 10).video).toHaveLength(1)
    expect(splitAt(single(), 0.01).video).toHaveLength(1)
  })

  it('does nothing in a gap, where there is no item to cut', () => {
    const base = single()
    const gapped = moveItem(base, 'video', idOf(base, 'video'), 5)
    expect(splitAt(gapped, 2, ['video']).video).toHaveLength(1)
  })
})

describe('trimItem', () => {
  it('holds the frames still when the head is dragged', () => {
    // Both the position and the source window move, so the material under the
    // pointer stays put instead of sliding along with the edge.
    const base = single()
    const timeline = trimItem(base, 'video', idOf(base, 'video'), 'start', 3, 10)
    const item = timeline.video[0]!
    expect(item.start).toBe(3)
    expect(item.sourceIn).toBe(3)
    expect(itemDuration(item)).toBe(7)
  })

  it('cannot pull an edge past the end of the source', () => {
    const base = single()
    const timeline = trimItem(base, 'video', idOf(base, 'video'), 'end', 999, 10)
    expect(itemDuration(timeline.video[0]!)).toBe(10)
  })

  it('cannot pull the head back past the start of the source', () => {
    const base = single()
    const moved = moveItem(base, 'video', idOf(base, 'video'), 5)
    const timeline = trimItem(moved, 'video', idOf(moved, 'video'), 'start', 0, 10)
    expect(timeline.video[0]?.sourceIn).toBe(0)
    expect(timeline.video[0]?.start).toBe(5)
  })

  it('never collapses an item to nothing', () => {
    const base = single()
    const timeline = trimItem(base, 'video', idOf(base, 'video'), 'end', 0, 10)
    expect(itemDuration(timeline.video[0]!)).toBeGreaterThan(0)
  })

  it('trims one lane without touching the other', () => {
    const base = single()
    const timeline = trimItem(base, 'audio', idOf(base, 'audio'), 'end', 4, 10)
    expect(itemDuration(timeline.audio[0]!)).toBe(4)
    expect(itemDuration(timeline.video[0]!)).toBe(10)
  })
})

describe('reading the timeline back', () => {
  it('maps a moment to the source frame showing at it', () => {
    const base = single()
    const timeline = moveItem(base, 'video', idOf(base, 'video'), 5)
    const item = itemAt(timeline, 'video', 7)
    expect(item).not.toBeNull()
    expect(sourceTimeAt(item!, 7)).toBe(2)
  })

  it('reports a gap as nothing playing, not as the nearest item', () => {
    const base = single()
    const timeline = moveItem(base, 'video', idOf(base, 'video'), 5)
    expect(itemAt(timeline, 'video', 2)).toBeNull()
  })

  it('treats an item as ending exactly at its end', () => {
    expect(itemAt(single(), 'video', 10)).toBeNull()
    expect(itemAt(single(), 'video', 9.999)).not.toBeNull()
  })

  it('lists each source once, however many items use it', () => {
    const twice = splitAt(single(), 5)
    expect(sourcePaths(twice)).toEqual(['a.mp4'])
    expect(sourcePaths(appendClip(twice, { ...CLIP, path: 'b.mp4' }))).toEqual(['a.mp4', 'b.mp4'])
  })

  it('measures to the furthest edge of either lane', () => {
    const base = single()
    const timeline = moveItem(base, 'audio', idOf(base, 'audio'), 30)
    expect(timelineDuration(timeline)).toBe(40)
  })
})

describe('removeItem', () => {
  it('drops one item and leaves the other lane alone', () => {
    const base = single()
    const timeline = removeItem(base, 'audio', idOf(base, 'audio'))
    expect(timeline.audio).toHaveLength(0)
    expect(timeline.video).toHaveLength(1)
  })
})
