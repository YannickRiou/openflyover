import { beforeEach, describe, expect, it, vi } from 'vitest'

// WebCodecs is not available in jsdom: mediabunny is replaced by a recording fake.
const fake = vi.hoisted(() => ({
  outputs: [] as {
    format: { kind: string; options?: { fastStart?: unknown } }
    state: string
    finalize: () => Promise<void>
    cancel: () => Promise<void>
    videoMetadata?: { canBeTransparent?: boolean }
  }[],
  streams: [] as { options: unknown }[],
  sources: [] as {
    config: {
      codec: string
      alpha?: string
      keyFrameInterval?: number
      hardwareAcceleration?: string
      quality: { options: { bitrate: number } }
      onEncodedSample: () => void
      onEncodedPacket: () => void
    }
    added: [number, number][]
    closed: boolean
  }[],
  /** video samples taken from the canvas, closed once encoded */
  samples: [] as { closed: boolean; data: unknown }[],
  /** chunks the fake output writes when finalized, at their position (none: an empty file) */
  writes: [] as [position: number, bytes: number[]][],
  /** audio sources and what they received: [timestamp, frames, first value of each channel] */
  sounds: [] as { config: { codec: string }; added: [number, number, number[]][]; closed: boolean }[],
  /** order of the calls reaching the tracks: 'v' (a frame), 'a' (a sound sample) */
  calls: [] as string[],
}))

vi.mock('mediabunny', () => {
  class Quality {
    options: unknown
    constructor(options: unknown) {
      this.options = options
    }
  }
  // like mediabunny: a writer taken at start, chunks at their position, closed on finalize and on cancel
  class StreamTarget {
    writer: WritableStreamDefaultWriter<{ type: 'write'; data: Uint8Array; position: number }> | null = null
    writable: WritableStream
    options: unknown
    constructor(writable: WritableStream, options: unknown) {
      this.writable = writable
      this.options = options
      fake.streams.push(this)
    }
  }
  class Mp4OutputFormat {
    kind = 'mp4'
    options: unknown
    constructor(options?: unknown) {
      this.options = options
    }
  }
  class WebMOutputFormat {
    kind = 'webm'
  }
  class VideoSample {
    init: { timestamp: number; duration: number }
    data: unknown
    closed = false
    constructor(data: unknown, init: VideoSample['init']) {
      this.data = data
      this.init = init
      fake.samples.push(this)
    }
    close() {
      this.closed = true
    }
  }
  class VideoSampleSource {
    config: unknown
    added: [number, number][] = []
    closed = false
    // mediabunny's internal encoder wrapper
    _encoder = { getQueueSize: () => 2 }
    constructor(config: unknown) {
      this.config = config
      fake.sources.push(this as never)
    }
    async add(sample: VideoSample) {
      this.added.push([sample.init.timestamp, sample.init.duration])
      fake.calls.push('v')
    }
    close() {
      this.closed = true
    }
  }
  class AudioSample {
    init: { data: Float32Array; numberOfChannels: number; sampleRate: number; timestamp: number }
    closed = false
    constructor(init: AudioSample['init']) {
      this.init = init
    }
    close() {
      this.closed = true
    }
  }
  class AudioSampleSource {
    config: unknown
    added: [number, number, number[]][] = []
    closed = false
    constructor(config: unknown) {
      this.config = config
      fake.sounds.push(this as never)
    }
    async add(sample: AudioSample) {
      const { data, numberOfChannels, timestamp } = sample.init
      const frames = data.length / numberOfChannels
      this.added.push([timestamp, frames, Array.from({ length: numberOfChannels }, (_, c) => data[c * frames])])
      fake.calls.push('a')
    }
    close() {
      this.closed = true
    }
  }
  class Output {
    format: unknown
    target: StreamTarget
    state = 'pending'
    constructor({ format, target }: { format: unknown; target: StreamTarget }) {
      this.format = format
      this.target = target
      fake.outputs.push(this as never)
    }
    videoMetadata: unknown
    addVideoTrack(_source: unknown, metadata: unknown) {
      this.videoMetadata = metadata
    }
    audioTracks = 0
    addAudioTrack() {
      this.audioTracks++
    }
    async start() {
      this.state = 'started'
      this.target.writer = this.target.writable.getWriter()
    }
    async finalize() {
      const writer = this.target.writer!
      for (const [position, bytes] of fake.writes) await writer.write({ type: 'write', data: Uint8Array.from(bytes), position })
      await writer.close()
      this.state = 'finalized'
    }
    async cancel() {
      this.state = 'canceled'
      await this.target.writer?.close()
    }
  }
  return {
    Quality,
    StreamTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    VideoSample,
    VideoSampleSource,
    AudioSample,
    AudioSampleSource,
    Output,
    canEncodeVideo: vi.fn(),
    canEncodeAudio: vi.fn(async () => false),
  }
})

