/**
 * Video export formats and frame schedule.
 *
 * The flyover is a pure function of `playback.progress` and its film time, so a film is fully described by the
 * list of film times of its frames and the progress values they map to: a ramp 0 → 1 over the film duration
 * (linear, or following the variable pacing of the flyover), optionally preceded and followed by frames held on
 * the first / last image.
 */
import { deviceBudget } from '../core/deviceBudget'
import { isRecord } from '../core/guards'
import { DEFAULT_LOUDNESS_LUFS, LOUDNESS_TARGETS_LUFS } from '../film/loudness'
import { t } from '../i18n'

/**
 * Film aspect ratios (`x:y` = width:height). The size is the aspect × a resolution class defined by the short
 * side, so a vertical 4K film is 2160 × 3840 and a square 1440p film 1440 × 1440.
 */
export const VIDEO_ASPECTS = [
  { id: '16:9', get label() { return t('video.aspect.16:9') }, x: 16, y: 9 },
  { id: '9:16', get label() { return t('video.aspect.9:16') }, x: 9, y: 16 },
  { id: '1:1', get label() { return t('video.aspect.1:1') }, x: 1, y: 1 },
  { id: '4:5', get label() { return t('video.aspect.4:5') }, x: 4, y: 5 },
  { id: '21:9', get label() { return t('video.aspect.21:9') }, x: 21, y: 9 },
] as const satisfies readonly { id: string; label: string; x: number; y: number }[]

export type VideoAspect = (typeof VIDEO_ASPECTS)[number]['id']

/** Resolution classes, named after the short side of the frame. */
export const VIDEO_RESOLUTIONS = [
  { id: '720p', label: '720p', shortSide: 720 },
  { id: '1080p', label: '1080p', shortSide: 1080 },
  { id: '1440p', label: '1440p', shortSide: 1440 },
  { id: '4k', label: '4K', shortSide: 2160 },
] as const satisfies readonly { id: string; label: string; shortSide: number }[]

export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]['id']

export const VIDEO_FPS = [24, 30, 60] as const
export type VideoFps = (typeof VIDEO_FPS)[number]

/** Export quality: the render tier (qualityTier.ts) and, unless it is set by hand, the bitrate (`videoBitrate`). */
export const VIDEO_QUALITIES = ['standard', 'high', 'max'] as const
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]

/** Codecs of « Encodage »: 'auto' takes the first one the device encodes (H.264, HEVC, VP9, VP8). */
export const VIDEO_CODEC_CHOICES = ['auto', 'avc', 'hevc', 'vp9'] as const
export type VideoCodecChoice = (typeof VIDEO_CODEC_CHOICES)[number]
/** Bitrate chosen by hand, Mbit/s (the encoder's bounds, `MIN_BITRATE` / `MAX_BITRATE`). */
/**
 * Formats of the platforms people publish to, one click in « Format »: the proportions, the size, the frame rate, H.264
 * (what they all take) and a bitrate of the order they recommend. They set these fields and nothing else.
 */
export const PLATFORM_PRESETS = [
  { id: 'youtube-4k', get label() { return t('video.platform.youtube-4k') }, video: { aspect: '16:9', resolution: '4k', fps: 30, codec: 'avc', manualBitrate: true, bitrateMbps: 40 } },
  { id: 'youtube', get label() { return t('video.platform.youtube') }, video: { aspect: '16:9', resolution: '1080p', fps: 30, codec: 'avc', manualBitrate: true, bitrateMbps: 12 } },
  { id: 'vertical', get label() { return t('video.platform.vertical') }, video: { aspect: '9:16', resolution: '1080p', fps: 30, codec: 'avc', manualBitrate: true, bitrateMbps: 10 } },
  { id: 'feed', get label() { return t('video.platform.feed') }, video: { aspect: '4:5', resolution: '1080p', fps: 30, codec: 'avc', manualBitrate: true, bitrateMbps: 8 } },
  { id: 'square', get label() { return t('video.platform.square') }, video: { aspect: '1:1', resolution: '1080p', fps: 30, codec: 'avc', manualBitrate: true, bitrateMbps: 8 } },
] as const satisfies readonly {
  id: string
  label: string
  video: Pick<VideoSettings, 'aspect' | 'resolution' | 'fps' | 'codec' | 'manualBitrate' | 'bitrateMbps'>
}[]

