/**
 * Video encoder — WebCodecs through mediabunny, writing the file in memory or, given a destination, straight to disk.
 * Codec choice (H.264, else HEVC, else VP9, else VP8: first one the browser can encode at the requested size, rate and
 * bitrate, on the GPU's encoder when it takes it; or the codec chosen in « Encodage »), soundtrack and disk layout:
 * ARCHITECTURE.md "Video export".
 *
 * On disk the MP4 has no fast start (`moov` after the frames, header size patched at the end): a plain MP4 every player
 * and editor reads, where a fragmented one is less widely supported.
 * Transparent film (`transparent`): WebM / VP9 whose alpha mediabunny encodes as a second VP9 stream beside each frame
 * (`BlockAdditional`), so the browser only needs a plain VP9 encoder: that is what `pickCodec` checks.
 */
import { deviceBudget, type DeviceBudget } from '../core/deviceBudget'
import type { MixedAudio } from '../film/audio'
import { getPlatform, type WritableFile } from '../platform'
import type { AudioCodec, StreamTargetChunk, VideoCodec, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { VideoCodecChoice, VideoEncoding, VideoQuality } from './schedule'
import { t } from '../i18n'

/** The muxer (mediabunny, ~700 KB) is loaded on the first export or codec check, not at startup. */
const mediabunny = () => import('mediabunny')

export type VideoContainer = 'mp4' | 'webm'

export interface CodecCandidate {
  container: VideoContainer
  codec: VideoCodec
  /** the browser takes it on the hardware encoder (`hardwareAcceleration: 'prefer-hardware'`) */
  hardware?: boolean
}

/** Preference order: H.264 first for compatibility, VP8 last (largest files). */
export const CODEC_CANDIDATES: readonly CodecCandidate[] = [
  { container: 'mp4', codec: 'avc' },
  { container: 'mp4', codec: 'hevc' },
  { container: 'webm', codec: 'vp9' },
  { container: 'webm', codec: 'vp8' },
]

/** AV1 in MP4: the smallest files at a given quality, offered only when « Encodage » asks for it (software encoders are slow). */
export const AV1_CANDIDATE: CodecCandidate = { container: 'mp4', codec: 'av1' }

/** Only candidate of a transparent film: VP9 with alpha in WebM, read by the editors that take transparent video. */
export const ALPHA_CANDIDATES: readonly CodecCandidate[] = [{ container: 'webm', codec: 'vp9' }]

/**
 * H.264 bits per pixel and per frame at `REFERENCE_FPS` for each quality: a sharp orthophoto flyover needs about 14 Mbit/s
 * at 1080p24 (« élevée »); at 5 Mbit/s the steep slopes turn to blocky grain.
 */
export const QUALITY_BITS_PER_PIXEL: Record<VideoQuality, number> = { standard: 0.16, high: 0.28, max: 0.44 }
export const REFERENCE_FPS = 24
/** The bitrate grows with the frame rate to this power: a frame costs less when frames are closer in time. */
const FPS_BITRATE_EXPONENT = 0.7
/** Bitrate relative to H.264 for the same visual quality. */
export const CODEC_BITRATE_FACTOR: Partial<Record<VideoCodec, number>> = { avc: 1, hevc: 0.6, vp9: 0.65, av1: 0.5, vp8: 1.2 }
export const MIN_BITRATE = 1_000_000
export const MAX_BITRATE = 80_000_000
/** Seconds between key frames, unless « Encodage » sets them. */
export const KEY_FRAME_INTERVAL_S = 2

/** Size of the writes to disk (also what one desktop IPC call carries). */
export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024

/** Audio codecs tried for each container, in order. */
export const AUDIO_CANDIDATES: Record<VideoContainer, readonly AudioCodec[]> = { mp4: ['aac', 'opus'], webm: ['opus'] }
/** Bitrate of the soundtrack, unless « Encodage » sets it. */
export const AUDIO_BITRATE = 192_000
/** Seconds of sound handed to the muxer ahead of the frame being encoded. */
export const AUDIO_LEAD_S = 1

export const VIDEO_MIME_TYPES: Record<VideoContainer, string> = { mp4: 'video/mp4', webm: 'video/webm' }

/** Bitrate ceiling of this device: its budget's where the film stays in memory (no direct disk write), none otherwise. */
export function deviceBitrateCap(
  budget: Pick<DeviceBudget, 'maxVideoBitrate'> = deviceBudget(),
  streamsToDisk = getPlatform().capabilities.canStreamToDisk,
): number {
  return streamsToDisk ? Infinity : budget.maxVideoBitrate
}

/** Target bitrate (bits / s) for a codec at a size, frame rate and quality, at most `maxBitrate` (this device's cap). */
export function videoBitrate(
  width: number,
  height: number,
  fps: number,
  quality: VideoQuality,
  codec: VideoCodec,
  maxBitrate = deviceBitrateCap(),
): number {
  const rate = REFERENCE_FPS * (fps / REFERENCE_FPS) ** FPS_BITRATE_EXPONENT
  const raw = width * height * rate * QUALITY_BITS_PER_PIXEL[quality] * (CODEC_BITRATE_FACTOR[codec] ?? 1)
  return Math.round(Math.min(maxBitrate, MAX_BITRATE, Math.max(MIN_BITRATE, raw)))
}

/**
 * Target bitrate of a film: the one chosen by hand in « Encodage » (`encoding.bitrateMbps`, the same for every codec),
 * else the quality's (`videoBitrate`); within MIN_BITRATE…MAX_BITRATE and this device's cap either way.
 */
export function targetBitrate(
  options: Pick<VideoEncodeOptions, 'width' | 'height' | 'fps' | 'quality' | 'encoding'>,
  codec: VideoCodec,
  maxBitrate = deviceBitrateCap(),
): number {
  const manual = options.encoding?.bitrateMbps
  if (manual === null || manual === undefined) return videoBitrate(options.width, options.height, options.fps, options.quality, codec, maxBitrate)
  return Math.round(Math.min(maxBitrate, MAX_BITRATE, Math.max(MIN_BITRATE, manual * 1e6)))
}

export interface VideoEncodeOptions {
  width: number
  height: number
  fps: number
  quality: VideoQuality
  /** « Encodage »: bitrate by hand, codec, key frames, sound bitrate (absent: from the quality, automatic) */
  encoding?: VideoEncoding
  /** write the film to this file while encoding instead of keeping it in memory */
  destination?: WritableFile
  /** soundtrack from the first frame (none: a silent film) */
  audio?: MixedAudio | null
  /** keep the transparency of the canvas (WebM / VP9, `ALPHA_CANDIDATES`) */
  transparent?: boolean
}

export type CanEncode = typeof canEncodeVideo
export type CanEncodeAudio = typeof canEncodeAudio

/** First audio codec of `container` the browser can encode for this soundtrack, or null. */
export async function pickAudioCodec(
  container: VideoContainer,
  audio: Pick<MixedAudio, 'sampleRate' | 'channels'>,
  canEncode?: CanEncodeAudio,
  bitrate = AUDIO_BITRATE,
): Promise<AudioCodec | null> {
  const { Quality, canEncodeAudio } = await mediabunny()
  canEncode ??= canEncodeAudio
  for (const codec of AUDIO_CANDIDATES[container]) {
    try {
      const options = { numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate, quality: new Quality({ bitrate }) }
      if (await canEncode(codec, options)) return codec
    } catch {
      // not this one
    }
  }
  return null
}

/**
 * First candidate the browser can encode with these options, or null: on the hardware encoder when it takes this
 * configuration (`hardware: true`), else on whichever encoder it picks.
 */
export async function pickCodec(
  options: VideoEncodeOptions,
  canEncode?: CanEncode,
  candidates: readonly CodecCandidate[] = CODEC_CANDIDATES,
): Promise<CodecCandidate | null> {
  const { Quality, canEncodeVideo } = await mediabunny()
  canEncode ??= canEncodeVideo
  const { width, height, fps } = options
  for (const { container, codec } of candidates) {
    const config = { width, height, frameRate: fps, quality: new Quality({ bitrate: targetBitrate(options, codec) }) }
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      try {
        if (await canEncode(codec, { ...config, hardwareAcceleration })) {
          return hardwareAcceleration === 'prefer-hardware' ? { container, codec, hardware: true } : { container, codec }
        }
      } catch {
        // an invalid configuration for this codec: try the next one
      }
    }
  }
  return null
}

