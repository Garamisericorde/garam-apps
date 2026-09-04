import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { join } from 'path'
import { createWriteStream, mkdirSync, readdirSync, rmSync } from 'fs'
import type { AspectId, EncoderType, ExportOptions, ExportProgress, MediaInfo } from '../../shared/types'
import { getAspectRatio, getPreset, resolutionHeight } from '../../shared/presets'
import { logsDir } from '../../shared/paths'
import { nextNumberedName, sanitizeNamePattern } from '../../shared/exportNaming'
import { GIF_FPS, GIF_MAX_WIDTH } from '../settings/defaults'
import type { CropRect } from './commands'
import { buildClipExportArgs, buildGifExportArgs, buildTimelineExportArgs } from './commands'
import { detectEncoders, resolveEncoder } from './EncoderDetect'
import { FfmpegManager } from './FfmpegManager'
import { probeMedia } from './MediaProbe'
import { SettingsStore } from '../settings/SettingsStore'
import { logger } from '../logging/logger'

/** Leave a little headroom for container overhead when targeting a file size */
const SIZE_TARGET_EFFICIENCY = 0.97

/** Never drop below this video bitrate, however small the size target is */
const MIN_VIDEO_BITRATE_KBPS = 200

export class ExportService {
  private static instance: ExportService

  private _busy = false
  private _cancelled = false
  private _process: ChildProcess | null = null
  private _onProgress: ((progress: ExportProgress) => void) | null = null

  private constructor() {}

  static getInstance(): ExportService {
    if (!ExportService.instance) ExportService.instance = new ExportService()
    return ExportService.instance
  }

  onProgress(handler: (progress: ExportProgress) => void): void {
    this._onProgress = handler
  }

  get isBusy(): boolean {
    return this._busy
  }

  /** Trim, transform, and transcode a clip. Resolves with the output path. */
  async start(options: ExportOptions): Promise<string> {
    if (this._busy) throw new Error('An export is already in progress')

    const preset = getPreset(options.presetId)
    if (!preset) throw new Error(`Unknown export preset: ${options.presetId}`)

    const { timeline } = options
    if (timeline.sources.length === 0) throw new Error('There is nothing on the timeline')

    const sourceDuration = timeline.duration
    if (sourceDuration <= 0) throw new Error('The timeline is empty')

    const settings = SettingsStore.getInstance().get()
    const manager = FfmpegManager.getInstance()
    const status = await manager.ensureReady()
    if (status.state !== 'ready') throw new Error('FFmpeg is not installed')

    /*
     * The first source sets the output's shape. With several clips they may
     * disagree, and something has to decide — picking the first is at least
     * predictable, and every item is scaled onto that canvas anyway.
     */
    const info = await probeMedia(timeline.sources[0])
    const speed = options.speed > 0 ? options.speed : 1
    const outputDuration = sourceDuration / speed

    const extension = options.format === 'gif' ? 'gif' : 'mp4'
    const directory = options.directory || settings.exportPath
    mkdirSync(directory, { recursive: true })

    /*
     * The name is settled here, against the folder as it is now. Suggesting one
     * when the dialog opens and trusting it at export time would overwrite a
     * file if another export finished in between.
     */
    const taken = listNames(directory)
    const chosen = options.fileName.trim()
      ? sanitizeNamePattern(options.fileName)
      : nextNumberedName(settings.exportNamePattern, taken)

    // Never overwrite. A name typed by hand that already exists gets numbered
    // the same way the pattern does, rather than destroying the earlier file.
    const fileName = taken.some((name) => stemOf(name).toLowerCase() === chosen.toLowerCase())
      ? nextNumberedName(chosen, taken)
      : chosen

    const outputPath = join(directory, `${fileName}.${extension}`)

    const args =
      options.format === 'gif'
        ? this.buildGifArgs(options, info, outputPath)
        : await this.buildVideoArgs(options, info, outputPath, outputDuration)

    logger.info('ExportService: starting', {
      format: options.format,
      preset: preset.id,
      sources: timeline.sources.length,
      videoItems: timeline.video.length,
      audioItems: timeline.audio.length,
      outputPath,
      duration: sourceDuration,
      speed,
      aspect: options.aspect,
      targetSizeMb: options.targetSizeMb,
    })

    this._busy = true
    this._cancelled = false
    this._emit({ percent: 0, eta: null, isComplete: false, error: null })

    try {
      await this.runFfmpeg(manager.path, args, outputPath, outputDuration)
      return outputPath
    } finally {
      this._busy = false
      this._process = null
    }
  }

  async cancel(): Promise<void> {
    if (!this._busy) return
    logger.info('ExportService: cancel requested')
    this._cancelled = true
    this._process?.kill()
  }

  // ── Argument assembly ──────────────────────────────────────────────────────

