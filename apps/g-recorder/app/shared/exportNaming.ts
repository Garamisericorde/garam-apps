/**
 * Naming an export.
 *
 * A name pattern is a plain word: "Test" produces Test1, Test2, Test3 as each
 * is taken. Numbered from the start rather than only on collision, so the files
 * sort in the order they were made and nobody has to wonder whether "Test" came
 * before or after "Test1".
 */

/** Characters Windows refuses in a file name */
const ILLEGAL = /[<>:"/\\|?*]/g

/**
 * Whether a character is one a file name cannot carry.
 *
 * Control characters are filtered by code rather than matched by a regex: a
 * class written with a literal 0x00-0x1f range puts invisible bytes in the
 * source, which is exactly what this repo forbids.
 */
function isControl(character: string): boolean {
  const code = character.charCodeAt(0)
  return code < 0x20 || code === 0x7f
}

/** Device names Windows still reserves, with or without an extension */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** What a pattern falls back to when nothing usable is left of it */
export const DEFAULT_NAME_PATTERN = 'clip'

/**
 * Make a pattern safe to build a file name from.
 *
 * Trailing dots and spaces go too: Windows silently strips them, so a file
 * saved as "Test ." comes back as "Test" and the next export believes the name
 * is still free.
 */
export function sanitizeNamePattern(pattern: string): string {
  const cleaned = [...pattern]
    .filter((character) => !isControl(character))
    .join('')
    .replace(ILLEGAL, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (cleaned === '' || RESERVED.test(cleaned)) return DEFAULT_NAME_PATTERN
  return cleaned
}

/**
 * The first free name in the sequence, ignoring extensions.
 *
 * `taken` is whatever is already in the folder; only the stem is compared, so
 * an existing Test2.mp4 also rules out Test2.gif. Two files a viewer would have
 * to tell apart by extension alone is not a naming scheme.
 */
export function nextNumberedName(pattern: string, taken: string[]): string {
  const base = sanitizeNamePattern(pattern)
  const used = new Set(taken.map((name) => stem(name).toLowerCase()))

  let index = 1
  while (used.has(`${base}${index}`.toLowerCase())) index += 1
  return `${base}${index}`
}

function stem(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
