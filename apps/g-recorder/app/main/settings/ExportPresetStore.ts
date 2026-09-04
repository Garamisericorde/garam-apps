import { readJson, writeJson } from '@garam/core'
import { join } from 'path'
import type { UserExportPreset } from '../../shared/types'
import { userDataDir } from '../../shared/paths'
import { logger } from '../logging/logger'

/**
 * Export settings the user has named and kept.
 *
 * Separate from AppSettings on purpose: settings are one value per key, these
 * are a list that grows, and mixing them would mean validating a collection
 * inside a schema built for scalars. A plain file of its own is enough.
 */
function filePath(): string {
  return join(userDataDir(), 'export-presets.json')
}

export async function listUserPresets(): Promise<UserExportPreset[]> {
  // readJson strips a BOM — Notepad and PowerShell both write one, and
  // JSON.parse throws on it, which would silently look like "no presets".
  const stored = await readJson<UserExportPreset[]>(filePath(), [])
  return Array.isArray(stored) ? stored.filter(isPreset) : []
}

export async function saveUserPreset(preset: UserExportPreset): Promise<UserExportPreset[]> {
  if (!isPreset(preset)) throw new Error('That preset is missing a name or its settings')

  const existing = await listUserPresets()
  // Saving under a name that is already taken replaces it, which is what
  // "save" means once a name is visible in a list.
  const next = [...existing.filter((p) => p.name !== preset.name), preset]

  await writeJson(filePath(), next)
  logger.info('Export preset saved', { name: preset.name, count: next.length })
  return next
}

export async function deleteUserPreset(name: string): Promise<UserExportPreset[]> {
  const next = (await listUserPresets()).filter((preset) => preset.name !== name)
  await writeJson(filePath(), next)
  return next
}

/** Reject anything the editor could not apply — the file is user-editable */
function isPreset(value: unknown): value is UserExportPreset {
  if (typeof value !== 'object' || value === null) return false
  const preset = value as Partial<UserExportPreset>
  return (
    typeof preset.name === 'string' &&
    preset.name.trim() !== '' &&
    typeof preset.presetId === 'string' &&
    typeof preset.format === 'string' &&
    typeof preset.aspect === 'string' &&
    typeof preset.speed === 'number' &&
    typeof preset.volume === 'number'
  )
}
