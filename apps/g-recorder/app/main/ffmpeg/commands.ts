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
  /**
   * Tune for an always-on capture rather than for the best picture.
   *
   * Export runs once and can take its time; the replay buffer runs for hours
   * *next to a game* and every cycle it spends is one the game does not get.
   * The quality-oriented settings are what made games stutter with the buffer
   * on, so capture asks for the low-latency variant of each encoder instead.
   */
  lowLatency?: boolean
  /**
   * Cap on encoder worker threads (software encoding only).
   *
   * Left alone, x264 spawns a thread per core and saturates the CPU. Lowering
   * the process priority is not enough on its own — the threads still evict the
   * game's data from cache.
   */
  threads?: number
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
  const { encoder, quality, targetBitrateKbps, maxBitrateKbps, gopSize, lowLatency } = options
  const args: string[] = []

  const capKbps = targetBitrateKbps ?? (maxBitrateKbps && maxBitrateKbps > 0 ? maxBitrateKbps : 0)
  const rateCapArgs =
    capKbps > 0 ? ['-maxrate', `${capKbps}k`, '-bufsize', `${capKbps * 2}k`] : []

  switch (encoder) {
    case 'nvenc':
      // 'll' drops the lookahead and B-frame reordering that 'hq' turns on —
      // both hold frames on the GPU while the game is trying to use it.
      args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', lowLatency ? 'll' : 'hq')
      if (lowLatency) args.push('-rc-lookahead', '0', '-bf', '0')
      if (targetBitrateKbps) {
        args.push('-rc', 'vbr', '-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-rc', 'vbr', '-cq', String(quality), '-b:v', '0')
      }
      args.push(...rateCapArgs)
      break

    case 'qsv':
      args.push('-c:v', 'h264_qsv', '-preset', lowLatency ? 'veryfast' : 'medium')
      if (targetBitrateKbps) {
        args.push('-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-global_quality', String(quality), '-look_ahead', '0')
      }
      args.push(...rateCapArgs)
      break

    case 'amf':
      args.push('-c:v', 'h264_amf', '-quality', lowLatency ? 'speed' : 'balanced')
      if (targetBitrateKbps) {
        args.push('-rc', 'vbr_peak', '-b:v', `${targetBitrateKbps}k`)
      } else {
        args.push('-rc', 'cqp', '-qp_i', String(quality), '-qp_p', String(quality))
      }
      args.push(...rateCapArgs)
      break

    default:
      // 'veryfast' still costs several cores at 1080p60. 'ultrafast' with
      // zerolatency is the difference between a playable game and a slideshow;
      // the buffer trades picture quality for it, exports do not.
      args.push('-c:v', 'libx264', '-preset', lowLatency ? 'ultrafast' : 'veryfast')
      if (lowLatency) args.push('-tune', 'zerolatency')
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

  // Only software encoding has worker threads worth limiting; the hardware
  // encoders do the work on the GPU and ignore the flag.
  if (encoder === 'x264' && options.threads && options.threads > 0) {
    args.push('-threads', String(options.threads))
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
  /**
   * Hand ddagrab's D3D11 frames to NVENC with no video filter at all.
   *
   * Cheapest path by two orders of magnitude, and mutually exclusive with any
   * filtering — inserting one forces the frames back through system memory,
   * which is the whole cost being avoided.
   */
  useD3d11Direct: boolean
  /** ddagrab frames can be mapped straight to NVENC (probed, not assumed) */
  useCudaZeroCopy: boolean
  /** DirectShow device for system audio, when enabled and available */
  systemAudioDevice: string | null
  /**
   * Take system audio as raw PCM on stdin instead of from a DirectShow device.
   *
   * Windows exposes no loopback device on most machines, so this is the usual
   * case rather than the exception — the renderer captures it through Chromium
   * and feeds it here. Mutually exclusive with systemAudioDevice.
   */
  systemAudioPipe: { sampleRate: number; channels: number; codec: string } | null
  /** DirectShow device for the microphone, when enabled and available */
  micDevice: string | null
  /** Upper bound on x264 worker threads; see VideoEncodeOptions.threads */
  encoderThreads?: number
}

/**
 * Packets FFmpeg may queue per input before it blocks.
 *
 * The default (8) is tiny. When the encoder falls behind for a moment the
 * demuxer thread stalls waiting for room, and a stalled desktop-capture thread
 * shows up as a hitch in whatever is on screen. A deeper queue absorbs the
 * spike instead of pushing it back onto the capture.
 */
const THREAD_QUEUE_SIZE = '512'

/** One audio source, in the order FFmpeg will see it */
type AudioInput =
  | { kind: 'dshow'; device: string }
  | { kind: 'pipe'; format: { sampleRate: number; channels: number; codec: string } }

/**
 * Build the input + filter + encode portion shared by replay-buffer capture
 * and manual recording. Callers append their own output arguments.
 */
export function buildCaptureArgs(options: CaptureOptions): string[] {
  const { settings, encoder, useDdagrab } = options

  // System audio comes either from stdin (Chromium's loopback) or from a
  // DirectShow device, never both; the microphone is always DirectShow. Order
  // matters — it fixes the input indices the maps below refer to.
  const audioInputs: AudioInput[] = []
  if (options.systemAudioPipe) audioInputs.push({ kind: 'pipe', format: options.systemAudioPipe })
  else if (options.systemAudioDevice)
    audioInputs.push({ kind: 'dshow', device: options.systemAudioDevice })
  if (options.micDevice) audioInputs.push({ kind: 'dshow', device: options.micDevice })

  // `-progress` writes a machine-readable block to stdout every half second.
  // It is how the overlay knows the real frame rate: ddagrab pads its output to
  // the requested rate, so the interesting number is not `fps` but how many of
  // those frames were duplicates.
  const args: string[] = ['-hide_banner', '-loglevel', 'warning', '-progress', 'pipe:1']

  // ── Video input ──
  if (useDdagrab) {
    const ddagrab = [
      `output_idx=${settings.monitorIndex}`,
      `framerate=${settings.fps}`,
      `draw_mouse=${settings.captureCursor ? 1 : 0}`,
    ].join(':')
    args.push('-thread_queue_size', THREAD_QUEUE_SIZE, '-f', 'lavfi', '-i', `ddagrab=${ddagrab}`)
  } else {
    args.push(
      '-thread_queue_size', THREAD_QUEUE_SIZE,
      '-f', 'gdigrab',
      '-framerate', String(settings.fps),
      '-draw_mouse', settings.captureCursor ? '1' : '0',
      '-i', 'desktop',
    )
  }

  // ── Audio inputs ──
  for (const input of audioInputs) {
    if (input.kind === 'pipe') {
      args.push(
        '-thread_queue_size', THREAD_QUEUE_SIZE,
        '-f', input.format.codec,
        '-ar', String(input.format.sampleRate),
        '-ac', String(input.format.channels),
        '-i', 'pipe:0',
      )
    } else {
      args.push(
        '-thread_queue_size', THREAD_QUEUE_SIZE,
        '-f', 'dshow',
        '-audio_buffer_size', '50',
        '-rtbufsize', '64M',
        '-i', `audio=${input.device}`,
      )
    }
  }

  // ── Filters ──
  if (options.useD3d11Direct) {
    // Deliberately no video filter: the frames stay on the GPU from capture to
    // encoder. Audio still needs its mix, but that graph must not touch video.
    args.push('-map', '0:v:0')
    if (audioInputs.length > 1) {
      const audioLabels = audioInputs.map((_, i) => `[${i + 1}:a]`).join('')
      args.push(
        '-filter_complex',
        `${audioLabels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0,` +
          `aresample=async=1[aout]`,
        '-map',
        '[aout]',
      )
    } else if (audioInputs.length === 1) {
      args.push('-map', '1:a:0', '-af', 'aresample=async=1')
    }
  } else if (audioInputs.length > 1) {
    // Two sources need a mix, so the whole graph goes through -filter_complex
    const videoFilter = buildCaptureVideoFilter(settings, encoder, useDdagrab, options.useCudaZeroCopy)
    const audioLabels = audioInputs.map((_, i) => `[${i + 1}:a]`).join('')
    const graph =
      `[0:v]${videoFilter}[vout];` +
      `${audioLabels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0,` +
      `aresample=async=1[aout]`
    args.push('-filter_complex', graph, '-map', '[vout]', '-map', '[aout]')
  } else {
    const videoFilter = buildCaptureVideoFilter(settings, encoder, useDdagrab, options.useCudaZeroCopy)
    args.push('-vf', videoFilter, '-map', '0:v:0')
    if (audioInputs.length === 1) {
      args.push('-map', '1:a:0', '-af', 'aresample=async=1')
    }
  }

  // ── Encoding ──
  const gopSize = settings.fps * KEYFRAME_INTERVAL_SECONDS
  args.push(
    ...buildVideoEncodeArgs({
      encoder,
      quality: 23,
      gopSize,
      lowLatency: true,
      threads: options.encoderThreads,
    }),
  )

  if (audioInputs.length > 0) {
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
  /**
   * Pieces to keep, in order, when the clip has been cut into parts.
   *
   * Absent or single-entry means an ordinary trim, which takes the fast path:
   * `-ss` before `-i` seeks by keyframe and never decodes the discarded head.
   * Two or more has to decode the whole span and stitch, so it is only used
   * when something in the middle is actually being dropped.
   */
  ranges?: { start: number; end: number }[]
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
  const kept = (options.ranges ?? []).filter((r) => r.end - r.start > 0.01)
  if (kept.length > 1) return buildStitchedExportArgs(options, kept)

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

/**
 * Export several kept pieces as one continuous clip.
 *
 * Each piece is trimmed on its own branch and the branches are concatenated
 * before the usual crop/scale/speed chain, so the transforms are described once
 * rather than per piece. `setpts=PTS-STARTPTS` on every branch is what makes
 * concat work: without it the second piece keeps its original timestamps and
 * the muxer writes a clip with a hole where the gap used to be.
 */
function buildStitchedExportArgs(
  options: ClipExportOptions,
  kept: { start: number; end: number }[],
): string[] {
  const includeAudio = options.hasAudio && options.volume > 0
  const parts: string[] = []

  kept.forEach((range, index) => {
    const trim = `trim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)}`
    parts.push(`[0:v]${trim},setpts=PTS-STARTPTS[v${index}]`)
    if (includeAudio) {
      const atrim = `atrim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)}`
      parts.push(`[0:a]${atrim},asetpts=PTS-STARTPTS[a${index}]`)
    }
  })

  const videoLabels = kept.map((_, i) => `[v${i}]`).join('')
  const audioLabels = kept.map((_, i) => `[a${i}]`).join('')

  parts.push(`${videoLabels}concat=n=${kept.length}:v=1:a=0[vcat]`)
  parts.push(`[vcat]${buildExportVideoFilter(options)}[vout]`)

  if (includeAudio) {
    parts.push(`${audioLabels}concat=n=${kept.length}:v=0:a=1[acat]`)
    parts.push(`[acat]${buildExportAudioFilter(options)}[aout]`)
  }

  const args: string[] = [
    '-hide_banner',
    '-nostdin',
    '-i', options.clipPath,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
  ]

  if (includeAudio) {
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', `${options.audioBitrateKbps}k`)
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
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
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
