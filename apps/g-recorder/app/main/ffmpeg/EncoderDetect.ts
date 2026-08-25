import { spawn } from 'child_process'
import type { EncoderCapabilities, EncoderPref, EncoderProbe, EncoderType } from '../../shared/types'
import { logger } from '../logging/logger'

const PROBE_TIMEOUT_MS = 20_000

/** FFmpeg encoder name behind each of our encoder ids */
const ENCODER_NAMES: Record<EncoderType, string> = {
  nvenc: 'h264_nvenc',
  qsv: 'h264_qsv',
  amf: 'h264_amf',
  x264: 'libx264',
}

/** Preference order when the user asks for "auto" */
const PREFERENCE_ORDER: EncoderType[] = ['nvenc', 'qsv', 'amf', 'x264']

/** Detection is stable for the life of the process — cache it. */
let _cached: EncoderCapabilities | null = null
let _inFlight: Promise<EncoderCapabilities> | null = null

/**
 * Work out what this machine can actually do.
 *
 * `ffmpeg -encoders` only reports what the binary was compiled with, which is
 * not the same as what will run: a GPU whose driver is older than the build's
 * NVENC SDK is listed but fails at open time. So every candidate is compiled-in
 * *and* smoke-tested with a one-frame encode before we trust it.
 */
export async function detectEncoders(
  ffmpegPath: string,
  force = false,
): Promise<EncoderCapabilities> {
  if (_cached && !force) return _cached
  if (_inFlight && !force) return _inFlight

  _inFlight = runDetection(ffmpegPath)
  try {
    _cached = await _inFlight
    return _cached
  } finally {
    _inFlight = null
  }
}

async function runDetection(ffmpegPath: string): Promise<EncoderCapabilities> {
  const compiledIn = await listEncoders(ffmpegPath)

  const entries = await Promise.all(
    PREFERENCE_ORDER.map(async (type): Promise<[EncoderType, EncoderProbe]> => {
      const name = ENCODER_NAMES[type]
      if (!compiledIn.has(name)) {
        return [type, { available: false, reason: 'Not included in this FFmpeg build' }]
      }
      return [type, await probeEncoder(ffmpegPath, name)]
    }),
  )

  const probes = Object.fromEntries(entries) as Record<EncoderType, EncoderProbe>
  const bestEncoder = PREFERENCE_ORDER.find((type) => probes[type].available) ?? 'x264'

  const hasDdagrab = await probeDdagrab(ffmpegPath)
  const hasCudaZeroCopy =
    hasDdagrab && probes.nvenc.available ? await probeCudaZeroCopy(ffmpegPath) : false

  const capabilities: EncoderCapabilities = {
    nvenc: probes.nvenc,
    qsv: probes.qsv,
    amf: probes.amf,
    x264: probes.x264,
    hasDdagrab,
    hasCudaZeroCopy,
    bestEncoder,
  }

  logger.info('Encoder detection complete', capabilities)
  return capabilities
}

/** Last detection result without re-running the probes */
export function cachedCapabilities(): EncoderCapabilities | null {
  return _cached
}

/**
 * Turn the user's encoder preference into a concrete encoder, falling back
 * whenever the requested one turned out not to work on this machine.
 */
export function resolveEncoder(pref: EncoderPref, caps: EncoderCapabilities): EncoderType {
  if (pref === 'auto') return caps.bestEncoder
  if (caps[pref].available) return pref

  logger.warn(
    `Encoder "${pref}" is unavailable (${caps[pref].reason ?? 'unknown reason'}), ` +
      `using ${caps.bestEncoder} instead`,
  )
  return caps.bestEncoder
}

// ─────────────────────────────────────────────────────────────────────────────
// Probes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn `ffmpeg -encoders` and return the set of video encoder names.
 * Output lines look like:
 *   V....D h264_nvenc          NVIDIA NVENC H.264 encoder (codec h264)
 */
function listEncoders(ffmpegPath: string): Promise<Set<string>> {
  return new Promise((resolvePromise) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true })
    let stdout = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.resume()

    proc.on('close', () => {
      const names = new Set<string>()
      for (const line of stdout.split('\n')) {
        const match = /^\s*V[\w.]{5}\s+(\S+)/.exec(line)
        if (match) names.add(match[1])
      }
      resolvePromise(names)
    })

    proc.on('error', (err) => {
      logger.error('Failed to run ffmpeg -encoders', String(err))
      resolvePromise(new Set())
    })
  })
}

/** Encode a single synthetic frame to prove the encoder really opens */
async function probeEncoder(ffmpegPath: string, encoderName: string): Promise<EncoderProbe> {
  const result = await runProbe(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-frames:v', '1',
    '-c:v', encoderName,
    '-f', 'null',
    '-',
  ])

  if (result.ok) {
    logger.debug(`Encoder probe: ${encoderName} works`)
    return { available: true, reason: null }
  }

  const reason = extractReason(result.stderr)
  logger.info(`Encoder probe: ${encoderName} unavailable — ${reason}`)
  return { available: false, reason }
}

/**
 * Probe whether ddagrab (DXGI Desktop Duplication) works here. The frames stay
 * on the GPU, so the probe downloads one to system memory — the same thing the
 * software capture path does.
 */
async function probeDdagrab(ffmpegPath: string): Promise<boolean> {
  const result = await runProbe(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'ddagrab=output_idx=0:framerate=30',
    '-vf', 'hwdownload,format=bgra',
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ])

  logger.info(`ddagrab probe: ${result.ok ? 'available' : 'not available'}`)
  return result.ok
}

/**
 * Probe the zero-copy path: ddagrab's D3D11 frames mapped straight to CUDA and
 * handed to NVENC without ever touching system memory. It needs the capture
 * device and the NVIDIA device to be the same adapter, which is not true on
 * hybrid-graphics machines, so it must be tested rather than assumed.
 */
async function probeCudaZeroCopy(ffmpegPath: string): Promise<boolean> {
  const result = await runProbe(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'ddagrab=output_idx=0:framerate=30',
    '-vf', 'hwmap=derive_device=cuda,scale_cuda=format=nv12',
    '-frames:v', '1',
    '-c:v', 'h264_nvenc',
    '-f', 'null',
    '-',
  ])

  logger.info(`ddagrab → CUDA zero-copy probe: ${result.ok ? 'available' : 'not available'}`)
  return result.ok
}

interface ProbeResult {
  ok: boolean
  stderr: string
}

function runProbe(ffmpegPath: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolvePromise) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
    })

    let stderr = ''
    let done = false

    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolvePromise({ ok, stderr })
    }

    const timer = setTimeout(() => {
      proc.kill()
      stderr += '\nProbe timed out'
      finish(false)
    }, PROBE_TIMEOUT_MS)

    proc.stdout.resume()
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })

    proc.on('close', (code) => finish(code === 0))
    proc.on('error', (err) => {
      stderr += String(err)
      finish(false)
    })
  })
}

/**
 * Pull the one line worth showing a user out of FFmpeg's error output, e.g.
 * "Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2"
 */
export function extractReason(stderr: string): string {
  const interesting =
    /(does not support|not supported|no capable devices|cannot load|failed to load|minimum required|no device|Cannot open)/i

  const lines = stderr
    .split('\n')
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)

  return lines.find((line) => interesting.test(line)) ?? lines[0] ?? 'Unavailable on this machine'
}
