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
    const { valid, errors } = validateSettings({ fps: 45 })
    expect(valid).toBe(false)
    expect(errors[0]).toContain('fps')
  })

  it('accepts the two rates that are offered', () => {
    expect(validateSettings({ fps: 30 }).valid).toBe(true)
    expect(validateSettings({ fps: 60 }).valid).toBe(true)
  })

  it('rejects a display refresh rate as a capture rate', () => {
    // 144 was offered once. A settings file written then must not keep a rate
    // the encoder is no longer set up for.
    expect(validateSettings({ fps: 144 }).valid).toBe(false)
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
    expect(stamp).toBe('2026-08-25 09.05.03')
    expect(stamp).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('bindings survive a round trip', () => {
  it('keeps a custom hotkey when the file is read back', () => {
    // The complaint this covers: hotkeys reverting to the defaults on their
    // own. Anything sanitize does not copy across silently becomes a default
    // again on the next launch, which reads exactly like "it reset itself".
    const stored = {
      ...DEFAULT_SETTINGS,
      hotkeySaveReplay: 'Ctrl+Shift+F8',
      hotkeyToggleRecording: null,
      editorKeySplit: 'C',
      padSaveReplay: 'LB+RB+A',
    }

    const { settings, warnings } = sanitizeSettings(stored)

    expect(warnings).toEqual([])
    expect(settings.hotkeySaveReplay).toBe('Ctrl+Shift+F8')
    expect(settings.hotkeyToggleRecording).toBeNull()
    expect(settings.editorKeySplit).toBe('C')
    expect(settings.padSaveReplay).toBe('LB+RB+A')
  })

  it('validates every setting it can store', () => {
    // A key with no validator is never copied out of the file, so it reverts
    // to its default on every load — invisibly.
    const validated = Object.keys(sanitizeSettings({}).settings)
    for (const key of validated) {
      expect(validateSettings({ [key]: undefined }).valid).toBe(true)
    }
    expect(validated.sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })
})

describe('a crop drawn on the preview', () => {
  const info = {
    path: 'a.mp4',
    durationSeconds: 10,
    width: 2560,
    height: 1440,
    fps: 60,
    hasAudio: true,
    sizeBytes: 0,
  }

  it('cuts exactly where it was drawn', () => {
    // Half the height, starting a quarter of the way down.
    const framing = computeFraming(info, 'source', null, {
      x: 0,
      y: 0.25,
      width: 1,
      height: 0.5,
    })

    expect(framing.crop).toEqual({ x: 0, y: 360, width: 2560, height: 720 })
    expect(framing.outWidth).toBe(2560)
    expect(framing.outHeight).toBe(720)
  })

  it('rounds to even, since half a pixel is not a video', () => {
    const framing = computeFraming(info, 'source', null, {
      x: 0.1,
      y: 0.1,
      width: 0.333,
      height: 0.333,
    })

    expect(framing.crop!.width % 2).toBe(0)
    expect(framing.crop!.height % 2).toBe(0)
    expect(framing.crop!.x % 2).toBe(0)
    expect(framing.crop!.y % 2).toBe(0)
  })

  it('keeps the rectangle inside the frame', () => {
    const framing = computeFraming(info, 'source', null, {
      x: 0.9,
      y: 0.9,
      width: 0.5,
      height: 0.5,
    })

    expect(framing.crop!.x + framing.crop!.width).toBeLessThanOrEqual(2560)
    expect(framing.crop!.y + framing.crop!.height).toBeLessThanOrEqual(1440)
  })

  it('overrides the aspect preset rather than compounding with it', () => {
    // Applying both would move the rectangle the user placed, which is the one
    // thing it must not do.
    const framing = computeFraming(info, '1:1', null, { x: 0, y: 0, width: 1, height: 0.5 })
    expect(framing.crop).toEqual({ x: 0, y: 0, width: 2560, height: 720 })
  })

  it('scales the crop to the preset height, not the source height', () => {
    const framing = computeFraming(info, 'source', 720, { x: 0, y: 0, width: 0.5, height: 1 })
    expect(framing.outHeight).toBe(720)
    expect(framing.outWidth).toBe(640)
  })
})
