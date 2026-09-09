import { describe, expect, it } from 'vitest'
import { EMPTY_EDITOR_STATE, sanitizeEditorState } from '../app/main/settings/EditorState'

describe('the saved arrangement, read back', () => {
  const item = {
    id: 'v-1',
    path: 'C:\\clips\\a.mp4',
    start: 2,
    sourceIn: 1,
    sourceOut: 5,
  }

  it('keeps a whole timeline as it was written', () => {
    const state = sanitizeEditorState({
      timeline: {
        video: [{ ...item, linkId: 'link-1', reversed: true }],
        audio: [{ ...item, id: 'a-1', linkId: 'link-1', gain: 0.5 }],
      },
      crop: { x: 0, y: 0.25, width: 1, height: 0.5 },
      playhead: 3.5,
    })

    expect(state.timeline.video[0].reversed).toBe(true)
    expect(state.timeline.video[0].linkId).toBe('link-1')
    expect(state.timeline.audio[0].gain).toBe(0.5)
    expect(state.crop?.height).toBe(0.5)
    expect(state.playhead).toBe(3.5)
  })

  it('leaves out the flags that were never set, rather than writing them false', () => {
    const state = sanitizeEditorState({ timeline: { video: [item], audio: [] } })
    expect(state.timeline.video[0]).not.toHaveProperty('reversed')
    expect(state.timeline.video[0]).not.toHaveProperty('gain')
  })

  it('drops an item missing what an item has to have', () => {
    // An editor that will not open because one field is a string is worse than
    // an editor that opens with one clip missing.
    const state = sanitizeEditorState({
      timeline: {
        video: [item, { ...item, id: 42 }, { ...item, sourceOut: 'five' }, null, 'nope'],
        audio: [],
      },
    })

    expect(state.timeline.video).toHaveLength(1)
  })

  it('falls back to nothing for a file that is not a timeline at all', () => {
    expect(sanitizeEditorState('not json')).toEqual(EMPTY_EDITOR_STATE)
    expect(sanitizeEditorState(null)).toEqual(EMPTY_EDITOR_STATE)
    expect(sanitizeEditorState({ timeline: 7 })).toEqual(EMPTY_EDITOR_STATE)
  })

  it('refuses a half-written crop instead of cropping to nonsense', () => {
    expect(sanitizeEditorState({ timeline: { video: [], audio: [] }, crop: { x: 0 } }).crop).toBeNull()
  })

  it('never restores a clip to a negative position', () => {
    const state = sanitizeEditorState({
      timeline: { video: [{ ...item, start: -4 }], audio: [] },
      playhead: NaN,
    })

    expect(state.timeline.video[0].start).toBe(0)
    expect(state.playhead).toBe(0)
  })
})
