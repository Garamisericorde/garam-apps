/**
 * Undo and redo, as a value.
 *
 * The timeline is one immutable object, so a step of history is just a
 * reference to a previous one — which is why this can hold a long tail cheaply
 * and does not need to know what an edit is.
 */
export interface History<T> {
  past: T[]
  future: T[]
}

/**
 * How far back undo reaches.
 *
 * Deep enough that the limit is never the thing that stops you, and every
 * entry is a handful of small objects, so the tail costs nothing worth
 * measuring.
 */
export const MAX_UNDO = 255

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/**
 * Note the state an edit is about to replace.
 *
 * Redo is dropped here rather than kept: once a new edit is made, the branch
 * that was undone is no longer reachable, and offering to redo into it would
 * be offering a future that no longer follows from the present.
 */
export function record<T>(history: History<T>, present: T): History<T> {
  const past = [...history.past, present]
  // Oldest first, so trimming the front is trimming the distant past.
  if (past.length > MAX_UNDO) past.splice(0, past.length - MAX_UNDO)
  return { past, future: [] }
}

/** Step back, or null when there is nothing to step back to */
export function undo<T>(
  history: History<T>,
  present: T,
): { history: History<T>; present: T } | null {
  const previous = history.past.at(-1)
  if (previous === undefined) return null

  return {
    history: { past: history.past.slice(0, -1), future: [present, ...history.future] },
    present: previous,
  }
}

/** Step forward again, or null when nothing was undone */
export function redo<T>(
  history: History<T>,
  present: T,
): { history: History<T>; present: T } | null {
  const next = history.future[0]
  if (next === undefined) return null

  return {
    history: { past: [...history.past, present], future: history.future.slice(1) },
    present: next,
  }
}
