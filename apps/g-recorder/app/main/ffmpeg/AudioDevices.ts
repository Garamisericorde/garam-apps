import { spawn } from 'child_process'
import type { AudioDevice, AudioDevices } from '../../shared/types'
import { logger } from '../logging/logger'

const LIST_TIMEOUT_MS = 8_000

/**
 * Name fragments that identify a device capable of capturing what the system
 * is playing. Windows has no ffmpeg-native WASAPI loopback input, so system
 * audio comes from Stereo Mix or a virtual cable.
 */
const LOOPBACK_HINTS = [
  'stereo mix',
  'stereomix',
  'what u hear',
  'what you hear',
  'wave out',
  'loopback',
  'cable output',
  'voicemeeter out',
  'virtual-audio-capturer',
]

let _cached: AudioDevices | null = null

/**
 * Enumerate DirectShow audio inputs via `ffmpeg -list_devices true`.
 * FFmpeg prints the list to stderr and then exits non-zero — that is expected.
 */
export async function listAudioDevices(
  ffmpegPath: string,
  force = false,
): Promise<AudioDevices> {
  if (_cached && !force) return _cached

  const stderr = await runListDevices(ffmpegPath)
  const devices = parseAudioDevices(stderr)

  _cached = {
    devices,
    noLoopbackFound: !devices.some((d) => d.isLoopback),
  }
  logger.info('Audio devices detected', {
    count: devices.length,
    loopback: devices.filter((d) => d.isLoopback).map((d) => d.name),
  })
  return _cached
}

/** Best guess at a system-audio device, used when the user has not picked one */
export function pickDefaultLoopback(devices: AudioDevice[]): string | null {
  return devices.find((d) => d.isLoopback)?.name ?? null
}

/** Best guess at a microphone, used when the user has not picked one */
export function pickDefaultMic(devices: AudioDevice[]): string | null {
  return devices.find((d) => !d.isLoopback)?.name ?? null
}

// ── Internals ────────────────────────────────────────────────────────────────

function runListDevices(ffmpegPath: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const proc = spawn(
      ffmpegPath,
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      { windowsHide: true },
    )

    let stderr = ''
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolvePromise(stderr)
    }

    const timer = setTimeout(() => {
      proc.kill()
      finish()
    }, LIST_TIMEOUT_MS)

    proc.stdout.resume()
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', finish)
    proc.on('error', (err) => {
      logger.warn('Could not list DirectShow devices', String(err))
      finish()
    })
  })
}

/**
 * Parse both DirectShow listing formats:
 *   FFmpeg 5+:  [dshow @ …] "Microphone (Realtek)" (audio)
 *   Older:      DirectShow audio devices
 *               [dshow @ …]  "Microphone (Realtek)"
 */
export function parseAudioDevices(stderr: string): AudioDevice[] {
  const names: string[] = []
  let inAudioSection = false

  for (const line of stderr.split('\n')) {
    if (/DirectShow audio devices/i.test(line)) {
      inAudioSection = true
      continue
    }
    if (/DirectShow video devices/i.test(line)) {
      inAudioSection = false
      continue
    }
    // The "Alternative name" lines repeat a device under its PnP id
    if (/Alternative name/i.test(line)) continue

    const match = /"([^"]+)"/.exec(line)
    if (!match) continue

    const taggedAudio = /\(audio\)/i.test(line)
    const taggedVideo = /\(video\)/i.test(line)

    if (taggedVideo) continue
    if (!taggedAudio && !inAudioSection) continue

    names.push(match[1])
  }

  const unique = [...new Set(names)]
  return unique.map((name) => ({ name, isLoopback: looksLikeLoopback(name) }))
}

function looksLikeLoopback(name: string): boolean {
  const lower = name.toLowerCase()
  return LOOPBACK_HINTS.some((hint) => lower.includes(hint))
}
