import type { AppSettings, EncoderType } from '../../shared/types'
import { resolutionHeight } from '../../shared/presets'
import { KEYFRAME_INTERVAL_SECONDS } from '../settings/defaults'

// ─────────────────────────────────────────────────────────────────────────────
// Encoder argument helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoEncodeOptions {
  encoder: EncoderType
  /** CRF (x264) / CQ (hardware) value — ignored when targetBitrateKbps is set */
  quality: number
  /** Constant-bitrate target in kbps; when set, quality-based rate control is replaced */
  targetBitrateKbps?: number
  /** Peak bitrate cap in kbps (0 or undefined = uncapped) */
  maxBitrateKbps?: number
  /** GOP size in frames */
  gopSize?: number
}

/**
 * Build the `-c:v …` portion of an FFmpeg command.
 *
 * Rate control follows the project rule: prefer constant quality, and only
 * switch to average bitrate when the caller needs a hard size target.
 * Note the NVENC mode is plain `vbr`: modern FFmpeg only offers constqp, vbr,
 * and cbr, so the old `vbr_hq` alias fails outright.
 */
export function buildVideoEncodeArgs(options: VideoEncodeOptions): string[] {
  const { encoder, quality, targetBitrateKbps, maxBitrateKbps, gopSize } = options
  const args: string[] = []

  const capKbps = targetBitrateKbps ?? (maxBitrateKbps && maxBitrateKbps > 0 ? maxBitrateKbps : 0)
  const rateCapArgs =
    capKbps > 0 ? ['-maxrate', `${capKbps}k`, '-bufsize', `${capKbps * 2}k`] : []

  switch (encoder) {
    case 'nvenc':
      args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq')
      if (targetBitrateKbps) {
        args.push('-rc', 'vbr', '-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-rc', 'vbr', '-cq', String(quality), '-b:v', '0')
      }
      args.push(...rateCapArgs)
      break

    case 'qsv':
      args.push('-c:v', 'h264_qsv', '-preset', 'medium')
      if (targetBitrateKbps) {
        args.push('-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-global_quality', String(quality), '-look_ahead', '0')
      }
      args.push(...rateCapArgs)
      break

    case 'amf':
      args.push('-c:v', 'h264_amf', '-quality', 'balanced')
      if (targetBitrateKbps) {
        args.push('-rc', 'vbr_peak', '-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-rc', 'cqp', '-qp_i', String(quality), '-qp_p', String(quality))
      }
      args.push(...rateCapArgs)
      break

    default:
      args.push('-c:v', 'libx264', '-preset', 'veryfast')
      if (targetBitrateKbps) {
        args.push('-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-crf', String(quality))
      }
      args.push(...rateCapArgs)
      break
  }

  if (gopSize && gopSize > 0) {
    args.push('-g', String(gopSize), '-keyint_min', String(gopSize))
  }

  return args
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureOptions {
  settings: AppSettings
  encoder: EncoderType
  /** Use ddagrab (DXGI) instead of gdigrab */
  useDdagrab: boolean
  /** ddagrab frames can be mapped straight to NVENC (probed, not assumed) */
  useCudaZeroCopy: boolean
  /** DirectShow device for system audio, when enabled and available */
  systemAudioDevice: string | null
  /** DirectShow device for the microphone, when enabled and available */
  micDevice: string | null
}

/**
 * Build the input + filter + encode portion shared by replay-buffer capture
 * and manual recording. Callers append their own output arguments.
 */
export function buildCaptureArgs(options: CaptureOptions): string[] {
  const { settings, encoder, useDdagrab } = options
  const audioDevices = [options.systemAudioDevice, options.micDevice].filter(
    (d): d is string => !!d,
  )

  const args: string[] = ['-hide_banner', '-loglevel', 'warning']

  // ── Video input ──
  if (useDdagrab) {
    const ddagrab = [
      `output_idx=${settings.monitorIndex}`,
      `framerate=${settings.fps}`,
      `draw_mouse=${settings.captureCursor ? 1 : 0}`,
    ].join(':')
    args.push('-f', 'lavfi', '-i', `ddagrab=${ddagrab}`)
  } else {
    args.push(
      '-f', 'gdigrab',
      '-framerate', String(settings.fps),
      '-draw_mouse', settings.captureCursor ? '1' : '0',
      '-i', 'desktop',
    )
  }

  // ── Audio inputs ──
  for (const device of audioDevices) {
    args.push(
      '-f', 'dshow',
      '-audio_buffer_size', '50',
      '-rtbufsize', '64M',
      '-i', `audio=${device}`,
    )
  }

  // ── Filters ──
  const videoFilter = buildCaptureVideoFilter(
    settings,
    encoder,
    useDdagrab,
    options.useCudaZeroCopy,
  )

  if (audioDevices.length > 1) {
    // Two sources need a mix, so the whole graph goes through -filter_complex
    const audioLabels = audioDevices.map((_, i) => `[${i + 1}:a]`).join('')
    const graph =
      `[0:v]${videoFilter}[vout];` +
      `${audioLabels}amix=inputs=${audioDevices.length}:duration=longest:dropout_transition=0,` +
      `aresample=async=1[aout]`
    args.push('-filter_complex', graph, '-map', '[vout]', '-map', '[aout]')
  } else {
    args.push('-vf', videoFilter, '-map', '0:v:0')
    if (audioDevices.length === 1) {
      args.push('-map', '1:a:0', '-af', 'aresample=async=1')
    }
  }

  // ── Encoding ──
  const gopSize = settings.fps * KEYFRAME_INTERVAL_SECONDS
  args.push(...buildVideoEncodeArgs({ encoder, quality: 23, gopSize }))

  if (audioDevices.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
  } else {
    args.push('-an')
  }

  return args
}

/**
 * Video filter chain for capture.
 *
 * ddagrab hands over D3D11 GPU frames. Those can reach NVENC without leaving
 * the GPU, but only when the capture adapter and the NVIDIA device are the same
 * one — so that path is used only after `hasCudaZeroCopy` proved it works.
 * Everything else downloads the frames to system memory first. A naive
 * `ddagrab,scale_cuda` chain fails on both counts.
 */
function buildCaptureVideoFilter(
  settings: AppSettings,
  encoder: EncoderType,
  useDdagrab: boolean,
  useCudaZeroCopy: boolean,
): string {
  const height = resolutionHeight(settings.resolution)
  const filters: string[] = []

  if (useDdagrab && useCudaZeroCopy) {
    // Stay on the GPU: D3D11 -> CUDA -> scale/convert -> NVENC
    filters.push('hwmap=derive_device=cuda')
    filters.push(height ? `scale_cuda=w=-2:h=${height}:format=nv12` : 'scale_cuda=format=nv12')
    return filters.join(',')
  }

  if (useDdagrab) {
    // Bring frames back to system memory for software / non-CUDA encoders
    filters.push('hwdownload', 'format=bgra')
  }

  if (height) filters.push(`scale=-2:${height}:flags=fast_bilinear`)
  // Hardware encoders take nv12 natively; x264 expects planar yuv420p
  filters.push(encoder === 'x264' ? 'format=yuv420p' : 'format=nv12')

  return filters.join(',')
}

/** Output arguments that split capture into a rolling set of MP4 segments */
export function buildSegmentOutputArgs(
  segmentSeconds: number,
  segmentPattern: string,
  segmentListPath: string,
): string[] {
  return [
    '-f', 'segment',
    '-segment_time', String(segmentSeconds),
    '-segment_format', 'mp4',
    '-reset_timestamps', '1',
    // A CSV list of "filename,start,end" removes any need to guess timings
    '-segment_list', segmentListPath,
    '-segment_list_type', 'csv',
    '-segment_list_flags', '+live',
    '-strftime', '1',
    segmentPattern,
  ]
}

/** Output arguments for a single continuous recording file */
export function buildSingleFileOutputArgs(outputPath: string): string[] {
  return ['-movflags', '+faststart', '-y', outputPath]
}

// ─────────────────────────────────────────────────────────────────────────────
// Concat
// ─────────────────────────────────────────────────────────────────────────────

/** Fast lossless segment concat (no re-encode) */
export function buildConcatCopyArgs(concatListPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export interface CropRect {
  width: number
  height: number
  x: number
  y: number
}

export interface ClipExportOptions {
  clipPath: string
  outputPath: string
  inPoint: number
  outPoint: number
  encoder: EncoderType
  /** Final output dimensions, already rounded to even numbers by the caller */
  outWidth: number
  outHeight: number
  /** Centre crop applied before scaling, when an aspect ratio is forced */
  crop: CropRect | null
  /** 0 = keep the source frame rate */
  fps: number
  quality: number
  maxBitrateKbps: number
  audioBitrateKbps: number
  /** Playback speed multiplier */
  speed: number
  /** Audio gain; 0 mutes the track */
  volume: number
  hasAudio: boolean
  /** Set to force an average bitrate instead of constant quality */
  targetBitrateKbps?: number
}

/**
 * Trim + transcode a clip.
 *
 * `-ss` is placed before `-i` so FFmpeg seeks by keyframe first (fast even on
 * long replays) and `-accurate_seek` keeps the cut frame-exact.
 */
export function buildClipExportArgs(options: ClipExportOptions): string[] {
  const sourceDuration = Math.max(options.outPoint - options.inPoint, 0.05)
  const includeAudio = options.hasAudio && options.volume > 0

  // `-t` after `-i` caps the OUTPUT duration, and setpts has already shortened
  // (or stretched) the timeline by `speed`. Passing the source length here would
  // silently export the wrong amount of footage whenever speed is not 1.
  const outputDuration = sourceDuration / (options.speed > 0 ? options.speed : 1)

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-accurate_seek',
    '-ss', options.inPoint.toFixed(3),
    '-i', options.clipPath,
    '-t', outputDuration.toFixed(3),
    '-vf', buildExportVideoFilter(options),
    '-map', '0:v:0',
  ]

  if (includeAudio) {
    args.push('-map', '0:a:0?', '-af', buildExportAudioFilter(options))
    args.push('-c:a', 'aac', '-b:a', `${options.audioBitrateKbps}k`)
  } else {
    args.push('-an')
  }

  args.push(
    ...buildVideoEncodeArgs({
      encoder: options.encoder,
      quality: options.quality,
      maxBitrateKbps: options.maxBitrateKbps,
      targetBitrateKbps: options.targetBitrateKbps,
    }),
  )

  args.push(
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    // Machine-readable progress on stdout; the human-readable bar is suppressed
    '-progress', 'pipe:1',
    '-stats_period', '0.5',
    '-nostats',
    '-y',
    options.outputPath,
  )

  return args
}

function buildExportVideoFilter(options: ClipExportOptions): string {
  const filters: string[] = []

  if (options.crop) {
    const { width, height, x, y } = options.crop
    filters.push(`crop=${width}:${height}:${x}:${y}`)
  }

  filters.push(`scale=${options.outWidth}:${options.outHeight}:flags=lanczos`)

  // setpts must come before fps: retiming first, then resampling, lands the
  // output on the requested frame rate. The other order multiplies it by speed.
  if (options.speed !== 1) filters.push(`setpts=${(1 / options.speed).toFixed(6)}*PTS`)
  if (options.fps > 0) filters.push(`fps=${options.fps}`)

  return filters.join(',')
}

function buildExportAudioFilter(options: ClipExportOptions): string {
  const filters: string[] = []

  // atempo only accepts 0.5–2.0 per instance, so chain it for extreme speeds
  let remaining = options.speed
  while (remaining > 2.0001) {
    filters.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.4999) {
    filters.push('atempo=0.5')
    remaining *= 2
  }
  if (Math.abs(remaining - 1) > 0.0001) {
    filters.push(`atempo=${trimZeros(remaining.toFixed(4))}`)
  }

  if (options.volume !== 1) filters.push(`volume=${options.volume.toFixed(2)}`)

  return filters.length > 0 ? filters.join(',') : 'anull'
}

/** "2.0000" -> "2.0", so the generated filter reads cleanly in the logs */
function trimZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0')
}

