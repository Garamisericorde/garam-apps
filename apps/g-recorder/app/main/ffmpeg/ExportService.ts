import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { createWriteStream, mkdirSync } from 'fs'
import type { AspectId, EncoderType, ExportOptions, ExportProgress, MediaInfo } from '../../shared/types'
import { getAspectRatio, getPreset, resolutionHeight } from '../../shared/presets'
import { logsDir } from '../../shared/paths'
import { localTimestamp } from '../../shared/time'
import { GIF_FPS, GIF_MAX_WIDTH } from '../settings/defaults'
import type { CropRect } from './commands'
import { buildClipExportArgs, buildGifExportArgs } from './commands'
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
    if (!options.clipPath) throw new Error('No clip selected to export')

    const sourceDuration = options.outPoint - options.inPoint
    if (sourceDuration <= 0) throw new Error('The OUT point must come after the IN point')

    const settings = SettingsStore.getInstance().get()
    const manager = FfmpegManager.getInstance()
    const status = await manager.ensureReady()
    if (status.state !== 'ready') throw new Error('FFmpeg is not installed')

    const info = await probeMedia(options.clipPath)
    const speed = options.speed > 0 ? options.speed : 1
    const outputDuration = sourceDuration / speed

    const outputPath =
      options.outputPath ||
      join(
        settings.outputPath,
        `clip_${preset.id}_${localTimestamp()}.${options.format === 'gif' ? 'gif' : 'mp4'}`,
      )
    mkdirSync(dirname(outputPath), { recursive: true })

    const args =
      options.format === 'gif'
        ? this.buildGifArgs(options, info, outputPath)
        : await this.buildVideoArgs(options, info, outputPath, outputDuration)

    logger.info('ExportService: starting', {
      format: options.format,
      preset: preset.id,
      clipPath: options.clipPath,
      outputPath,
      inPoint: options.inPoint,
      outPoint: options.outPoint,
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
    const includeAudio = info.hasAudio && options.volume > 0

    const targetBitrateKbps = options.targetSizeMb
      ? computeTargetBitrate(
          options.targetSizeMb,
          outputDuration,
          includeAudio ? preset.audioBitrateKbps : 0,
        )
      : undefined

    return buildClipExportArgs({
      clipPath: options.clipPath,
      outputPath,
      inPoint: options.inPoint,
      outPoint: options.outPoint,
      encoder,
      outWidth: framing.outWidth,
      outHeight: framing.outHeight,
      crop: framing.crop,
      fps: preset.fps > 0 ? Math.min(preset.fps, info.fps || preset.fps) : 0,
      quality: preset.quality,
      maxBitrateKbps: preset.maxBitrateKbps,
      audioBitrateKbps: preset.audioBitrateKbps,
      speed: options.speed,
      volume: options.volume,
      hasAudio: info.hasAudio,
      targetBitrateKbps,
    })
  }

  private buildGifArgs(options: ExportOptions, info: MediaInfo, outputPath: string): string[] {
    const framing = computeFraming(info, options.aspect, null)
    const scale = Math.min(1, GIF_MAX_WIDTH / framing.outWidth)

    return buildGifExportArgs({
      clipPath: options.clipPath,
      outputPath,
      inPoint: options.inPoint,
      outPoint: options.outPoint,
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

        const message = `Export failed — FFmpeg exited with code ${code}. See the logs for details.`
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
