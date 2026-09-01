import { spawn } from 'child_process'
import type { EncoderCapabilities, EncoderPref, EncoderProbe, EncoderType } from '../../shared/types'
import { broadcast } from '../ipc/broadcast'
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
  const nvencUsable = hasDdagrab && probes.nvenc.available
  const hasD3d11DirectNvenc = nvencUsable ? await probeD3d11DirectNvenc(ffmpegPath) : false
  // The direct path already avoids system memory entirely, so the CUDA variant
  // is only worth probing when it does not apply.
  const hasCudaZeroCopy =
    nvencUsable && !hasD3d11DirectNvenc ? await probeCudaZeroCopy(ffmpegPath) : false

  const capabilities: EncoderCapabilities = {
    nvenc: probes.nvenc,
    qsv: probes.qsv,
    amf: probes.amf,
    x264: probes.x264,
    hasDdagrab,
    hasD3d11DirectNvenc,
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
  if (pref !== 'auto' && !caps[pref].available) {
    logger.warn(
      `Encoder "${pref}" is unavailable (${caps[pref].reason ?? 'unknown reason'}), ` +
        `using ${caps.bestEncoder} instead`,
    )
  }

  const encoder = pref === 'auto' || !caps[pref].available ? caps.bestEncoder : pref

  // Landing on software encoding is not a detail — x264 encodes on the CPU and
  // will visibly stutter a game. This has to reach the user on 'auto' too:
  // that is the default, so the people most likely to be silently encoding on
  // the CPU are exactly the ones who never chose an encoder.
  if (encoder === 'x264') warnAboutSoftwareEncoding(caps)

  return encoder
}

/**
 * Explain a CPU-encoding fallback in terms of the thing the user can act on.
 *
 * The most common reason by a distance is an FFmpeg built against a newer
 * NVIDIA Video Codec SDK than the installed driver implements. That reads like
 * a hardware limitation and is not one: the GPU can encode, the binary just
 * refuses to talk to that driver. Naming the FFmpeg build as the culprit
 * matters, because the fix is to replace it — telling people to update a
 * driver they chose deliberately is the wrong advice.
 */
function warnAboutSoftwareEncoding(caps: EncoderCapabilities): void {
  const nvencReason = caps.nvenc.reason ?? ''
  const buildTooNewForDriver = /nvenc api version|driver does not support/i.test(nvencReason)

  const advice = buildTooNewForDriver
    ? 'This copy of FFmpeg needs a newer NVIDIA driver than you have, so it will not use your GPU. ' +
      'Your card is fine — install the compatible FFmpeg build from Settings to turn GPU encoding on.'
    : 'Check the encoder list in Settings for why each one was rejected.'

  const message =
    'No GPU encoder is usable, so recording runs on the CPU and can make games stutter. ' + advice

  logger.warn(message, {
    nvenc: caps.nvenc.reason,
    qsv: caps.qsv.reason,
    amf: caps.amf.reason,
  })
  broadcast('app:notice', { level: 'warning', message })
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
 * Probe the cheapest capture path there is: ddagrab's D3D11 frames handed to
 * NVENC with no filter at all.
 *
 * `h264_nvenc` lists `d3d11` among its input formats, so the frames never leave
 * the GPU and never touch a filter. Measured on a 3060 Ti at 1440p60, five
 * seconds of capture costs 0.08 s of CPU this way, against 2.58 s once the
 * frames round-trip through system memory and 11.05 s for software encoding —
 * the difference between a game stuttering and not noticing the buffer at all.
 *
 * The catch is that a filter cannot be inserted without breaking the chain, so
 * this only applies when no scaling is asked for. Callers check that.
 */
async function probeD3d11DirectNvenc(ffmpegPath: string): Promise<boolean> {
  const result = await runProbe(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'ddagrab=output_idx=0:framerate=30',
    '-frames:v', '1',
    '-c:v', 'h264_nvenc',
    '-f', 'null',
    '-',
  ])

  logger.info(`ddagrab → NVENC direct probe: ${result.ok ? 'available' : 'not available'}`)
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
