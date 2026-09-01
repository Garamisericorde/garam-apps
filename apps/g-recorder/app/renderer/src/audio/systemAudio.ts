/**
 * Capture the machine's own audio and hand it to the main process as PCM.
 *
 * Chromium can do WASAPI loopback on Windows, which FFmpeg cannot — see
 * SystemAudioBridge for why this lives in the renderer at all. Nothing here is
 * user-visible: it runs for as long as the recorder asks it to.
 */

export interface PcmFormat {
  sampleRate: number
  channels: number
}

declare global {
  interface Window {
    /** Called by the main process through executeJavaScript, for the gesture */
    __gRecorderStartSystemAudio?: (
      format: PcmFormat,
    ) => Promise<{ ok: boolean; error?: string; format?: PcmFormat }>
  }

  /**
   * Not in the DOM types yet, but present since Chromium 94. Gives raw
   * `AudioData` frames straight off a track — no worklet, no module to load.
   */
  interface AudioDataCopyOptions {
    planeIndex: number
    format?: string
  }
  interface AudioDataFrame {
    sampleRate: number
    numberOfChannels: number
    numberOfFrames: number
    allocationSize(options: AudioDataCopyOptions): number
    copyTo(destination: ArrayBuffer | ArrayBufferView, options: AudioDataCopyOptions): void
    close(): void
  }
  const MediaStreamTrackProcessor: {
    new (init: { track: MediaStreamTrack }): { readable: ReadableStream<AudioDataFrame> }
  }
}

let stream: MediaStream | null = null
let reader: ReadableStreamDefaultReader<AudioDataFrame> | null = null

/**
 * Open a stream carrying the desktop's audio.
 *
 * Chromium only attaches loopback audio to a request that also asks for video,
 * so both are requested and the video track is dropped immediately.
 *
 * Two ways in, because they fail on different machines: `getDisplayMedia` goes
 * through the main process's display-media handler, and the older
 * `chromeMediaSource: 'desktop'` constraint bypasses it entirely. The second is
 * Electron-specific and not in the DOM types, hence the cast.
 */
async function openLoopbackStream(): Promise<MediaStream> {
  /*
   * Loopback is not a microphone, so every piece of voice processing Chromium
   * would helpfully apply is damage: echo cancellation ducks the game whenever
   * it thinks it hears a room, gain control pumps the mix, noise suppression
   * eats quiet ambience. Stereo is asked for explicitly because the default
   * lands on mono, which throws away the positional audio that is half the
   * point of a game clip.
   */
  const audio: MediaTrackConstraints = {
    channelCount: 2,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }

  const legacy = {
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop' } },
  } as unknown as MediaStreamConstraints

  const routes: [string, () => Promise<MediaStream>][] = [
    ['getDisplayMedia', () => navigator.mediaDevices.getDisplayMedia({ video: true, audio })],
    ['getUserMedia(desktop)', () => navigator.mediaDevices.getUserMedia(legacy)],
  ]

  const failures: string[] = []
  for (const [name, open] of routes) {
    try {
      return await open()
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`)
    }
  }

  // Every route's reason, not just the first: they fail for different causes,
  // and one of them is usually the one that explains the machine.
  throw new Error(
    `no loopback route worked (secureContext=${window.isSecureContext}) — ${failures.join(' | ')}`,
  )
}

/**
 * Start capturing, resolving with the format the audio actually arrives in.
 *
 * The caller asks for a rate and channel count, but Windows decides: whatever
 * the output device is mixing at is what loopback delivers. Reporting the real
 * numbers back matters because FFmpeg is told to interpret a headerless PCM
 * stream — guess the rate wrong and the recording plays back at the wrong
 * speed, with nothing in the file to reveal why.
 */
export async function startSystemAudioCapture(requested: PcmFormat): Promise<PcmFormat> {
  await stopSystemAudioCapture()

  stream = await openLoopbackStream()

  for (const track of stream.getVideoTracks()) {
    track.stop()
    stream.removeTrack(track)
  }

  const track = stream.getAudioTracks()[0]
  if (!track) {
    await stopSystemAudioCapture()
    throw new Error('Windows returned no system audio track')
  }

  // Frames come straight off the track. The obvious alternative, an
  // AudioWorklet, needs a script module loaded by URL, and a blob module is
  // refused here — which surfaces as `AbortError: The user aborted a request`,
  // indistinguishable from the capture itself being denied.
  const processor = new MediaStreamTrackProcessor({ track })
  reader = processor.readable.getReader()

  const first = await reader.read()
  if (first.done || !first.value) {
    await stopSystemAudioCapture()
    throw new Error('System audio track ended before delivering any audio')
  }

  const format: PcmFormat = {
    sampleRate: first.value.sampleRate || requested.sampleRate,
    channels: first.value.numberOfChannels || requested.channels,
  }

  send(first.value)
  void pump(reader)

  return format
}

/** Forward one frame as interleaved 16-bit PCM, then release it */
function send(frame: AudioDataFrame): void {
  try {
    const options = { planeIndex: 0, format: 's16' }
    const buffer = new ArrayBuffer(frame.allocationSize(options))
    frame.copyTo(buffer, options)
    window.api.systemAudio.sendChunk(buffer)
  } finally {
    // AudioData holds a hardware buffer; not closing it stalls the track.
    frame.close()
  }
}

async function pump(active: ReadableStreamDefaultReader<AudioDataFrame>): Promise<void> {
  try {
    for (;;) {
      const { value, done } = await active.read()
      if (done || !value) return
      // A stop that lands mid-read must not keep forwarding into a dead pipe.
      if (reader !== active) {
        value.close()
        return
      }
      send(value)
    }
  } catch (err) {
    window.api.systemAudio.reportError(err instanceof Error ? err.message : String(err))
  }
}

export async function stopSystemAudioCapture(): Promise<void> {
  const active = reader
  reader = null
  if (active) await active.cancel().catch(() => undefined)

  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}