import { DESKTOP_BUDGET, budgetFor } from '../core/deviceBudget'
import {
  ALPHA_CANDIDATES,
  AUDIO_LEAD_S,
  CODEC_CANDIDATES,
  ExportCanceledError,
  MAX_BITRATE,
  MIN_BITRATE,
  STREAM_CHUNK_BYTES,
  CODEC_BITRATE_FACTOR,
  candidatesFor,
  createVideoEncoder,
  pickAudioCodec,
  pickCodec,
  deviceBitrateCap,
  targetBitrate,
  videoBitrate,
  type CanEncode,
  type CanEncodeAudio,
} from './encoder'

const OPTIONS = { width: 1920, height: 1080, fps: 30, quality: 'high' as const }
const canvas = {} as OffscreenCanvas

/** canEncode stub accepting only the given codecs, on no hardware encoder. */
function supporting(...codecs: string[]): CanEncode & ReturnType<typeof vi.fn> {
  return vi.fn(async (codec: string, query?: { hardwareAcceleration?: string }) => codecs.includes(codec) && query?.hardwareAcceleration !== 'prefer-hardware') as never
}

/** canEncode stub accepting the given codecs, on the hardware encoder too. */
function onHardware(...codecs: string[]): CanEncode & ReturnType<typeof vi.fn> {
  return vi.fn(async (codec: string) => codecs.includes(codec)) as never
}

