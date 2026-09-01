import { describe, expect, it } from 'vitest'
import {
  buildCaptureArgs,
  buildClipExportArgs,
  buildConcatCopyArgs,
  buildGifExportArgs,
  buildSegmentOutputArgs,
  buildVideoEncodeArgs,
} from '../app/main/ffmpeg/commands'
import type { ClipExportOptions } from '../app/main/ffmpeg/commands'
import { DEFAULT_SETTINGS } from '../app/main/settings/defaults'
import type { AppSettings } from '../app/shared/types'

/** Read the value that follows a flag, e.g. valueAfter(args, '-t') */
function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('buildVideoEncodeArgs', () => {
  it('uses constant quality by default', () => {
    const args = buildVideoEncodeArgs({ encoder: 'x264', quality: 23 })
    expect(args).toContain('libx264')
    expect(valueAfter(args, '-crf')).toBe('23')
    expect(args).not.toContain('-b:v')
  })

  it('never emits the removed NVENC vbr_hq rate-control mode', () => {
    // Modern FFmpeg only accepts constqp, vbr and cbr; vbr_hq fails outright.
    const args = buildVideoEncodeArgs({ encoder: 'nvenc', quality: 22 })
    expect(args).not.toContain('vbr_hq')
    expect(valueAfter(args, '-rc')).toBe('vbr')
    expect(valueAfter(args, '-cq')).toBe('22')
    expect(valueAfter(args, '-b:v')).toBe('0')
  })

  it('expresses a preset ceiling as a peak cap, not an average target', () => {
    const args = buildVideoEncodeArgs({ encoder: 'x264', quality: 30, maxBitrateKbps: 2500 })
    expect(valueAfter(args, '-crf')).toBe('30')
    expect(valueAfter(args, '-maxrate')).toBe('2500k')
    expect(valueAfter(args, '-bufsize')).toBe('5000k')
    expect(args).not.toContain('-b:v')
  })

  it('switches to average bitrate when a size target is requested', () => {
    const args = buildVideoEncodeArgs({ encoder: 'x264', quality: 30, targetBitrateKbps: 1400 })
    expect(valueAfter(args, '-b:v')).toBe('1400k')
    expect(valueAfter(args, '-maxrate')).toBe('1400k')
    expect(args).not.toContain('-crf')
  })

  it('sets a matching GOP and minimum keyframe interval', () => {
    const args = buildVideoEncodeArgs({ encoder: 'x264', quality: 23, gopSize: 120 })
    expect(valueAfter(args, '-g')).toBe('120')
    expect(valueAfter(args, '-keyint_min')).toBe('120')
  })

  it('covers every encoder without falling back to h264 software by accident', () => {
    expect(buildVideoEncodeArgs({ encoder: 'qsv', quality: 23 })).toContain('h264_qsv')
    expect(buildVideoEncodeArgs({ encoder: 'amf', quality: 23 })).toContain('h264_amf')
    expect(buildVideoEncodeArgs({ encoder: 'nvenc', quality: 23 })).toContain('h264_nvenc')
  })

  it('spends quality on picture by default — exports run once', () => {
    expect(valueAfter(buildVideoEncodeArgs({ encoder: 'nvenc', quality: 23 }), '-tune')).toBe('hq')
    expect(valueAfter(buildVideoEncodeArgs({ encoder: 'x264', quality: 23 }), '-preset')).toBe(
      'veryfast',
    )
    expect(valueAfter(buildVideoEncodeArgs({ encoder: 'qsv', quality: 23 }), '-preset')).toBe(
      'medium',
    )
    expect(valueAfter(buildVideoEncodeArgs({ encoder: 'amf', quality: 23 }), '-quality')).toBe(
      'balanced',
    )
  })

  it('spends it on staying out of the way in low-latency mode', () => {
    const nvenc = buildVideoEncodeArgs({ encoder: 'nvenc', quality: 23, lowLatency: true })
    expect(valueAfter(nvenc, '-tune')).toBe('ll')
    expect(valueAfter(nvenc, '-rc-lookahead')).toBe('0')
    expect(valueAfter(nvenc, '-bf')).toBe('0')

    const x264 = buildVideoEncodeArgs({ encoder: 'x264', quality: 23, lowLatency: true })
    expect(valueAfter(x264, '-preset')).toBe('ultrafast')
    expect(valueAfter(x264, '-tune')).toBe('zerolatency')

    expect(
      valueAfter(buildVideoEncodeArgs({ encoder: 'qsv', quality: 23, lowLatency: true }), '-preset'),
    ).toBe('veryfast')
    expect(
      valueAfter(buildVideoEncodeArgs({ encoder: 'amf', quality: 23, lowLatency: true }), '-quality'),
    ).toBe('speed')
  })

  it('caps worker threads for software encoding only', () => {
    expect(valueAfter(buildVideoEncodeArgs({ encoder: 'x264', quality: 23, threads: 4 }), '-threads'))
      .toBe('4')
    // Hardware encoders do the work on the GPU; the flag would only mislead.
    expect(buildVideoEncodeArgs({ encoder: 'nvenc', quality: 23, threads: 4 })).not.toContain(
      '-threads',
    )
  })
})