export type PlatformPresetId = (typeof PLATFORM_PRESETS)[number]['id']

/** The settings with the format of preset `id` (the quality, key frames, sound and name template stay). */
export function withPlatformPreset(video: VideoSettings, id: PlatformPresetId): VideoSettings {
  const preset = PLATFORM_PRESETS.find((p) => p.id === id)
  return preset ? { ...video, ...preset.video } : video
}

/** The preset whose fields the settings have exactly (a click on it would change nothing), if any. */
export function platformPresetOf(video: VideoSettings): PlatformPresetId | null {
  const found = PLATFORM_PRESETS.find((p) => (Object.keys(p.video) as (keyof typeof p.video)[]).every((key) => video[key] === p.video[key]))
  return found?.id ?? null
}

export const BITRATE_RANGE_MBPS = { min: 1, max: 80, step: 0.5 } as const
export const KEYFRAME_INTERVALS_S = [0.5, 1, 2, 5, 10] as const
export const AUDIO_BITRATES_KBPS = [96, 128, 192, 256, 320] as const

/** Film format and encoding of the project (stored in the settings). */
export interface VideoSettings {
  aspect: VideoAspect
  resolution: VideoResolution
  fps: VideoFps
  quality: VideoQuality
  /** the bitrate is `bitrateMbps`, chosen by hand, instead of the quality's */
  manualBitrate: boolean
  bitrateMbps: number
  codec: VideoCodecChoice
  /** seconds between key frames (seeking in an editor against file size) */
  keyframeIntervalS: number
  /** bitrate of the soundtrack, kbit/s */
  audioKbps: number
  /** name of the file from the template (`expandNameTemplate`); '' = the name of the track */
  nameTemplate: string
  /** the soundtrack brought to `loudnessLufs` (LUFS, one of `LOUDNESS_TARGETS_LUFS`) and kept under -1 dBTP (`film/loudness.ts`) */
  normalizeLoudness: boolean
  loudnessLufs: number
}

/** Encoding fields, also those an older project lacks: it encodes as it did (bitrate of the quality, first codec). */
const ENCODING_DEFAULTS = {
  manualBitrate: false,
  bitrateMbps: 14,
  codec: 'auto',
  keyframeIntervalS: 2,
  audioKbps: 192,
  nameTemplate: '',
  normalizeLoudness: false,
  loudnessLufs: DEFAULT_LOUDNESS_LUFS,
} as const satisfies Partial<VideoSettings>

/** A phone starts at 720p (44 % fewer pixels than 1080p); it can still choose up to its cap. */
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspect: '16:9',
  resolution: deviceBudget().kind === 'phone' ? '720p' : '1080p',
  fps: 30,
  quality: 'high',
  ...ENCODING_DEFAULTS,
}

/** What the encoder needs of the settings: the bitrate by hand (null: the quality's), codec, key frames, sound. */
export interface VideoEncoding {
  bitrateMbps: number | null
  codec: VideoCodecChoice
  keyframeIntervalS: number
  audioKbps: number
  /** the soundtrack's target loudness, LUFS; absent or null: as mixed */
  loudnessLufs?: number | null
}

export function videoEncoding(video: VideoSettings): VideoEncoding {
  return {
    bitrateMbps: video.manualBitrate ? video.bitrateMbps : null,
    codec: video.codec,
    keyframeIntervalS: video.keyframeIntervalS,
    audioKbps: video.audioKbps,
    loudnessLufs: video.normalizeLoudness ? video.loudnessLufs : null,
  }
}

export const DEFAULT_ENCODING: VideoEncoding = videoEncoding(DEFAULT_VIDEO_SETTINGS)

