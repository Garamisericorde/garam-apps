import { join } from 'node:path'
import { app } from 'electron'

/** %APPDATA%/<app> — settings, logs and cache live here. */
export function userDataDir(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments)
}

/** The user's Pictures folder — default target for screenshots. */
export function picturesDir(...segments: string[]): string {
  return join(app.getPath('pictures'), ...segments)
}

/** The user's Videos folder — default target for recordings. */
export function videosDir(...segments: string[]): string {
  return join(app.getPath('videos'), ...segments)
}

/** The user's Documents folder — default target for notes. */
export function documentsDir(...segments: string[]): string {
  return join(app.getPath('documents'), ...segments)
}

/**
 * Points at `resources/` inside the packaged app, or the project's own
 * `resources/` folder during development.
 */
export function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, ...segments)
}

/**
 * Builds a file name from a template.
 *
 * Supported fields: {YYYY} {MM} {DD} {HH} {mm} {ss} {app} {n}
 * Example: "g-snap_{YYYY}-{MM}-{DD}_{HH}{mm}{ss}" -> "g-snap_2026-08-25_174233"
 */
export function formatFileName(
  template: string,
  options: { date?: Date; app?: string; counter?: number } = {},
): string {
  const d = options.date ?? new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')

  const fields: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    app: options.app ?? app.getName(),
    n: String(options.counter ?? 1),
  }

  const named = template.replace(/\{(\w+)\}/g, (match, key: string) => fields[key] ?? match)
  return sanitizeFileName(named)
}

/** Names reserved by Windows — unusable even with an extension appended. */
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** Characters Windows forbids in file names. */
const ILLEGAL_CHARS = /[<>:"/\\|?*]/g

/**
 * Makes a file name safe for Windows.
 * Spaces are preserved; only forbidden and control characters are removed.
 */
export function sanitizeFileName(name: string): string {
  let safe = Array.from(name)
    // Drop control characters (0x00-0x1F and 0x7F) entirely
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .replace(ILLEGAL_CHARS, '-')
    // Windows silently trims trailing dots and spaces; do it explicitly
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 200)

  if (!safe) safe = 'file'
  if (RESERVED_NAMES.test(safe)) safe = `_${safe}`
  return safe
}