/**
 * Candidates of an export: the codec chosen in « Encodage »; else those matching the extension of the chosen file (the
 * user may have typed `.webm`), all of them otherwise.
 */
export function candidatesFor(fileName: string | undefined, choice: VideoCodecChoice = 'auto'): readonly CodecCandidate[] {
  if (choice !== 'auto') return [...CODEC_CANDIDATES, AV1_CANDIDATE].filter((c) => c.codec === choice)
  const ext = fileName?.match(/\.([^.]+)$/)?.[1].toLowerCase()
  const matching = CODEC_CANDIDATES.filter((c) => c.container === ext)
  return matching.length > 0 ? matching : CODEC_CANDIDATES
}

/** Names of the codecs of « Encodage » (export panel, messages). */
export const CODEC_NAMES: Record<VideoCodecChoice, string> = { get auto() { return t('export.panel.codec.auto') }, avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' }

/** Thrown by a session used after `cancel()`. */
export class ExportCanceledError extends Error {
  constructor() {
    super(t('export.encoder.canceled'))
    this.name = 'ExportCanceledError'
  }
}

/** What a session says of its codec: a container and a codec by name (a PNG sequence has its own). */
export interface SessionCodec {
  container: string
  codec: string
  hardware?: boolean
}

export interface VideoEncodeSession {
  readonly codec: SessionCodec
  /** codec of the soundtrack; null when none was given or none can be encoded (the film is silent) */
  readonly audioCodec: AudioCodec | null
  readonly bitrate: number
  readonly mimeType: string
  /** '.mp4' or '.webm' */
  readonly extension: string
  /** the frames can be read from any canvas or bitmap, not only the canvas of the session (WebCodecs): see `handover.ts` */
  readonly acceptsSource?: true
  /**
   * Encode the current content of the canvas (or of `source`, where accepted) as frame `index` (timestamp index / fps);
   * respects backpressure. The frame is taken before anything is awaited: `source` may be closed once the call returned.
   */
  addFrame(index: number, source?: CanvasImageSource): Promise<void>
  /** Finalize the file: the blob in memory, null when it was written to the destination. */
  finish(): Promise<{ blob: Blob | null; sizeBytes: number }>
  /** Abort the encoding and drop what was written (a destination file is removed); later calls reject with ExportCanceledError. */
  cancel(): Promise<void>
  /** frames handed to the encoder and not yet out as packets, and its `encodeQueueSize` when readable (diagnostic) */
  counters?(): { inFlight: number; queue?: number }
}

/** Stream of mediabunny's disk target writing to `file` (chunks at their position). */
function diskStream(file: WritableFile, isCanceled: () => boolean, written: (end: number) => void): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    async write({ data, position }) {
      await file.write(data, position)
      written(position + data.length)
    },
    // mediabunny also closes its writer when canceled: a canceled film is removed, not kept
    close: () => (isCanceled() ? file.discard() : file.close()),
    abort: () => file.discard(),
  })
}