describe('buildCaptureArgs', () => {
  const base = {
    settings: settings(),
    encoder: 'x264' as const,
    useDdagrab: true,
    useD3d11Direct: false,
    useCudaZeroCopy: false,
    systemAudioDevice: null,
    systemAudioPipe: null,
    micDevice: null,
  }

  const LOOPBACK = { sampleRate: 48_000, channels: 2, codec: 's16le' }

  describe('system audio over the stdin pipe', () => {
    it('declares the raw PCM format, since a pipe carries no header', () => {
      const args = buildCaptureArgs({ ...base, systemAudioPipe: LOOPBACK })
      expect(valueAfter(args, '-f')).toBeDefined()
      expect(args).toContain('pipe:0')
      expect(args).toContain('s16le')
      expect(valueAfter(args, '-ar')).toBe('48000')
      expect(valueAfter(args, '-ac')).toBe('2')
      expect(args).toContain('1:a:0')
      expect(args).not.toContain('-an')
    })

    it('mixes loopback with the microphone, loopback first', () => {
      const args = buildCaptureArgs({
        ...base,
        systemAudioPipe: LOOPBACK,
        micDevice: 'Microphone',
      })
      const graph = valueAfter(args, '-filter_complex') ?? ''

      expect(graph).toContain('[1:a][2:a]amix=inputs=2')
      // Input 1 is the pipe, input 2 the microphone — the order the maps assume
      expect(args.indexOf('pipe:0')).toBeLessThan(args.indexOf('audio=Microphone'))
    })

    it('prefers the loopback pipe over a DirectShow device, never both', () => {
      const args = buildCaptureArgs({
        ...base,
        systemAudioPipe: LOOPBACK,
        systemAudioDevice: 'Stereo Mix',
      })
      expect(args).toContain('pipe:0')
      expect(args).not.toContain('audio=Stereo Mix')
      // One system-audio input only, or the maps below it shift by one
      expect(args.filter((a) => a === '-i')).toHaveLength(2)
    })
  })

  describe('D3D11-direct path', () => {
    it('inserts no video filter at all — a filter would undo the whole point', () => {
      const args = buildCaptureArgs({ ...base, encoder: 'nvenc', useD3d11Direct: true })
      expect(args).not.toContain('-vf')
      expect(args).not.toContain('-filter_complex')
      expect(args).toContain('h264_nvenc')
      // Video still has to be mapped explicitly now that no filter names it
      expect(args).toContain('0:v:0')
    })

    it('still mixes two audio sources without pulling video into the graph', () => {
      const args = buildCaptureArgs({
        ...base,
        encoder: 'nvenc',
        useD3d11Direct: true,
        systemAudioDevice: 'Stereo Mix',
        micDevice: 'Microphone',
      })
      const graph = valueAfter(args, '-filter_complex') ?? ''

      expect(graph).toContain('[1:a][2:a]amix=inputs=2')
      // The moment [0:v] enters the graph the frames leave the GPU
      expect(graph).not.toContain('[0:v]')
      expect(args).toContain('0:v:0')
      expect(args).toContain('[aout]')
    })

    it('maps a single audio device alongside the unfiltered video', () => {
      const args = buildCaptureArgs({
        ...base,
        encoder: 'nvenc',
        useD3d11Direct: true,
        systemAudioDevice: 'Stereo Mix',
      })
      expect(args).not.toContain('-filter_complex')
      expect(args).toContain('1:a:0')
      expect(args).toContain('0:v:0')
    })
  })

  it('downloads ddagrab frames before a software encoder touches them', () => {
    const filter = valueAfter(buildCaptureArgs(base), '-vf') ?? ''
    expect(filter).toContain('hwdownload')
    expect(filter).toContain('format=bgra')
    expect(filter).toContain('format=yuv420p')
    expect(filter).not.toContain('scale_cuda')
  })

  it('keeps frames on the GPU only when the zero-copy path was probed', () => {
    const filter =
      valueAfter(buildCaptureArgs({ ...base, encoder: 'nvenc', useCudaZeroCopy: true }), '-vf') ?? ''
    expect(filter).toContain('hwmap=derive_device=cuda')
    expect(filter).toContain('scale_cuda')
    expect(filter).not.toContain('hwdownload')
  })

  it('falls back to a system-memory round trip when zero-copy is unavailable', () => {
    const filter =
      valueAfter(buildCaptureArgs({ ...base, encoder: 'nvenc', useCudaZeroCopy: false }), '-vf') ?? ''
    expect(filter).toContain('hwdownload')
    expect(filter).toContain('format=nv12')
    expect(filter).not.toContain('hwmap')
  })

  it('passes the monitor index, frame rate and cursor flag to ddagrab', () => {
    const args = buildCaptureArgs({
      ...base,
      settings: settings({ monitorIndex: 1, fps: 30, captureCursor: false }),
    })
    expect(valueAfter(args, '-i')).toBe('ddagrab=output_idx=1:framerate=30:draw_mouse=0')
  })

  it('uses gdigrab when ddagrab is unavailable', () => {
    const args = buildCaptureArgs({ ...base, useDdagrab: false })
    expect(args).toContain('gdigrab')
    expect(valueAfter(args, '-i')).toBe('desktop')
    expect(valueAfter(args, '-vf')).not.toContain('hwdownload')
  })

  it('skips scaling entirely at source resolution', () => {
    const filter =
      valueAfter(buildCaptureArgs({ ...base, settings: settings({ resolution: 'source' }) }), '-vf') ??
      ''
    expect(filter).not.toContain('scale=')
  })

  it('encodes for low latency — the buffer runs next to a game, not alone', () => {
    const args = buildCaptureArgs({ ...base, encoderThreads: 6 })
    expect(valueAfter(args, '-preset')).toBe('ultrafast')
    expect(valueAfter(args, '-tune')).toBe('zerolatency')
    expect(valueAfter(args, '-threads')).toBe('6')
  })

  it('gives every input a queue deep enough to absorb an encoder stall', () => {
    const args = buildCaptureArgs({ ...base, systemAudioDevice: 'Stereo Mix', micDevice: 'Mic' })
    // One per input: video plus the two audio devices. A blocked demuxer thread
    // stalls the desktop capture, which the user sees as a hitch in the game.
    const queues = args.filter((a) => a === '-thread_queue_size')
    expect(queues).toHaveLength(3)
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-thread_queue_size') expect(Number(args[i + 1])).toBeGreaterThan(8)
    }
  })

  it('asks for a progress stream — the overlay reads its frame rate from it', () => {
    const args = buildCaptureArgs(base)
    expect(valueAfter(args, '-progress')).toBe('pipe:1')
  })

  it('records silence when no audio device is selected', () => {
    const args = buildCaptureArgs(base)
    expect(args).toContain('-an')
    expect(args).not.toContain('dshow')
  })

  it('maps a single audio device without a filter graph', () => {
    const args = buildCaptureArgs({ ...base, systemAudioDevice: 'Stereo Mix (Realtek)' })
    expect(args).toContain('audio=Stereo Mix (Realtek)')
    expect(args).toContain('-map')
    expect(args).toContain('1:a:0')
    expect(args).not.toContain('-filter_complex')
  })

  it('mixes system audio and microphone through a single filter graph', () => {
    const args = buildCaptureArgs({
      ...base,
      systemAudioDevice: 'Stereo Mix',
      micDevice: 'Microphone',
    })
    const graph = valueAfter(args, '-filter_complex') ?? ''

    expect(graph).toContain('[1:a][2:a]amix=inputs=2')
    expect(graph).toContain('[vout]')
    expect(graph).toContain('[aout]')
    // -vf and -filter_complex cannot both drive the same stream
    expect(args).not.toContain('-vf')
  })
})

