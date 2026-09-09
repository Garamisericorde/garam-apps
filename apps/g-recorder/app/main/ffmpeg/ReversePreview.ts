import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { previewDir } from '../../shared/paths'
import { buildReversedPreviewArgs } from './commands'
import { FfmpegManager } from './FfmpegManager'
import { logger } from '../logging/logger'
import { probeMedia } from './MediaProbe'

/**
 * A small, already-reversed copy of one clip, for the preview to play forwards.
 *
 * The first attempt at showing a reversed clip seeked backwards through the
 * source a frame at a time, because that is the only thing a video element can
 * be made to do in reverse. It is unusable on the footage this app records: an
 * H.264 keyframe every two seconds means every one of those seeks decodes up to
 * a hundred and twenty frames, and at 1440p60 the machine cannot keep up with
 * even a slideshow.
 *
 * So the reversing is done once, by the thing that is good at it, and the
 * preview plays the result the normal way round. It is a preview, so it is
 * small and cheap: 720p at CRF 26, which is a second or two of encoding for a
 * clip of the length this is allowed on.
 */
const PREVIEW_TIMEOUT_MS = 120_000

/** Reversed previews kept on disk before the oldest are cleared out */
const KEEP_PREVIEWS = 20

export interface ReversedPreview {
  path: string
  durationSeconds: number
}

/**
 * Build (or reuse) the reversed copy of a clip's window.
 *
 * Keyed by the file, its size and modified time, and the window: the same clip
 * reversed twice is one file, and a file that has been rewritten under the same
 * name is a different one.
 */
export async function buildReversedPreview(
  clipPath: string,
  sourceIn: number,
  sourceOut: number,
): Promise<ReversedPreview> {
  const ffmpeg = FfmpegManager.getInstance()
  if (!ffmpeg.isReady) throw new Error('FFmpeg is not installed yet')

  const duration = Math.max(sourceOut - sourceIn, 0)
  if (duration <= 0) throw new Error('That clip has no length to reverse')

  const stats = statSync(clipPath)
  const key = createHash('md5')
    .update([clipPath, stats.size, Math.round(stats.mtimeMs), sourceIn, sourceOut].join('|'))
    .digest('hex')
    .slice(0, 16)

  const dir = previewDir()
  mkdirSync(dir, { recursive: true })
  const outputPath = join(dir, `rev-${key}.mp4`)

  if (existsSync(outputPath)) return { path: outputPath, durationSeconds: duration }

  const info = await probeMedia(clipPath)
  const started = Date.now()

  await run(
    ffmpeg.path,
    buildReversedPreviewArgs({
      clipPath,
      sourceIn,
      sourceOut,
      hasAudio: info.hasAudio,
      outputPath,
    }),
    PREVIEW_TIMEOUT_MS,
  )

  logger.info('Reversed preview built', {
    clipPath,
    sourceIn,
    sourceOut,
    ms: Date.now() - started,
  })

  prune(dir)
  return { path: outputPath, durationSeconds: duration }
}

/** Keep the folder from growing without limit as clips are turned round */
function prune(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.startsWith('rev-'))
      .map((name) => {
        const full = join(dir, name)
        return { full, at: statSync(full).mtimeMs }
      })
      .sort((a, b) => b.at - a.at)

    for (const stale of files.slice(KEEP_PREVIEWS)) rmSync(stale.full, { force: true })
  } catch (err) {
    logger.debug('Could not prune reversed previews', String(err))
  }
}

function run(binary: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(binary, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        rejectPromise(new Error(stderr?.toString().trim() || err.message))
        return
      }
      resolvePromise()
    })
  })
}
