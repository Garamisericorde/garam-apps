import { describe, expect, it } from 'vitest'
import { computeFraming, computeTargetBitrate } from '../app/main/ffmpeg/ExportService'
import { parseSegmentList } from '../app/main/ffmpeg/RecorderService'
import { parseAudioDevices } from '../app/main/ffmpeg/AudioDevices'
import { extractReason } from '../app/main/ffmpeg/EncoderDetect'
import type { MediaInfo } from '../app/shared/types'

function media(width: number, height: number): MediaInfo {
  return {
    path: 'clip.mp4',
    durationSeconds: 10,
    width,
    height,
    fps: 60,
    hasAudio: true,
    sizeBytes: 1024,
  }
}

describe('computeFraming', () => {
  it('leaves the source untouched when no aspect is forced', () => {
    const framing = computeFraming(media(1920, 1080), 'source', null)
    expect(framing.crop).toBeNull()
    expect(framing).toMatchObject({ outWidth: 1920, outHeight: 1080 })
  })

  it('scales down to the preset height and keeps the aspect ratio', () => {
    const framing = computeFraming(media(2560, 1440), 'source', 720)
    expect(framing).toMatchObject({ outWidth: 1280, outHeight: 720 })
  })

  it('never upscales a clip that is already smaller than the preset', () => {
    // Upscaling only wastes bitrate — the preset is a ceiling, not a target.
    const framing = computeFraming(media(1280, 720), 'source', 1440)
    expect(framing).toMatchObject({ outWidth: 1280, outHeight: 720 })
  })

  it('centre-crops 16:9 footage into a 9:16 vertical frame', () => {
    const { crop } = computeFraming(media(1920, 1080), '9:16', null)
    expect(crop).not.toBeNull()
    expect(crop!.height).toBe(1080)
    expect(crop!.width).toBe(608)
    // Equal margins left and right
    expect(crop!.x).toBe((1920 - 608) / 2)
    expect(crop!.y).toBe(0)
  })

  it('crops to a square without touching an already-square source', () => {
    expect(computeFraming(media(1080, 1080), '1:1', null).crop).toBeNull()
  })

  it('always produces even dimensions, which H.264 requires', () => {
    for (const aspect of ['9:16', '4:5', '1:1'] as const) {
      const framing = computeFraming(media(1366, 768), aspect, 720)
      expect(framing.outWidth % 2).toBe(0)
      expect(framing.outHeight % 2).toBe(0)
      if (framing.crop) {
        expect(framing.crop.width % 2).toBe(0)
        expect(framing.crop.height % 2).toBe(0)
      }
    }
  })
})

describe('computeTargetBitrate', () => {
  it('divides the size budget across the clip and reserves room for audio', () => {
    // 10 MiB = 81920 kbit; over 60s that is 1365 kbps, less 3% overhead and audio
    expect(computeTargetBitrate(10, 60, 128)).toBe(1196)
  })

  it('gives a longer clip proportionally less bitrate', () => {
    const short = computeTargetBitrate(25, 30, 128)
    const long = computeTargetBitrate(25, 120, 128)
    expect(short).toBeGreaterThan(long * 3)
  })

  it('never returns an unusable bitrate for an impossible target', () => {
    expect(computeTargetBitrate(1, 3600, 128)).toBe(200)
  })

  it('handles a zero-length selection without dividing by zero', () => {
    expect(computeTargetBitrate(10, 0, 128)).toBe(200)
  })
})

describe('parseSegmentList', () => {
  it('reads filename, start and end from FFmpeg CSV output', () => {
    const entries = parseSegmentList(
      [
        'seg_20260825_170910.mp4,0.000000,2.033333',
        'seg_20260825_170912.mp4,2.033333,4.033333',
        '',
      ].join('\n'),
    )

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      filename: 'seg_20260825_170910.mp4',
      startSeconds: 0,
      endSeconds: 2.033333,
    })
  })

  it('reduces an absolute path to its filename', () => {
    const entries = parseSegmentList('C:\\cache\\seg_20260825_170910.mp4,0.000000,2.000000\n')
    expect(entries[0].filename).toBe('seg_20260825_170910.mp4')
  })

  it('ignores malformed or partially written lines', () => {
    const entries = parseSegmentList('seg_a.mp4,0.0\nnot a row\nseg_b.mp4,0.0,2.0\n')
    expect(entries.map((e) => e.filename)).toEqual(['seg_b.mp4'])
  })
})

describe('parseAudioDevices', () => {
  it('reads the modern (audio)-tagged listing and skips video devices', () => {
    const devices = parseAudioDevices(
      [
        '[dshow @ 0000] "Integrated Camera" (video)',
        '[dshow @ 0000]   Alternative name "@device_pnp_camera"',
        '[dshow @ 0000] "Microphone (Realtek Audio)" (audio)',
        '[dshow @ 0000]   Alternative name "@device_cm_mic"',
      ].join('\n'),
    )

    expect(devices).toHaveLength(1)
    expect(devices[0]).toEqual({ name: 'Microphone (Realtek Audio)', isLoopback: false })
  })

  it('reads the older section-header listing', () => {
    const devices = parseAudioDevices(
      [
        '[dshow @ 0000] DirectShow video devices',
        '[dshow @ 0000]  "Integrated Camera"',
        '[dshow @ 0000] DirectShow audio devices',
        '[dshow @ 0000]  "Stereo Mix (Realtek Audio)"',
        '[dshow @ 0000]  "Microphone"',
      ].join('\n'),
    )

    expect(devices.map((d) => d.name)).toEqual(['Stereo Mix (Realtek Audio)', 'Microphone'])
  })

  it('recognises the devices that can capture system audio', () => {
    const devices = parseAudioDevices(
      [
        '[dshow @ 0] "Stereo Mix (Realtek)" (audio)',
        '[dshow @ 0] "CABLE Output (VB-Audio Virtual Cable)" (audio)',
        '[dshow @ 0] "What U Hear (SB)" (audio)',
        '[dshow @ 0] "Microphone (USB)" (audio)',
      ].join('\n'),
    )

    expect(devices.filter((d) => d.isLoopback).map((d) => d.name)).toEqual([
      'Stereo Mix (Realtek)',
      'CABLE Output (VB-Audio Virtual Cable)',
      'What U Hear (SB)',
    ])
  })

  it('does not list the same device twice', () => {
    const devices = parseAudioDevices(
      ['[dshow @ 0] "Microphone" (audio)', '[dshow @ 0] "Microphone" (audio)'].join('\n'),
    )
    expect(devices).toHaveLength(1)
  })
})

describe('extractReason', () => {
  it('surfaces the driver mismatch rather than the generic failure line', () => {
    const reason = extractReason(
      [
        '[h264_nvenc @ 0000] Loaded Nvenc version 12.2',
        '[h264_nvenc @ 0000] Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2',
        '[h264_nvenc @ 0000] Nvenc unloaded',
      ].join('\n'),
    )

    expect(reason).toBe(
      'Driver does not support the required nvenc API version. Required: 13.1 Found: 12.2',
    )
  })

  it('falls back to the first line when nothing stands out', () => {
    expect(extractReason('[x @ 0] Something went wrong')).toBe('Something went wrong')
  })

  it('always returns something printable', () => {
    expect(extractReason('')).toBe('Unavailable on this machine')
  })
})