/**
 * Why a resolution class comes out smaller here (phones and tablets), null when it does not. To show next to the
 * resolution choice.
 */
export function exportResolutionNote(resolution: VideoResolution, maxShortSide = deviceBudget().maxExportShortSide): string | null {
  const shortSide = (VIDEO_RESOLUTIONS.find((r) => r.id === resolution) ?? VIDEO_RESOLUTIONS[1]).shortSide
  if (shortSide <= maxShortSide) return null
  const cap = VIDEO_RESOLUTIONS.find((r) => r.shortSide === maxShortSide)?.label ?? `${maxShortSide}p`
  return t('export.resolutionNote', { cap })
}

/** Viewport height the terrain LOD is evaluated at for a film `heightPx` tall: its own, except on a phone (fewer tiles in memory). */
export function exportLodHeight(heightPx: number, maxLodHeightPx = deviceBudget().maxLodHeightPx): number {
  return Math.min(heightPx, maxLodHeightPx)
}

/** Frames held on the first image (lets the viewer settle) and on the last one (the arrival). */
export const EXPORT_HOLD_START_S = 1
export const EXPORT_HOLD_END_S = 2

/**
 * Frame size in pixels: the short side of the resolution class, the long side from the aspect ratio rounded
 * to an even number (H.264 / HEVC need even sizes). Every combination is exact today: 1920 × 1080,
 * 2160 × 3840, 1080 × 1350, 2520 × 1080…
 */
export function videoSize(
  aspect: VideoAspect,
  resolution: VideoResolution,
  maxShortSide = deviceBudget().maxExportShortSide,
): { width: number; height: number } {
  const a = VIDEO_ASPECTS.find((v) => v.id === aspect) ?? VIDEO_ASPECTS[0]
  // a phone or tablet renders at most 1080p / 1440p (GPU memory): the larger classes come out at that size
  const short = Math.min((VIDEO_RESOLUTIONS.find((r) => r.id === resolution) ?? VIDEO_RESOLUTIONS[1]).shortSide, maxShortSide)
  const long = 2 * Math.round((short * Math.max(a.x, a.y)) / Math.min(a.x, a.y) / 2)
  return a.x >= a.y ? { width: long, height: short } : { width: short, height: long }
}

/** Longest file name template kept. */
export const NAME_TEMPLATE_MAX = 120

/** The words a file name template can use: `{project}`, `{track}`, `{format}`, `{resolution}`, `{fps}`, `{date}`. */
export const NAME_TEMPLATE_VARIABLES = ['project', 'track', 'format', 'resolution', 'fps', 'date'] as const
export type NameTemplateVariable = (typeof NAME_TEMPLATE_VARIABLES)[number]

/**
 * `template` with its `{variables}` replaced (an unknown one is left as typed), the result trimmed; the caller makes it a
 * file name (`videoFileName` removes what a file system refuses). `fallback` when nothing is left.
 */
export function expandNameTemplate(template: string, vars: Readonly<Record<NameTemplateVariable, string>>, fallback: string): string {
  const name = template.replace(/\{([a-z]+)\}/g, (whole, key: string) => (key in vars ? vars[key as NameTemplateVariable] : whole)).trim()
  return name === '' ? fallback : name
}

export function isValidVideoSettings(video: VideoSettings): boolean {
  return (
    VIDEO_ASPECTS.some((a) => a.id === video.aspect) &&
    VIDEO_RESOLUTIONS.some((r) => r.id === video.resolution) &&
    (VIDEO_FPS as readonly number[]).includes(video.fps) &&
    (VIDEO_QUALITIES as readonly string[]).includes(video.quality) &&
    video.bitrateMbps >= BITRATE_RANGE_MBPS.min &&
    video.bitrateMbps <= BITRATE_RANGE_MBPS.max &&
    (VIDEO_CODEC_CHOICES as readonly string[]).includes(video.codec) &&
    (KEYFRAME_INTERVALS_S as readonly number[]).includes(video.keyframeIntervalS) &&
    (AUDIO_BITRATES_KBPS as readonly number[]).includes(video.audioKbps) &&
    typeof video.nameTemplate === 'string' &&
    video.nameTemplate.length <= NAME_TEMPLATE_MAX &&
    typeof video.normalizeLoudness === 'boolean' &&
    (LOUDNESS_TARGETS_LUFS as readonly number[]).includes(video.loudnessLufs)
  )
}