beforeEach(() => {
  fake.outputs.length = 0
  fake.streams.length = 0
  fake.sources.length = 0
  fake.samples.length = 0
  // like mediabunny closing a file: the whole of it, then a size patched in the first bytes
  fake.writes = [
    [0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
    [2, [255, 255, 255, 255]],
  ]
  fake.sounds.length = 0
  fake.calls.length = 0
})

describe('videoBitrate', () => {
  it('scales with pixels, frame rate and quality', () => {
    expect(videoBitrate(1280, 720, 30, 'high', 'avc')).toBeLessThan(videoBitrate(1920, 1080, 30, 'high', 'avc'))
    // a higher frame rate costs more, but less than proportionally
    expect(videoBitrate(1920, 1080, 60, 'high', 'avc')).toBeGreaterThan(videoBitrate(1920, 1080, 30, 'high', 'avc'))
    expect(videoBitrate(1920, 1080, 60, 'high', 'avc')).toBeLessThan(2 * videoBitrate(1920, 1080, 30, 'high', 'avc'))
    expect(videoBitrate(1920, 1080, 30, 'standard', 'avc')).toBeLessThan(videoBitrate(1920, 1080, 30, 'max', 'avc'))
  })

  it('gives a sharp flyover enough: about 14 Mbit/s at 1080p24 « élevée »', () => {
    expect(videoBitrate(1920, 1080, 24, 'high', 'avc')).toBeCloseTo(13.9e6, -5)
    expect(videoBitrate(1920, 1080, 24, 'standard', 'avc')).toBeGreaterThan(7e6)
  })

  it('asks less of the more efficient codecs', () => {
    const avc = videoBitrate(1920, 1080, 30, 'high', 'avc')
    expect(videoBitrate(1920, 1080, 30, 'high', 'hevc')).toBeLessThan(avc)
    expect(videoBitrate(1920, 1080, 30, 'high', 'vp9')).toBeLessThan(avc)
    expect(videoBitrate(1920, 1080, 30, 'high', 'vp8')).toBeGreaterThan(avc)
  })

  it('is clamped', () => {
    expect(videoBitrate(320, 180, 10, 'standard', 'avc')).toBe(MIN_BITRATE)
    expect(videoBitrate(3840, 2160, 60, 'max', 'vp8')).toBe(MAX_BITRATE)
  })

  it('has a ceiling on a phone that keeps the film in memory, none on a computer', () => {
    const phone = budgetFor({ coarsePointer: true, shortSidePx: 393 })
    expect(deviceBitrateCap(phone, false)).toBe(8e6)
    expect(videoBitrate(1920, 1080, 30, 'high', 'avc', 8e6)).toBe(8e6)
    // 720p30 « élevée » is already under the ceiling: unchanged
    expect(videoBitrate(1280, 720, 30, 'high', 'avc', 8e6)).toBe(videoBitrate(1280, 720, 30, 'high', 'avc', Infinity))
    // written straight to disk (Chrome Android with a picker, one day): no ceiling
    expect(deviceBitrateCap(phone, true)).toBe(Infinity)
    expect(deviceBitrateCap(budgetFor({ coarsePointer: true, shortSidePx: 820 }), false)).toBe(12e6)
    expect(deviceBitrateCap(DESKTOP_BUDGET, false)).toBe(Infinity)
    expect(videoBitrate(1920, 1080, 30, 'high', 'avc')).toBe(videoBitrate(1920, 1080, 30, 'high', 'avc', Infinity))
  })

  it('takes the bitrate chosen by hand over the quality, within the bounds and the device cap', () => {
    const encoding = { bitrateMbps: 25, codec: 'auto' as const, keyframeIntervalS: 2, audioKbps: 192 }
    expect(targetBitrate({ ...OPTIONS, encoding }, 'hevc', Infinity)).toBe(25e6)
    expect(targetBitrate({ ...OPTIONS, encoding: { ...encoding, bitrateMbps: 0.2 } }, 'avc', Infinity)).toBe(MIN_BITRATE)
    expect(targetBitrate({ ...OPTIONS, encoding }, 'avc', 8e6)).toBe(8e6)
    expect(targetBitrate({ ...OPTIONS, encoding: { ...encoding, bitrateMbps: null } }, 'avc', Infinity)).toBe(videoBitrate(1920, 1080, 30, 'high', 'avc', Infinity))
  })
})

describe('pickCodec', () => {
  it('prefers MP4 / H.264', async () => {
    const canEncode = supporting('avc', 'hevc', 'vp9', 'vp8')
    expect(await pickCodec(OPTIONS, canEncode)).toEqual({ container: 'mp4', codec: 'avc' })
    // the hardware encoder first, refused here, then any
    expect(canEncode).toHaveBeenCalledTimes(2)
    const [codec, query] = canEncode.mock.calls[0] as [string, Record<string, unknown>]
    expect(codec).toBe('avc')
    expect(query).toMatchObject({ width: 1920, height: 1080, frameRate: 30, hardwareAcceleration: 'prefer-hardware' })
    expect(query.quality).toMatchObject({ options: { bitrate: videoBitrate(1920, 1080, 30, 'high', 'avc') } })
    expect(canEncode.mock.calls[1][1]).toMatchObject({ hardwareAcceleration: 'no-preference' })
  })

  it('asks for the hardware encoder when the browser takes the configuration on it', async () => {
    const canEncode = onHardware('avc')
    expect(await pickCodec(OPTIONS, canEncode)).toEqual({ container: 'mp4', codec: 'avc', hardware: true })
    expect(canEncode).toHaveBeenCalledTimes(1)
    await createVideoEncoder(canvas, OPTIONS, onHardware('avc'))
    expect(fake.sources[0].config.hardwareAcceleration).toBe('prefer-hardware')
    await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    expect(fake.sources[1].config.hardwareAcceleration).toBe('no-preference')
  })

  it('falls back to HEVC, then WebM VP9, then VP8', async () => {
    expect(await pickCodec(OPTIONS, supporting('hevc', 'vp8'))).toEqual({ container: 'mp4', codec: 'hevc' })
    expect(await pickCodec(OPTIONS, supporting('vp9', 'vp8'))).toEqual({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec(OPTIONS, supporting('vp8'))).toEqual({ container: 'webm', codec: 'vp8' })
  })

  it('skips a codec whose check throws and returns null when nothing is encodable', async () => {
    const canEncode = vi.fn(async (codec: string) => {
      if (codec === 'avc') throw new TypeError('bad config')
      return codec === 'vp9'
    }) as unknown as CanEncode
    expect(await pickCodec(OPTIONS, canEncode)).toMatchObject({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec(OPTIONS, supporting())).toBeNull()
  })

  it('checks the actual frame size: a vertical 4K film falls back when H.264 is limited to 4096 × 2304', async () => {
    const limitedAvc = vi.fn(async (codec: string, query: { width: number; height: number }) =>
      codec === 'avc' ? query.width <= 4096 && query.height <= 2304 : codec === 'vp9',
    ) as unknown as CanEncode
    expect(await pickCodec({ ...OPTIONS, width: 3840, height: 2160 }, limitedAvc)).toMatchObject({ container: 'mp4', codec: 'avc' })
    expect(await pickCodec({ ...OPTIONS, width: 2160, height: 3840 }, limitedAvc)).toMatchObject({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec({ ...OPTIONS, width: 5040, height: 2160 }, limitedAvc)).toMatchObject({ container: 'webm', codec: 'vp9' })
  })
})

describe('createVideoEncoder', () => {
  it('reads the frame from the source it is given, the canvas of the session otherwise', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    const bitmap = {} as unknown as CanvasImageSource
    expect(session.acceptsSource).toBe(true)
    await session.addFrame(0)
    await session.addFrame(1, bitmap)
    expect(fake.samples.map((sample) => sample.data)).toEqual([canvas, bitmap])
  })

  it('encodes frames at index / fps and returns an MP4 blob', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    expect(session.codec).toEqual({ container: 'mp4', codec: 'avc' })
    expect(session.extension).toBe('.mp4')
    expect(session.mimeType).toBe('video/mp4')
    expect(fake.outputs[0].format.kind).toBe('mp4')
    expect(fake.sources[0].config.codec).toBe('avc')
    expect(fake.sources[0].config.quality.options.bitrate).toBe(session.bitrate)

    await session.addFrame(0)
    await session.addFrame(1)
    await session.addFrame(2)
    expect(fake.sources[0].added.map(([t]) => t)).toEqual([0, 1 / 30, 2 / 30])
    expect(fake.sources[0].added[0][1]).toBeCloseTo(1 / 30)
    expect(fake.samples.every((sample) => sample.closed)).toBe(true)
    expect(fake.sources[0].config.keyFrameInterval).toBe(2)

    const { blob, sizeBytes } = await session.finish()
    expect(blob?.type).toBe('video/mp4')
    expect(blob?.size).toBe(10)
    expect(sizeBytes).toBe(10)
    expect(fake.outputs[0].format.options?.fastStart).toBe('in-memory')
    expect(fake.sources[0].closed).toBe(true)
    expect(fake.outputs[0].state).toBe('finalized')
  })

  it('counts the frames in the encoder: handed over minus packets out, and its queue', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    const { onEncodedSample, onEncodedPacket } = fake.sources[0].config
    onEncodedSample()
    onEncodedSample()
    onEncodedSample()
    onEncodedPacket()
    expect(session.counters?.()).toEqual({ inFlight: 2, queue: 2 })
  })

  it('writes WebM when only VP9 / VP8 are available', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('vp8'))
    expect(session.extension).toBe('.webm')
    expect(fake.outputs[0].format.kind).toBe('webm')
    expect((await session.finish()).blob?.type).toBe('video/webm')
  })

  it('keeps the alpha of a transparent film, in WebM / VP9 only', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, transparent: true }, supporting('avc', 'vp9'))
    expect(session.codec).toEqual({ container: 'webm', codec: 'vp9' })
    expect(fake.sources[0].config.alpha).toBe('keep')
    expect(fake.outputs[0].videoMetadata).toMatchObject({ canBeTransparent: true })
    expect(await pickCodec(OPTIONS, supporting('avc', 'vp8'), ALPHA_CANDIDATES)).toBeNull()
    await expect(createVideoEncoder(canvas, { ...OPTIONS, transparent: true }, supporting('avc', 'vp8'))).rejects.toThrow(/aucun format/)
  })

  it('takes the canvas at the call, before awaiting anything: the next frame may be drawn meanwhile', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, fps: 2, audio: soundtrack(3) }, supporting('avc'), supporting('aac') as never)
    const pending = session.addFrame(0)
    expect(fake.samples).toHaveLength(1)
    await pending
    expect(fake.samples[0].closed).toBe(true)
  })

  it('encodes with the codec, key frames and sound bitrate chosen in « Encodage »', async () => {
    const encoding = { bitrateMbps: 30, codec: 'vp9' as const, keyframeIntervalS: 5, audioKbps: 128 }
    const session = await createVideoEncoder(canvas, { ...OPTIONS, encoding, audio: soundtrack(1) }, supporting('avc', 'vp9'), supporting('opus') as never)
    expect(session.codec).toEqual({ container: 'webm', codec: 'vp9' })
    expect(session.bitrate).toBe(30e6)
    expect(fake.sources[0].config.keyFrameInterval).toBe(5)
    expect(fake.sounds[0].config).toMatchObject({ quality: { options: { bitrate: 128_000 } } })
    await expect(createVideoEncoder(canvas, { ...OPTIONS, encoding: { ...encoding, codec: 'hevc' } }, supporting('avc'))).rejects.toThrow(/HEVC/)
    expect(candidatesFor('Tour.mp4', 'vp9')).toEqual([{ container: 'webm', codec: 'vp9' }])
    // AV1 only when it is chosen: « Automatique » never lands on a slow software encoder
    expect(candidatesFor('Tour.mp4', 'av1')).toEqual([{ container: 'mp4', codec: 'av1' }])
    expect(candidatesFor(undefined, 'auto').some((c) => c.codec === 'av1')).toBe(false)
    expect(candidatesFor('Tour.mp4', 'auto').some((c) => c.codec === 'av1')).toBe(false)
    expect(CODEC_BITRATE_FACTOR.av1).toBeLessThan(CODEC_BITRATE_FACTOR.hevc!)
  })

  it('discards the alpha of an ordinary film', async () => {
    await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    expect(fake.sources[0].config.alpha).toBe('discard')
    expect(fake.outputs[0].videoMetadata).toMatchObject({ canBeTransparent: false })
  })

  it('rejects when no codec is available', async () => {
    await expect(createVideoEncoder(canvas, OPTIONS, supporting())).rejects.toThrow(/aucun format/)
    expect(fake.outputs).toHaveLength(0)
  })

  it('cancel aborts the output and refuses later frames', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    await session.addFrame(0)
    await session.cancel()
    await session.cancel()
    expect(fake.outputs[0].state).toBe('canceled')
    await expect(session.addFrame(1)).rejects.toBeInstanceOf(ExportCanceledError)
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('reports an empty output', async () => {
    fake.writes = []
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    await expect(session.finish()).rejects.toThrow(/vide/)
  })
})