  private async buildVideoArgs(
    options: ExportOptions,
    info: MediaInfo,
    outputPath: string,
    outputDuration: number,
  ): Promise<string[]> {
    const preset = getPreset(options.presetId)!
    const caps = await detectEncoders(FfmpegManager.getInstance().path)
    const settings = SettingsStore.getInstance().get()
    const encoder: EncoderType = resolveEncoder(settings.encoder, caps)

    const framing = computeFraming(info, options.aspect, resolutionHeight(preset.resolution))
    /*
     * The audio lane decides, not the first source's own track. With several
     * clips the first one may be silent while the rest are not, and reading
     * that one file's metadata dropped the sound from the whole export.
     */
    const includeAudio = options.timeline.audio.length > 0 && options.volume > 0

    const targetBitrateKbps = options.targetSizeMb
      ? computeTargetBitrate(
          options.targetSizeMb,
          outputDuration,
          includeAudio ? preset.audioBitrateKbps : 0,
        )
      : undefined

    const timeline = options.timeline

    /*
     * One clip, whole, with its audio in step: the single -ss path, which seeks
     * by keyframe and never decodes the head it is about to discard. It is far
     * cheaper than the filter graph, and it is still the common case — a replay
     * saved and trimmed at both ends.
     */
    const video = timeline.video
    const audioLane = timeline.audio
    const simple =
      video.length === 1 &&
      timeline.sources.length === 1 &&
      Math.abs(video[0].start) < 0.01 &&
      (audioLane.length === 0 ||
        (audioLane.length === 1 &&
          Math.abs(audioLane[0].start - video[0].start) < 0.01 &&
          Math.abs(audioLane[0].sourceIn - video[0].sourceIn) < 0.01 &&
          Math.abs(audioLane[0].sourceOut - video[0].sourceOut) < 0.01))

    const shared = {
      outputPath,
      encoder,
      outWidth: framing.outWidth,
      outHeight: framing.outHeight,
      crop: framing.crop,
      fps: preset.fps > 0 ? Math.min(preset.fps, info.fps || preset.fps) : 0,
      quality: preset.quality,
      maxBitrateKbps: preset.maxBitrateKbps,
      audioBitrateKbps: preset.audioBitrateKbps,
      effort: options.effort,
      speed: options.speed,
      volume: includeAudio ? options.volume : 0,
      hasAudio: includeAudio,
      targetBitrateKbps,
    }

    if (simple) {
      return buildClipExportArgs({
        ...shared,
        clipPath: timeline.sources[0],
        inPoint: video[0].sourceIn,
        outPoint: video[0].sourceOut,
      })
    }

    return buildTimelineExportArgs({
      ...shared,
      clipPath: timeline.sources[0],
      inPoint: 0,
      outPoint: timeline.duration,
      sources: timeline.sources,
      video: timeline.video,
      audio: timeline.audio,
      duration: timeline.duration,
    })
  }

  private buildGifArgs(options: ExportOptions, info: MediaInfo, outputPath: string): string[] {
    const framing = computeFraming(info, options.aspect, null)
    const scale = Math.min(1, GIF_MAX_WIDTH / framing.outWidth)

    // A GIF of a multi-clip timeline is out of scope; the first clip is what
    // the format is ever used for here.
    const first = options.timeline.video[0]
    if (!first) throw new Error('There is no video on the timeline to make a GIF from')

    return buildGifExportArgs({
      clipPath: options.timeline.sources[first.input],
      outputPath,
      inPoint: first.sourceIn,
      outPoint: first.sourceOut,
      outWidth: toEvenSize(framing.outWidth * scale),
      outHeight: toEvenSize(framing.outHeight * scale),
      crop: framing.crop,
      fps: GIF_FPS,
      speed: options.speed,
    })
  }

  // ── Process handling ───────────────────────────────────────────────────────

