import { describe, expect, it } from 'vitest'
import { emptyHistory, MAX_UNDO, record, redo, undo } from '../app/renderer/src/state/history'

describe('history', () => {
  it('steps back to what an edit replaced', () => {
    const history = record(emptyHistory<string>(), 'a')
    expect(undo(history, 'b')?.present).toBe('a')
  })

  it('has nothing to undo when nothing has been recorded', () => {
    expect(undo(emptyHistory<string>(), 'a')).toBeNull()
    expect(redo(emptyHistory<string>(), 'a')).toBeNull()
  })

  it('walks back and forward over the same steps', () => {
    let history = record(emptyHistory<string>(), 'a')
    history = record(history, 'b')

    const first = undo(history, 'c')!
    expect(first.present).toBe('b')
    const second = undo(first.history, first.present)!
    expect(second.present).toBe('a')

    const forward = redo(second.history, second.present)!
    expect(forward.present).toBe('b')
    expect(redo(forward.history, forward.present)?.present).toBe('c')
  })

  it('drops the redo branch once a new edit is made', () => {
    // The undone branch is no longer reachable; offering to redo into it would
    // be offering a future that does not follow from the present.
    const stepped = undo(record(emptyHistory<string>(), 'a'), 'b')!
    const edited = record(stepped.history, stepped.present)

    expect(edited.future).toEqual([])
    expect(redo(edited, 'c')).toBeNull()
  })

  it(`keeps ${MAX_UNDO} steps and forgets the oldest`, () => {
    let history = emptyHistory<number>()
    for (let step = 0; step <= MAX_UNDO + 20; step += 1) history = record(history, step)

    expect(history.past).toHaveLength(MAX_UNDO)
    // The distant past is what gets trimmed, not the recent past.
    expect(history.past.at(-1)).toBe(MAX_UNDO + 20)
    expect(history.past[0]).toBe(21)
  })
})
