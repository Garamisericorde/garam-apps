import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Writes a file atomically: write to a temp file, fsync it, then rename it
 * into place. If the app crashes mid-write the existing file stays intact.
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  // Temp file in the same directory — rename is only atomic within a volume.
  const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(tmp, 'w')
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle?.close()
  }

  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** Byte order mark (U+FEFF) — built from its code point because it is invisible in source. */
const BOM = String.fromCharCode(0xfeff)

/** Strips a leading BOM if present. */
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

/**
 * Reads JSON; returns `fallback` when the file is missing or malformed.
 *
 * A leading BOM is stripped: Windows tools (PowerShell's `-Encoding utf8`,
 * Notepad) write UTF-8 with a BOM and JSON.parse throws on that character.
 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(stripBom(raw)) as T
  } catch {
    return fallback
  }
}

/** Writes JSON atomically, pretty-printed. */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(value, null, 2))
}

/** Reports whether a path exists. */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
