import { describe, expect, it } from 'vitest'
import {
  EMPTY_TIMELINE,
  MAX_GAIN,
  appendClip,
  itemAt,
  itemDuration,
  itemGain,
  linkItems,
  linkedWith,
  moveItem,
  previewAudio,
  removeItem,
  setItemGain,
  sourcePaths,
  sourceTimeAt,
  splitAt,
  timelineDuration,
  trimItem,
  unlinkItem,
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


describe('per-clip loudness', () => {
  const two = appendClip(
    appendClip(EMPTY_TIMELINE, { path: 'a.mp4', durationSeconds: 4, hasAudio: true }),
    { path: 'b.mp4', durationSeconds: 4, hasAudio: true },
  )

  it('reads as untouched until it is set', () => {
    expect(itemGain(two.audio[0])).toBe(1)
  })

  it('changes one clip and leaves the other alone', () => {
    // The whole point: two recordings made minutes apart are rarely at the same
    // level, and a master control cannot lift one without lifting both.
    const next = setItemGain(two, 'audio', two.audio[0].id, 1.6)

    expect(itemGain(next.audio[0])).toBe(1.6)
    expect(itemGain(next.audio[1])).toBe(1)
  })

  it('clamps to silence and to the ceiling', () => {
    const id = two.audio[0].id
    expect(itemGain(setItemGain(two, 'audio', id, -3).audio[0])).toBe(0)
    expect(itemGain(setItemGain(two, 'audio', id, 99).audio[0])).toBe(MAX_GAIN)
  })

  it('survives a split, on both halves', () => {
    const loud = setItemGain(two, 'audio', two.audio[0].id, 1.5)
    const cut = splitAt(loud, 2, ['audio'])

    expect(itemGain(cut.audio[0])).toBe(1.5)
    expect(itemGain(cut.audio[1])).toBe(1.5)
  })
})

describe('linked clips', () => {
  const clip = appendClip(EMPTY_TIMELINE, {
    path: 'a.mp4',
    durationSeconds: 10,
    hasAudio: true,
  })

  it('arrives with its own sound linked', () => {
    expect(clip.video[0].linkId).toBeDefined()
    expect(clip.audio[0].linkId).toBe(clip.video[0].linkId)
    expect(linkedWith(clip, 'video', clip.video[0].id)).toHaveLength(2)
  })

  it('links nothing when the clip is silent', () => {
    const silent = appendClip(EMPTY_TIMELINE, {
      path: 'a.mp4',
      durationSeconds: 10,
      hasAudio: false,
    })
    expect(silent.video[0].linkId).toBeUndefined()
  })

  it('moves the pair by the same amount, keeping any gap between them', () => {
    // Offsetting the sound is deliberate work; moving the pair must not undo it.
    const offset = unlinkItem(clip, 'audio', clip.audio[0].id)
    const shifted = moveItem(offset, 'audio', offset.audio[0].id, 3)
    const relinked = linkItems(
      shifted,
      { lane: 'video', id: shifted.video[0].id },
      { lane: 'audio', id: shifted.audio[0].id },
    )

    const moved = moveItem(relinked, 'video', relinked.video[0].id, 5)

    expect(moved.video[0].start).toBe(5)
    expect(moved.audio[0].start).toBe(8)
  })

  it('stops the whole group at zero rather than piling it up', () => {
    const moved = moveItem(clip, 'video', clip.video[0].id, -4)
    expect(moved.video[0].start).toBe(0)
    expect(moved.audio[0].start).toBe(0)
  })

  it('keeps both halves of a cut paired, on each side', () => {
    const cut = splitAt(clip, 4)

    expect(cut.video[0].linkId).toBe(cut.audio[0].linkId)
    expect(cut.video[1].linkId).toBe(cut.audio[1].linkId)
    // The halves are two pairs, not one group of four.
    expect(cut.video[0].linkId).not.toBe(cut.video[1].linkId)
  })

  it('lets one be cut loose, and does not leave the other linked to nothing', () => {
    const loose = unlinkItem(clip, 'audio', clip.audio[0].id)

    expect(loose.audio[0].linkId).toBeUndefined()
    expect(loose.video[0].linkId).toBeUndefined()
  })

  it('moves alone once unlinked', () => {
    const loose = unlinkItem(clip, 'audio', clip.audio[0].id)
    const moved = moveItem(loose, 'video', loose.video[0].id, 6)

    expect(moved.video[0].start).toBe(6)
    expect(moved.audio[0].start).toBe(0)
  })

  it('joins two groups rather than dropping one', () => {
    const second = appendClip(clip, { path: 'b.mp4', durationSeconds: 5, hasAudio: true })
    const joined = linkItems(
      second,
      { lane: 'video', id: second.video[0].id },
      { lane: 'video', id: second.video[1].id },
    )

    // Both pairs end up in one group: four items, not two.
    expect(linkedWith(joined, 'video', second.video[0].id)).toHaveLength(4)
  })
})

describe('what the preview is allowed to be heard doing', () => {
  it('plays the clip at full volume while its audio is under it', () => {
    const timeline = single()
    expect(previewAudio(timeline, timeline.video[0], 2)).toEqual({ muted: false, volume: 1 })
  })

  it('goes silent once the audio under the clip is removed', () => {
    // The complaint this covers: removing the audio clip and still hearing it.
    const timeline = single()
    const silent = removeItem(timeline, 'audio', timeline.audio[0].id)

    expect(previewAudio(silent, silent.video[0], 2).muted).toBe(true)
  })

  it('follows the clip gain, as far as an element can be turned up', () => {
    const timeline = single()
    const quiet = setItemGain(timeline, 'audio', timeline.audio[0].id, 0.4)
    expect(previewAudio(quiet, quiet.video[0], 2).volume).toBeCloseTo(0.4)

    const loud = setItemGain(timeline, 'audio', timeline.audio[0].id, MAX_GAIN)
    expect(previewAudio(loud, loud.video[0], 2).volume).toBe(1)
  })

  it('goes silent where the audio has been dragged out of sync', () => {
    // One element cannot play a picture and a sound from different moments, so
    // the honest preview of an offset track is no track.
    const timeline = single()
    const loose = unlinkItem(timeline, 'audio', timeline.audio[0].id)
    const moved = moveItem(loose, 'audio', loose.audio[0].id, 3)

    expect(previewAudio(moved, moved.video[0], 5).muted).toBe(true)
  })

  it('goes silent in a gap on the audio lane', () => {
    const timeline = appendClip(single(), { path: 'b.mp4', durationSeconds: 5, hasAudio: true })
    const gap = removeItem(timeline, 'audio', timeline.audio[0].id)

    expect(previewAudio(gap, gap.video[0], 2).muted).toBe(true)
    // The second clip still has its own audio, and is unaffected.
    expect(previewAudio(gap, gap.video[1], 11).muted).toBe(false)
  })

  it('will not play one clip under the picture of another', () => {
    const timeline = appendClip(single(), { path: 'b.mp4', durationSeconds: 5, hasAudio: true })
    // The second clip's audio, moved to where the first clip's picture is.
    const loose = unlinkItem(timeline, 'audio', timeline.audio[1].id)
    const overlapping = removeItem(loose, 'audio', loose.audio[0].id)
    const moved = moveItem(overlapping, 'audio', overlapping.audio[0].id, 0)

    expect(previewAudio(moved, moved.video[0], 2).muted).toBe(true)
  })
})
