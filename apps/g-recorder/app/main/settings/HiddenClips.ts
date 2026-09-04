import { readJson, writeJson } from '@garam/core'
import { existsSync } from 'fs'
import { join } from 'path'
import { userDataDir } from '../../shared/paths'
import { logger } from '../logging/logger'

/**
 * Clips the user has taken out of the list.
 *
 * The list is read from the output folder, so hiding a clip cannot be a thing
 * the app merely forgets: the next read would find the file and show it again.
 * The choice has to be written down.
 *
 * It is written down as little as possible. Entries whose file is gone are
 * dropped on every read, so this never becomes a lasting record of videos that
 * once existed on the machine.
 */
function filePath(): string {
  return join(userDataDir(), 'hidden-clips.json')
}

export async function listHidden(): Promise<string[]> {
  const stored = await readJson<string[]>(filePath(), [])
  if (!Array.isArray(stored)) return []

  const alive = stored.filter((path) => typeof path === 'string' && existsSync(path))
  if (alive.length !== stored.length) await writeJson(filePath(), alive)
  return alive
}

export async function hide(clipPath: string): Promise<void> {
  const hidden = await listHidden()
  if (hidden.includes(clipPath)) return

  await writeJson(filePath(), [...hidden, clipPath])
  logger.info('Clip hidden from the list', { clipPath })
}

/** Put everything back, which is the only way out of a hidden clip */
export async function unhideAll(): Promise<void> {
  await writeJson(filePath(), [])
  logger.info('Hidden clips restored')
}
