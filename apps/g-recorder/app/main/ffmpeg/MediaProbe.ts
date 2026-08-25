import { execFile } from 'child_process'
import { join } from 'path'
import { mkdirSync, readFileSync, rmSync, statSync } from 'fs'
import type { MediaInfo, ThumbnailStrip } from '../../shared/types'
import { thumbsDir } from '../../shared/paths'
import { TIMELINE_THUMBNAIL_COUNT, TIMELINE_THUMBNAIL_WIDTH } from '../settings/defaults'
import { buildProbeArgs, buildThumbnailArgs } from './commands'
import { FfmpegManager } from './FfmpegManager'
import { logger } from '../logging/logger'

const PROBE_TIMEOUT_MS = 15_000
const THUMBNAIL_TIMEOUT_MS = 15_000

interface ProbeStream {
  codec_type?: string
  width?: number
  height?: number
  avg_frame_rate?: string
}

interface ProbeOutput {
  streams?: ProbeStream[]
  format?: { duration?: string; size?: string }
}

/** Read duration, dimensions, frame rate, and audio presence from a media file. */
export async function probeMedia(clipPath: string): Promise<MediaInfo> {
  const ffmpeg = FfmpegManager.getInstance()
  if (!ffmpeg.isReady) {
    throw new Error(
      'FFmpeg is not installed yet, so this file cannot be read. Install it from the banner above.',
    )
  }

  const stdout = await run(ffmpeg.probePath, buildProbeArgs(clipPath), PROBE_TIMEOUT_MS)

  let parsed: ProbeOutput
  try {
    parsed = JSON.parse(stdout) as ProbeOutput
  } catch {
    throw new Error(`Could not read media info for ${clipPath}`)
  }

  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('File contains no video stream')

  const sizeBytes = Number(parsed.format?.size) || safeFileSize(clipPath)

  return {
    path: clipPath,
    durationSeconds: Number(parsed.format?.duration) || 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: parseFrameRate(video.avg_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    sizeBytes,
  }
}

/**
 * Render evenly spaced frames across a clip and return them as data URIs for
 * the timeline strip. Frames are produced in parallel — each is an independent
 * keyframe seek, so this stays fast even on long replays.
 */
export async function buildThumbnailStrip(
  clipPath: string,
  durationSeconds: number,
  count = TIMELINE_THUMBNAIL_COUNT,
): Promise<ThumbnailStrip> {
  if (durationSeconds <= 0) return { frames: [] }

  const ffmpeg = FfmpegManager.getInstance()
  const dir = join(thumbsDir(), `strip-${Date.now()}`)
  mkdirSync(dir, { recursive: true })

  try {
    const jobs = Array.from({ length: count }, (_, index) => {
      // Sample at the midpoint of each slice so the strip reads evenly
      const timestamp = ((index + 0.5) / count) * durationSeconds
      const outputPath = join(dir, `thumb-${index}.jpg`)

      return run(
        ffmpeg.path,
        buildThumbnailArgs(clipPath, timestamp, TIMELINE_THUMBNAIL_WIDTH, outputPath),
        THUMBNAIL_TIMEOUT_MS,
      )
        .then(() => toDataUri(outputPath))
        .catch((err) => {
          logger.debug('Thumbnail failed', { index, error: String(err) })
          return null
        })
    })

    const frames = (await Promise.all(jobs)).filter((f): f is string => f !== null)
    return { frames }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Remove any thumbnail directories left behind by an earlier crash */
export function cleanThumbnailCache(): void {
  rmSync(thumbsDir(), { recursive: true, force: true })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(binary: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      binary,
      args,
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          rejectPromise(new Error(stderr?.toString().trim() || err.message))
          return
        }
        resolvePromise(stdout.toString())
      },
    )
  })
}

function toDataUri(jpegPath: string): string {
  return `data:image/jpeg;base64,${readFileSync(jpegPath).toString('base64')}`
}

/** "60/1" or "30000/1001" → a number */
function parseFrameRate(value: string | undefined): number {
  if (!value) return 0
  const [numerator, denominator] = value.split('/').map(Number)
  if (!denominator) return numerator || 0
  return Math.round((numerator / denominator) * 100) / 100
}

function safeFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