describe('createVideoEncoder in memory', () => {
  it('builds the Blob from the chunks of the muxer, never from one concatenated buffer', async () => {
    const RealBlob = Blob
    const built: unknown[][] = []
    vi.stubGlobal(
      'Blob',
      class extends RealBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options)
          built.push(parts ?? [])
        }
      },
    )
    try {
      const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
      await session.addFrame(0)
      const { blob, sizeBytes } = await session.finish()
      // a chunked stream target, like the disk's: no buffer target growing and copied at the end
      expect(fake.streams[0].options).toEqual({ chunked: true, chunkSize: STREAM_CHUNK_BYTES })
      expect(sizeBytes).toBe(10)
      expect(blob?.type).toBe('video/mp4')
      // the bytes patched at the start replace the first ones
      expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0, 1, 255, 255, 255, 255, 6, 7, 8, 9])
      // the film is a Blob of Blobs (before the patch, the patch, after it), each chunk a Blob of its own as it arrived
      expect(built.at(-1)).toHaveLength(3)
      expect(built.at(-1)?.every((part) => part instanceof RealBlob)).toBe(true)
      expect(built.slice(0, -1).flat().every((part) => ArrayBuffer.isView(part) && part.byteLength <= 10)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the chunks in order wherever they land, and fills a gap with zeros', async () => {
    fake.writes = [
      [4, [4, 5]],
      [0, [0, 1]],
      [8, [8]],
    ]
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    const { blob } = await session.finish()
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0, 1, 0, 0, 4, 5, 0, 0, 8])
  })
})