  private runFfmpeg(
    ffmpegPath: string,
    args: string[],
    outputPath: string,
    totalSeconds: number,
  ): Promise<void> {
    const proc = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], // stdout = progress, stderr = logs
    })
    this._process = proc

    this.attachStderrLog(proc)
    this.parseProgress(proc, totalSeconds)

    return new Promise<void>((resolvePromise, rejectPromise) => {
      proc.on('close', (code) => {
        this._process = null

        if (this._cancelled) {
          this._cancelled = false
          /*
           * A cancelled export leaves a file with no moov atom, which no player
           * and no probe can open. Leaving it behind put a clip in the library
           * that could only ever fail, so it goes with the run that made it.
           */
          try {
            rmSync(outputPath, { force: true })
          } catch (err) {
            logger.warn('Could not remove the cancelled export', String(err))
          }

          this._emit({ percent: 0, eta: null, isComplete: false, error: 'Cancelled' })
          rejectPromise(new Error('Export cancelled'))
          return
        }

        if (code === 0) {
          this._emit({ percent: 100, eta: 0, isComplete: true, error: null, outputPath })
          logger.info('ExportService: export complete', { outputPath })
          resolvePromise()
          return
        }

        const message = `Export failed. FFmpeg exited with code ${code}. See the logs for details.`
        this._emit({ percent: 0, eta: null, isComplete: false, error: message })
        logger.error('ExportService: export failed', { code, outputPath })
        rejectPromise(new Error(message))
      })

      proc.on('error', (err) => {
        this._process = null
        const message = `Could not start FFmpeg: ${err.message}`
        this._emit({ percent: 0, eta: null, isComplete: false, error: message })
        logger.error('ExportService: spawn error', String(err))
        rejectPromise(new Error(message))
      })
    })
  }

  /**
   * Read FFmpeg's `-progress pipe:1` stream. Each stats block is a run of
   * `key=value` lines terminated by `progress=continue` (or `progress=end`).
   */
  private parseProgress(proc: ChildProcess, totalSeconds: number): void {
    let buffer = ''
    let encodedSeconds = 0
    let speed = 1

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // hold the incomplete trailing line

      for (const line of lines) {
        const separator = line.indexOf('=')
        if (separator === -1) continue

        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim()

        if (key === 'out_time_us') {
          encodedSeconds = Number(value) / 1_000_000
        } else if (key === 'out_time_ms') {
          // Despite the name, FFmpeg reports this field in microseconds
          encodedSeconds = Number(value) / 1_000_000
        } else if (key === 'speed') {
          speed = parseFloat(value) || 1 // "2.50x" → 2.5
        } else if (key === 'progress' && value !== 'end') {
          // Cap at 99 so 100 is reserved for a confirmed clean exit
          const percent =
            totalSeconds > 0 ? Math.min((encodedSeconds / totalSeconds) * 100, 99) : 0
          const remaining = Math.max(totalSeconds - encodedSeconds, 0)
          this._emit({
            percent,
            eta: speed > 0 ? remaining / speed : null,
            isComplete: false,
            error: null,
          })
        }
      }
    })
  }

  private attachStderrLog(proc: ChildProcess): void {
    if (!proc.stderr) return
    try {
      mkdirSync(logsDir(), { recursive: true })
      const date = new Date().toISOString().slice(0, 10)
      const stream = createWriteStream(join(logsDir(), `ffmpeg-export-${date}.log`), {
        flags: 'a',
      })
      stream.write(`\n=== Export session ${new Date().toISOString()} ===\n`)
      proc.stderr.pipe(stream)
      proc.stderr.on('close', () => stream.end())
    } catch (err) {
      logger.warn('ExportService: could not open stderr log', String(err))
    }
  }

  private _emit(progress: ExportProgress): void {
    this._onProgress?.(progress)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Framing maths
// ─────────────────────────────────────────────────────────────────────────────

export interface Framing {
  crop: CropRect | null
  outWidth: number
  outHeight: number
}

/**
 * Work out the centre crop and output size for a clip.
 *
 * Cropping (rather than padding) is what makes a 16:9 gameplay clip usable as a
 * 9:16 vertical video. The output is never upscaled — that only wastes bitrate.
 */
export function computeFraming(
  info: MediaInfo,
  aspect: AspectId,
  targetHeight: number | null,
): Framing {
  const sourceWidth = info.width || 1920
  const sourceHeight = info.height || 1080

  const ratio = getAspectRatio(aspect)
  let crop: CropRect | null = null
  let width = sourceWidth
  let height = sourceHeight

  if (ratio !== null) {
    const cropWidth = toEvenSize(Math.min(sourceWidth, sourceHeight * ratio))
    const cropHeight = toEvenSize(Math.min(sourceHeight, sourceWidth / ratio))

    if (cropWidth !== sourceWidth || cropHeight !== sourceHeight) {
      crop = {
        width: cropWidth,
        height: cropHeight,
        x: toEvenOffset((sourceWidth - cropWidth) / 2),
        y: toEvenOffset((sourceHeight - cropHeight) / 2),
      }
    }
    width = cropWidth
    height = cropHeight
  }

  const outHeight = toEvenSize(targetHeight ? Math.min(targetHeight, height) : height)
  const outWidth = toEvenSize((width * outHeight) / height)

  return { crop, outWidth, outHeight }
}

/** Video bitrate that lands an export near a requested file size */
export function computeTargetBitrate(
  targetSizeMb: number,
  durationSeconds: number,
  audioBitrateKbps: number,
): number {
  if (durationSeconds <= 0) return MIN_VIDEO_BITRATE_KBPS

  const totalKbits = targetSizeMb * 8 * 1024
  const availableKbps = (totalKbits / durationSeconds) * SIZE_TARGET_EFFICIENCY - audioBitrateKbps

  return Math.max(Math.floor(availableKbps), MIN_VIDEO_BITRATE_KBPS)
}

/** Round a width or height to an even number ≥ 2 — H.264 requires both */
function toEvenSize(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Round a crop offset to an even number, rounding *down* and allowing zero.
 * Sharing the size helper here would push a zero offset up to 2px, which sends
 * `crop` past the edge of the frame and makes FFmpeg reject the filter.
 */
function toEvenOffset(value: number): number {
  return Math.max(0, Math.floor(value / 2) * 2)
}

/** Names already in a folder, or nothing when it cannot be read */
function listNames(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