interface MemoryPart {
  start: number
  blob: Blob
}

/** What is left of `part` outside the bytes `from`…`to` that a later write replaces. */
function outside({ start, blob }: MemoryPart, from: number, to: number): MemoryPart[] {
  const end = start + blob.size
  if (end <= from || start >= to) return [{ start, blob }]
  const kept: MemoryPart[] = []
  if (start < from) kept.push({ start, blob: blob.slice(0, from - start) })
  if (end > to) kept.push({ start: to, blob: blob.slice(to - start) })
  return kept
}

/**
 * The film kept in memory: each chunk of mediabunny's target becomes a Blob part as soon as it arrives (the muxer's 4 MB
 * buffer is released at once), and the film is the Blob of those parts: the bytes are never concatenated into one buffer.
 * Later writes over bytes already written (sizes patched at the end) replace them.
 */
function memoryStream() {
  let parts: MemoryPart[] = []
  let size = 0
  const stream = new WritableStream<StreamTargetChunk>({
    write({ data, position }) {
      const end = position + data.length
      if (position < size) parts = parts.flatMap((part) => outside(part, position, end))
      else if (position > size) parts.push({ start: size, blob: new Blob([new Uint8Array(position - size)]) })
      parts.push({ start: position, blob: new Blob([data]) })
      size = Math.max(size, end)
    },
  })
  return {
    stream,
    size: () => size,
    /** The film as a Blob, null when nothing was written; the parts are dropped (the Blob holds the bytes). */
    take(type: string): Blob | null {
      const blob = size > 0 ? new Blob(parts.sort((a, b) => a.start - b.start).map((part) => part.blob), { type }) : null
      parts = []
      return blob
    },
  }
}

/**
 * Start an encoding session reading its frames from `canvas` (which must keep the size of the video).
 * Rejects when no codec is available.
 */
