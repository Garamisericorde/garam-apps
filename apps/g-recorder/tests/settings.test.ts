import { describe, expect, it } from 'vitest'
import { sanitizeSettings, validateSettings } from '../app/main/settings/schema'
import { DEFAULT_SETTINGS } from '../app/main/settings/defaults'
import { clamp, formatBytes, formatDuration, formatTime, localTimestamp } from '../app/shared/time'
import { computeFraming } from '../app/main/ffmpeg/ExportService'
import { getAspectRatio, getPreset, resolutionHeight } from '../app/shared/presets'

describe('validateSettings', () => {
  it('accepts a partial update', () => {
    expect(validateSettings({ fps: 30 }).valid).toBe(true)
  })

  it('rejects an unsupported frame rate', () => {
    // 45 rather than 144: high-refresh rates are supported now, so the example
    // has to be one no display mode offers.
    const { valid, errors } = validateSettings({ fps: 45 })
    expect(valid).toBe(false)
    expect(errors[0]).toContain('fps')
  })

  it('accepts the high-refresh rates a 120/144 Hz display needs', () => {
    expect(validateSettings({ fps: 120 }).valid).toBe(true)
    expect(validateSettings({ fps: 144 }).valid).toBe(true)
  })

  it('rejects a replay length outside the supported range', () => {
    expect(validateSettings({ replayLengthMinutes: 0 }).valid).toBe(false)
    expect(validateSettings({ replayLengthMinutes: 999 }).valid).toBe(false)
    expect(validateSettings({ replayLengthMinutes: 30 }).valid).toBe(true)
  })

  it('rejects an empty output path', () => {
    expect(validateSettings({ outputPath: '   ' }).valid).toBe(false)
  })

  it('allows a null audio device, meaning "pick one automatically"', () => {
    expect(validateSettings({ systemAudioDevice: null }).valid).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(validateSettings(null).valid).toBe(false)
    expect(validateSettings('nope').valid).toBe(false)
  })
})

describe('sanitizeSettings', () => {
  it('keeps good fields and resets only the bad ones', () => {
    const { settings, warnings } = sanitizeSettings({
      fps: 30,
      replayLengthMinutes: 'ten',
      outputPath: 'D:\\Clips',
    })

    expect(settings.fps).toBe(30)
    expect(settings.outputPath).toBe('D:\\Clips')
    expect(settings.replayLengthMinutes).toBe(DEFAULT_SETTINGS.replayLengthMinutes)
    expect(warnings).toHaveLength(1)
  })

  it('migrates the v0.1 audioDevice field to systemAudioDevice', () => {
    const { settings } = sanitizeSettings({ audioDevice: 'Stereo Mix' })
    expect(settings.systemAudioDevice).toBe('Stereo Mix')
    expect(settings).not.toHaveProperty('audioDevice')
  })

  it('does not let the legacy field overwrite an explicit new one', () => {
    const { settings } = sanitizeSettings({
      audioDevice: 'Old Device',
      systemAudioDevice: 'New Device',
    })
    expect(settings.systemAudioDevice).toBe('New Device')
  })

  it('falls back to defaults for a corrupt file instead of throwing', () => {
    const { settings, warnings } = sanitizeSettings('not json at all')
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(warnings).toHaveLength(1)
  })

  it('fills in fields an older version never wrote', () => {
    const { settings } = sanitizeSettings({ fps: 60 })
    expect(settings.autoStartRecording).toBe(DEFAULT_SETTINGS.autoStartRecording)
    expect(settings.monitorIndex).toBe(0)
  })
})

describe('presets', () => {
  it('exposes the three documented export presets', () => {
    expect(getPreset('small')).toBeDefined()
    expect(getPreset('balanced')).toBeDefined()
    expect(getPreset('high')).toBeDefined()
    expect(getPreset('nope')).toBeUndefined()
  })

  it('keeps the source resolution for the high-quality preset', () => {
    expect(resolutionHeight(getPreset('high')!.resolution)).toBeNull()
    expect(resolutionHeight('720p')).toBe(720)
  })

  it('maps aspect ids to ratios', () => {
    expect(getAspectRatio('source')).toBeNull()
    expect(getAspectRatio('1:1')).toBe(1)
    expect(getAspectRatio('9:16')).toBeCloseTo(0.5625)
  })

  it('caps the small preset so a share-sized file is plausible', () => {
    const small = getPreset('small')!
    expect(small.maxBitrateKbps).toBeGreaterThan(0)
    expect(small.maxBitrateKbps).toBeLessThan(getPreset('balanced')!.maxBitrateKbps)
  })

  it('produces a portrait frame for the 9:16 preset combination', () => {
    const framing = computeFraming(
      { path: 'a', durationSeconds: 1, width: 1920, height: 1080, fps: 60, hasAudio: false, sizeBytes: 0 },
      '9:16',
      720,
    )
    expect(framing.outHeight).toBeGreaterThan(framing.outWidth)
  })
})

describe('time helpers', () => {
  it('formats a playhead position with milliseconds', () => {
    expect(formatTime(0)).toBe('00:00.000')
    expect(formatTime(65.5)).toBe('01:05.500')
  })

  it('clamps negative times instead of printing nonsense', () => {
    expect(formatTime(-3)).toBe('00:00.000')
    expect(formatDuration(-3)).toBe('00:00')
  })

  it('adds an hours field only when needed', () => {
    expect(formatDuration(59)).toBe('00:59')
    expect(formatDuration(3661)).toBe('01:01:01')
  })

  it('formats byte counts at a readable precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
  })

  it('builds a filesystem-safe timestamp', () => {
    const stamp = localTimestamp(new Date(2026, 7, 25, 9, 5, 3))
    expect(stamp).toBe('2026-08-25_09-05-03')
    expect(stamp).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})