/** Fixed sizes of the first version of the settings (`video.format`), as aspect × resolution. */
const LEGACY_FORMATS: Record<string, Pick<VideoSettings, 'aspect' | 'resolution'>> = {
  '1920x1080': { aspect: '16:9', resolution: '1080p' },
  '3840x2160': { aspect: '16:9', resolution: '4k' },
  '1280x720': { aspect: '16:9', resolution: '720p' },
  '1080x1920': { aspect: '9:16', resolution: '1080p' },
  '1080x1080': { aspect: '1:1', resolution: '1080p' },
  '1080x1350': { aspect: '4:5', resolution: '1080p' },
}

/**
 * Upgrade of a saved `video` setting (project or preset) before validation: `{ format, fps, quality }`
 * becomes `{ aspect, resolution, fps, quality }` (an unknown format falls back to 16:9 1080p), and the encoding fields
 * it lacks take their defaults.
 */
export function withVideoDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  if (!('format' in raw)) return { ...ENCODING_DEFAULTS, ...raw }
  const { format, ...rest } = raw
  if ('aspect' in rest && 'resolution' in rest) return { ...ENCODING_DEFAULTS, ...rest }
  const legacy = (typeof format === 'string' && LEGACY_FORMATS[format]) || DEFAULT_VIDEO_SETTINGS
  return { ...ENCODING_DEFAULTS, ...rest, aspect: legacy.aspect, resolution: legacy.resolution }
}

export interface ScheduleOptions {
  /** duration of the flyover itself (progress 0 → 1), seconds */
  durationS: number
  /** progress at film time `tS` ∈ [0, durationS] (variable pacing); default linear `tS / durationS` */
  progressAt?: (tS: number) => number
  fps: number
  /** extra frames on progress 0 before the flyover starts, seconds */
  holdStartS?: number
  /** extra frames on progress 1 after the flyover ends, seconds */
  holdEndS?: number
}

/**
 * Film time of every frame of the film (seconds at ×1). The ramp has `round(durationS × fps)` frames (at least 2),
 * frame k is at `k / (ramp − 1) × durationS`, exactly 0 on its first frame and `durationS` on its last; holds add
 * `round(holdS × fps)` frames at 0 and `durationS`.
 */
export function buildFrameTimes({ durationS, fps, holdStartS = 0, holdEndS = 0 }: ScheduleOptions): number[] {
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`invalid frame rate: ${fps}`)
  if (!(durationS > 0) || !Number.isFinite(durationS)) throw new RangeError(`invalid duration: ${durationS}`)
  const ramp = Math.max(2, Math.round(durationS * fps))
  const before = Math.max(0, Math.round(holdStartS * fps))
  const after = Math.max(0, Math.round(holdEndS * fps))

  const frames = new Array<number>(before + ramp + after)
  let i = 0
  for (let k = 0; k < before; k++) frames[i++] = 0
  for (let k = 0; k < ramp; k++) frames[i++] = (k / (ramp - 1)) * durationS
  for (let k = 0; k < after; k++) frames[i++] = durationS
  return frames
}

/**
 * Progress value of every frame of the film (`buildFrameTimes`): `progressAt(time)`, exactly 0 at time 0 and 1 at
 * `durationS`.
 */
export function buildFrameSchedule(options: ScheduleOptions): number[] {
  const { durationS, progressAt } = options
  return buildFrameTimes(options).map((t) =>
    t <= 0 ? 0 : t >= durationS ? 1 : Math.min(1, Math.max(0, progressAt ? progressAt(t) : t / durationS)),
  )
}