export async function createVideoEncoder(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: VideoEncodeOptions,
  canEncode?: CanEncode,
  canEncodeSound?: CanEncodeAudio,
): Promise<VideoEncodeSession> {
  const { AudioSample, AudioSampleSource, Mp4OutputFormat, Output, Quality, StreamTarget, VideoSample, VideoSampleSource, WebMOutputFormat } =
    await mediabunny()
  const { destination, transparent = false, encoding } = options
  const choice = transparent ? 'auto' : (encoding?.codec ?? 'auto')
  const codec = await pickCodec(options, canEncode, transparent ? ALPHA_CANDIDATES : candidatesFor(destination?.fileName, choice))
  if (!codec && choice !== 'auto') {
    throw new Error(t('export.encoder.noCodecChosen', { codec: CODEC_NAMES[choice] }))
  }
  if (!codec) throw new Error(t('export.encoder.noCodec'))

  const bitrate = targetBitrate(options, codec.codec)
  const audioBitrate = encoding ? encoding.audioKbps * 1000 : AUDIO_BITRATE
  let canceled = false
  let sizeBytes = 0
  const memory = destination ? null : memoryStream()
  const stream = destination ? diskStream(destination, () => canceled, (end) => (sizeBytes = Math.max(sizeBytes, end))) : memory!.stream
  const target = new StreamTarget(stream, { chunked: true, chunkSize: STREAM_CHUNK_BYTES })
  const output = new Output({
    // in memory the index goes at the start (mediabunny's default for a buffer target), on disk after the frames
    format: codec.container === 'mp4' ? new Mp4OutputFormat({ fastStart: destination ? false : 'in-memory' }) : new WebMOutputFormat(),
    target,
  })
  // frames handed to the VideoEncoder and packets out of it (the export's breadcrumb)
  let given = 0
  let received = 0
  // the frames are taken from the canvas by `addFrame` (as mediabunny's CanvasSource does), before anything is awaited
  const source = new VideoSampleSource({
    codec: codec.codec,
    quality: new Quality({ bitrate }),
    keyFrameInterval: encoding?.keyframeIntervalS ?? KEY_FRAME_INTERVAL_S,
    hardwareAcceleration: codec.hardware ? 'prefer-hardware' : 'no-preference',
    alpha: transparent ? 'keep' : 'discard',
    onEncodedSample: () => void given++,
    onEncodedPacket: () => void received++,
  })
  // mediabunny's encoder wrapper is not public API: no queue figure when it changes
  const wrapper = (source as unknown as { _encoder?: { getQueueSize?: () => unknown } })._encoder
  const queue = () => {
    const size = typeof wrapper?.getQueueSize === 'function' ? wrapper.getQueueSize() : undefined
    return typeof size === 'number' ? size : undefined
  }
  output.addVideoTrack(source, { frameRate: options.fps, canBeTransparent: transparent })
  const { audio } = options
  const audioCodec = audio && audio.channels.length > 0 ? await pickAudioCodec(codec.container, audio, canEncodeSound, audioBitrate) : null
  const sound = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: audioBitrate }) }) : null
  if (sound) output.addAudioTrack(sound)
  await output.start()

  const frameDuration = 1 / options.fps
  const mimeType = VIDEO_MIME_TYPES[codec.container]

  /** samples of the soundtrack already handed to the muxer */
  let sent = 0
  /** hand the soundtrack over up to `untilS` seconds, at most a second per sample */
  const addAudio = async (untilS: number) => {
    if (!sound || !audio) return
    const { sampleRate, channels } = audio
    const until = Math.min(channels[0].length, Math.ceil(untilS * sampleRate))
    while (sent < until) {
      const n = Math.min(until - sent, sampleRate)
      const data = new Float32Array(n * channels.length)
      channels.forEach((channel, c) => data.set(channel.subarray(sent, sent + n), c * n))
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels.length, sampleRate, timestamp: sent / sampleRate })
      try {
        await sound.add(sample)
      } finally {
        sample.close()
      }
      sent += n
    }
  }

  return {
    codec,
    audioCodec,
    bitrate,
    mimeType,
    extension: `.${codec.container}`,
    acceptsSource: true,
    async addFrame(index, from = canvas) {
      if (canceled) throw new ExportCanceledError()
      // the canvas is read now, synchronously: the caller may draw the next frame while this one is encoded
      const sample = new VideoSample(from, { timestamp: index * frameDuration, duration: frameDuration })
      try {
        await addAudio((index + 1) * frameDuration + AUDIO_LEAD_S)
        await source.add(sample)
      } finally {
        sample.close()
      }
    },
    async finish() {
      if (canceled) throw new ExportCanceledError()
      await addAudio(Infinity)
      sound?.close()
      source.close()
      await output.finalize()
      if (!memory) return { blob: null, sizeBytes }
      const blob = memory.take(mimeType)
      if (!blob) throw new Error(t('export.encoder.empty'))
      return { blob, sizeBytes: blob.size }
    },
    async cancel() {
      if (canceled) return
      canceled = true
      try {
        if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
      } finally {
        // also after a failed write (the stream is errored, mediabunny cannot close it)
        await destination?.discard()
      }
    },
    counters: () => ({ inFlight: given - received, queue: queue() }),
  }
}
