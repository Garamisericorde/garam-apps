/** Format seconds as MM:SS.mmm */
export function formatTime(seconds: number): string {
  const safe = Math.max(seconds, 0)
  const ms = Math.floor((safe % 1) * 1000)
  const s = Math.floor(safe) % 60
  const m = Math.floor(safe / 60)
  return `${pad(m)}:${pad(s)}.${String(ms).padStart(3, '0')}`
}

/** Format seconds as a compact HH:MM:SS string (no ms) */
export function formatDuration(seconds: number): string {
  const safe = Math.max(seconds, 0)
  const s = Math.floor(safe) % 60
  const m = Math.floor(safe / 60) % 60
  const h = Math.floor(safe / 3600)
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Human-readable file size, e.g. "8.4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

/**
 * A timestamp for a file name, in local time.
 *
 * The date and the time are separated differently on purpose. Written with
 * dashes throughout, "2026-09-06_00-59-55" reads as one long number and the
 * eye cannot find where the date ends; dots for the clock make it a date and a
 * time at a glance. Windows forbids the colon a clock would otherwise use.
 *
 * Local rather than UTC: this names a moment the user was present for, and
 * "the clip I took at midnight" has to be findable by that.
 */
export function localTimestamp(date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  )
}

/** Clamp a number into an inclusive range */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
