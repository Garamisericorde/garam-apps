/**
 * The range a replay length may take, in seconds.
 *
 * Ten seconds is the shortest that can hold anything worth keeping once the
 * hotkey's own reaction time is in it. Ten minutes is where the cache stops
 * being a cache: at 1440p60 that is already several gigabytes rewritten
 * continuously.
 */
export const MIN_REPLAY_SECONDS = 10
export const MAX_REPLAY_SECONDS = 600

/** The lengths offered directly, before anyone types their own */
export const REPLAY_PRESET_SECONDS = [30, 60, 120, 180, 300, 600] as const