/** Destination file recording what reaches it. */
function fakeFile(fileName = 'Tour.mp4') {
  return {
    fileName,
    write: vi.fn(async (_data: Uint8Array, _position: number) => undefined),
    close: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
  }
}

describe('createVideoEncoder on disk', () => {
  it('streams a plain MP4 (no fast start) to the destination, in chunks', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    expect(fake.outputs[0].format.options?.fastStart).toBe(false)
    expect(fake.streams[0].options).toEqual({ chunked: true, chunkSize: STREAM_CHUNK_BYTES })
    await session.addFrame(0)
    const { blob, sizeBytes } = await session.finish()
    expect(blob).toBeNull()
    expect(sizeBytes).toBe(10)
    expect(destination.write.mock.calls.map(([data, position]) => [position, data.length])).toEqual([
      [0, 10],
      [2, 4],
    ])
    expect(destination.close).toHaveBeenCalledTimes(1)
    expect(destination.discard).not.toHaveBeenCalled()
  })

  it('removes the file when canceled (mediabunny closes its writer then)', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    await session.addFrame(0)
    await session.cancel()
    expect(destination.close).not.toHaveBeenCalled()
    expect(destination.discard).toHaveBeenCalled()
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('removes the file even when canceling fails (a write failed)', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    vi.spyOn(fake.outputs[0], 'cancel').mockRejectedValueOnce(new Error('disque plein'))
    await expect(session.cancel()).rejects.toThrow(/disque plein/)
    expect(destination.discard).toHaveBeenCalledTimes(1)
  })

  it('follows the extension of the chosen file', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination: fakeFile('Tour.webm') }, supporting('avc', 'vp9'))
    expect(session.codec).toEqual({ container: 'webm', codec: 'vp9' })
    expect(candidatesFor('Tour.MP4').map((c) => c.container)).toEqual(['mp4', 'mp4'])
    expect(candidatesFor('Tour')).toBe(CODEC_CANDIDATES)
    expect(candidatesFor(undefined)).toBe(CODEC_CANDIDATES)
  })
})