// ─────────────────────────────────────────────────────────────────────────────
// GIF export
// ─────────────────────────────────────────────────────────────────────────────

export interface GifExportOptions {
  clipPath: string
  outputPath: string
  inPoint: number
  outPoint: number
  outWidth: number
  outHeight: number
  crop: CropRect | null
  fps: number
  speed: number
}

/**
 * Single-pass GIF export. A generated palette keeps the file small without the
 * banding a default 256-colour conversion produces.
 */
export function buildGifExportArgs(options: GifExportOptions): string[] {
  const sourceDuration = Math.max(options.outPoint - options.inPoint, 0.05)
  const outputDuration = sourceDuration / (options.speed > 0 ? options.speed : 1)
  const pre: string[] = []

  if (options.crop) {
    const { width, height, x, y } = options.crop
    pre.push(`crop=${width}:${height}:${x}:${y}`)
  }
  pre.push(`scale=${options.outWidth}:${options.outHeight}:flags=lanczos`)
  if (options.speed !== 1) pre.push(`setpts=${(1 / options.speed).toFixed(6)}*PTS`)
  pre.push(`fps=${options.fps}`)

  const graph =
    `[0:v]${pre.join(',')},split[a][b];` +
    `[a]palettegen=stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`

  return [
    '-hide_banner',
    '-nostdin',
    '-accurate_seek',
    '-ss', options.inPoint.toFixed(3),
    '-i', options.clipPath,
    '-t', outputDuration.toFixed(3),
    '-filter_complex', graph,
    '-loop', '0',
    '-progress', 'pipe:1',
    '-stats_period', '0.5',
    '-nostats',
    '-y',
    options.outputPath,
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Probing & thumbnails
// ─────────────────────────────────────────────────────────────────────────────

/** ffprobe arguments returning stream + format metadata as JSON on stdout */
export function buildProbeArgs(clipPath: string): string[] {
  return [
    '-hide_banner',
    '-v', 'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,width,height,avg_frame_rate',
    '-of', 'json',
    clipPath,
  ]
}

/**
 * Extract a single frame at `timestamp` as a small JPEG, used to build the
 * editor's timeline strip.
 */
export function buildThumbnailArgs(
  clipPath: string,
  timestamp: number,
  width: number,
  outputPath: string,
): string[] {
  return [
    '-hide_banner',
    '-v', 'error',
    '-noaccurate_seek',
    '-ss', timestamp.toFixed(3),
    '-i', clipPath,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=fast_bilinear`,
    '-q:v', '6',
    '-f', 'image2',
    '-y',
    outputPath,
  ]
}