describe('buildSegmentOutputArgs', () => {
  it('asks FFmpeg for a CSV list so segment timings never have to be guessed', () => {
    const args = buildSegmentOutputArgs(2, 'C:\\cache\\seg_%Y%m%d_%H%M%S.mp4', 'C:\\cache\\list.csv')

    expect(valueAfter(args, '-segment_time')).toBe('2')
    expect(valueAfter(args, '-segment_list_type')).toBe('csv')
    expect(valueAfter(args, '-segment_list')).toBe('C:\\cache\\list.csv')
    // +live flushes each entry as its segment closes
    expect(valueAfter(args, '-segment_list_flags')).toBe('+live')
    expect(args[args.length - 1]).toContain('seg_%Y%m%d_%H%M%S.mp4')
  })
})

describe('buildConcatCopyArgs', () => {
  it('stitches segments without re-encoding', () => {
    const args = buildConcatCopyArgs('list.txt', 'out.mp4')
    expect(valueAfter(args, '-f')).toBe('concat')
    expect(valueAfter(args, '-c')).toBe('copy')
    expect(args).toContain('+faststart')
  })
})

describe('buildClipExportArgs', () => {
  const base: ClipExportOptions = {
    clipPath: 'in.mp4',
    outputPath: 'out.mp4',
    inPoint: 1,
    outPoint: 5,
    encoder: 'x264',
    outWidth: 1280,
    outHeight: 720,
    crop: null,
    fps: 30,
    quality: 30,
    maxBitrateKbps: 2500,
    audioBitrateKbps: 96,
    speed: 1,
    volume: 1,
    hasAudio: true,
  }

  it('seeks before the input so long replays do not decode from the start', () => {
    const args = buildClipExportArgs(base)
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('-accurate_seek')
    expect(valueAfter(args, '-ss')).toBe('1.000')
  })

  it('limits output to the selection length at normal speed', () => {
    expect(valueAfter(buildClipExportArgs(base), '-t')).toBe('4.000')
  })

  it('scales -t by speed, because -t caps the output timeline', () => {
    // 4s of source at 2x is 2s of output; passing 4 here would export the
    // entire remaining clip instead of the selection.
    expect(valueAfter(buildClipExportArgs({ ...base, speed: 2 }), '-t')).toBe('2.000')
    expect(valueAfter(buildClipExportArgs({ ...base, speed: 0.5 }), '-t')).toBe('8.000')
  })

  it('retimes before resampling so the preset frame rate is what lands', () => {
    const filter = valueAfter(buildClipExportArgs({ ...base, speed: 2 }), '-vf') ?? ''
    expect(filter).toContain('setpts=0.500000*PTS')
    expect(filter.indexOf('setpts')).toBeLessThan(filter.indexOf('fps='))
  })

  it('applies a centre crop before scaling', () => {
    const filter =
      valueAfter(
        buildClipExportArgs({ ...base, crop: { width: 608, height: 1080, x: 656, y: 0 } }),
        '-vf',
      ) ?? ''
    expect(filter.startsWith('crop=608:1080:656:0')).toBe(true)
    expect(filter.indexOf('crop=')).toBeLessThan(filter.indexOf('scale='))
  })

  it('chains atempo so speeds outside its 0.5–2.0 range still work', () => {
    const filter = valueAfter(buildClipExportArgs({ ...base, speed: 4 }), '-af') ?? ''
    expect(filter).toBe('atempo=2.0,atempo=2.0')
  })

  it('leaves audio untouched at normal speed and full volume', () => {
    expect(valueAfter(buildClipExportArgs(base), '-af')).toBe('anull')
  })

  it('drops the audio track when volume is zero', () => {
    const args = buildClipExportArgs({ ...base, volume: 0 })
    expect(args).toContain('-an')
    expect(args).not.toContain('-af')
  })

  it('omits audio for a source that has none', () => {
    expect(buildClipExportArgs({ ...base, hasAudio: false })).toContain('-an')
  })

  it('emits machine-readable progress and suppresses the stderr bar', () => {
    const args = buildClipExportArgs(base)
    expect(valueAfter(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostats')
  })
})

describe('buildGifExportArgs', () => {
  const base = {
    clipPath: 'in.mp4',
    outputPath: 'out.gif',
    inPoint: 0,
    outPoint: 4,
    outWidth: 640,
    outHeight: 360,
    crop: null,
    fps: 12,
    speed: 1,
  }

  it('generates and applies a palette in one pass', () => {
    const graph = valueAfter(buildGifExportArgs(base), '-filter_complex') ?? ''
    expect(graph).toContain('palettegen')
    expect(graph).toContain('paletteuse')
    expect(graph).toContain('split[a][b]')
  })

  it('loops forever', () => {
    expect(valueAfter(buildGifExportArgs(base), '-loop')).toBe('0')
  })

  it('applies the same speed-aware output duration as video export', () => {
    expect(valueAfter(buildGifExportArgs({ ...base, speed: 2 }), '-t')).toBe('2.000')
  })
})
