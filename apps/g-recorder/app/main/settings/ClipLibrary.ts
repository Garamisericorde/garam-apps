import { readJson, writeJson } from '@garam/core'
import { existsSync } from 'fs'
import { join } from 'path'
import { userDataDir } from '../../shared/paths'
import { logger } from '../logging/logger'

/**
 * The clips the user has put in the editor's list.
 *
 * A list they build, not a folder the app reads. Listing the output folder
 * meant every replay saved mid-game appeared in the editor unasked, and the
 * list became a record of everything ever recorded rather than of what is
 * being worked on.
 *
 * Written down so it survives a restart, and pruned of files that no longer
 * exist on every read, so it never becomes a lasting record of videos that
 * once existed on this machine.
 */
function filePath(): string {
  return join(userDataDir(), 'library.json')
}

/** Most recently added first */
export async function listLibrary(): Promise<string[]> {
  const stored = await readJson<string[]>(filePath(), [])
  if (!Array.isArray(stored)) return []

  const alive = stored.filter((path) => typeof path === 'string' && existsSync(path))
  if (alive.length !== stored.length) await writeJson(filePath(), alive)
  return alive
}

export async function addToLibrary(clipPath: string): Promise<void> {
  const existing = await listLibrary()
  // Re-opening a clip moves it to the top rather than adding it twice.
  const next = [clipPath, ...existing.filter((path) => path !== clipPath)]

  await writeJson(filePath(), next)
  logger.info('Clip added to the library', { clipPath, count: next.length })
}

export async function removeFromLibrary(clipPath: string): Promise<void> {
  const next = (await listLibrary()).filter((path) => path !== clipPath)
  await writeJson(filePath(), next)
}
