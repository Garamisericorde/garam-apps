import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { FfmpegManager } from './FfmpegManager'
import { RecorderService } from './RecorderService'
import { SettingsStore } from '../settings/SettingsStore'
import { buildConcatCopyArgs } from './commands'
import { logger } from '../logging/logger'
import { localTimestamp } from '../../shared/time'

export interface SaveReplayOptions {
  /** Seconds of footage to include; defaults to settings.replayLengthMinutes * 60 */
  durationSeconds?: number
}

export interface SaveReplayResult {
  outputPath: string
  durationSeconds: number
}

/** True while a save-replay operation is in progress (prevents concurrent runs) */
let _saving = false

/**
 * Save the replay buffer to a shareable MP4.
 *
 * The segments are stitched with a stream copy, so this stays near-instant even
 * for a 30-minute buffer. Re-encoding happens later, on export, once the user
 * has picked the part they actually want.
 */
export async function runSaveReplay(opts: SaveReplayOptions = {}): Promise<SaveReplayResult> {
  if (_saving) throw new Error('A replay save is already in progress')
  _saving = true

  const recorder = RecorderService.getInstance()
  recorder.acquireSaveHold()

  try {
    const settings = SettingsStore.getInstance().get()
    const ffmpegPath = FfmpegManager.getInstance().path
    const durationSeconds = opts.durationSeconds ?? settings.replayLengthMinutes * 60

    const { concatPath, coveredSeconds } = await recorder.prepareReplayConcat(durationSeconds)

    mkdirSync(settings.outputPath, { recursive: true })
    const outputPath = join(settings.outputPath, `replay_${localTimestamp()}.mp4`)

    logger.info('SaveReplay: concat start', { concatPath, outputPath, coveredSeconds })
    await spawnFfmpeg(ffmpegPath, buildConcatCopyArgs(concatPath, outputPath))
    logger.info('SaveReplay: done', { outputPath })

    return { outputPath, durationSeconds: coveredSeconds }
  } finally {
    recorder.releaseSaveHold()
    _saving = false
  }
}

/** Whether a save is currently in progress (for UI status queries) */
export function isSaving(): boolean {
  return _saving
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Spawn an FFmpeg process and wait for it to complete.
 * Rejects with an error containing the tail of stderr if it fails.
 */
function spawnFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderrTail = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString()
      // Keep only the last 2 kB to avoid unbounded memory growth
      if (stderrTail.length > 2048) stderrTail = stderrTail.slice(-2048)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`FFmpeg exited with code ${code}.\n${stderrTail.trim()}`))
      }
    })

    proc.on('error', (err) => rejectPromise(new Error(`FFmpeg spawn failed: ${err.message}`)))
  })
}