/** Soundtrack of `seconds` at a tiny rate: channel c holds c + sample index / 1000. */
function soundtrack(seconds: number, sampleRate = 10, channels = 2) {
  return {
    sampleRate,
    channels: Array.from({ length: channels }, (_, c) => Float32Array.from({ length: seconds * sampleRate }, (_, i) => c + i / 1000)),
  }
}

describe('soundtrack', () => {
  it('prefers AAC in MP4, else Opus; only Opus in WebM', async () => {
    const audio = soundtrack(1)
    expect(await pickAudioCodec('mp4', audio, supporting('aac', 'opus') as unknown as CanEncodeAudio)).toBe('aac')
    expect(await pickAudioCodec('mp4', audio, supporting('opus') as unknown as CanEncodeAudio)).toBe('opus')
    expect(await pickAudioCodec('webm', audio, supporting('aac') as unknown as CanEncodeAudio)).toBeNull()
    const canEncode = supporting('opus') as unknown as CanEncodeAudio & ReturnType<typeof vi.fn>
    await pickAudioCodec('webm', audio, canEncode)
    expect(canEncode.mock.calls[0][1]).toMatchObject({ numberOfChannels: 2, sampleRate: 10 })
  })

  it('hands the sound over along the frames, about a second ahead, then the rest at the end', async () => {
    // 3 s of sound for a 2 fps film of 6 frames
    const session = await createVideoEncoder(canvas, { ...OPTIONS, fps: 2, audio: soundtrack(3) }, supporting('avc'), supporting('aac') as never)
    expect(session.audioCodec).toBe('aac')
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 1 })
    expect(fake.sounds[0].config).toMatchObject({ codec: 'aac' })
    await session.addFrame(0)
    // frame 0 lasts until 0.5 s: sound up to 0.5 + AUDIO_LEAD_S before it
    expect(fake.sounds[0].added.reduce((n, [, frames]) => n + frames, 0)).toBe((0.5 + AUDIO_LEAD_S) * 10)
    expect(fake.calls).toEqual(['a', 'a', 'v'])
    for (let i = 1; i < 6; i++) await session.addFrame(i)
    await session.finish()
    const added = fake.sounds[0].added
    // contiguous samples of at most a second, planar channels kept apart
    expect(added.map(([t]) => t)).toEqual([0, 1, 1.5, 2, 2.5])
    expect(added.map(([, n]) => n)).toEqual([10, 5, 5, 5, 5])
    expect(added[1][2]).toEqual([Math.fround(0.01), Math.fround(1.01)])
    expect(fake.sounds[0].closed).toBe(true)
  })

  it('encodes a silent film when no audio codec is available', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, audio: soundtrack(1) }, supporting('avc'), supporting() as never)
    expect(session.audioCodec).toBeNull()
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 0 })
    await session.addFrame(0)
    await session.finish()
    expect(fake.sounds).toHaveLength(0)
  })

  it('has no audio track without music', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'), supporting('aac') as never)
    expect(session.audioCodec).toBeNull()
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 0 })
  })
})
