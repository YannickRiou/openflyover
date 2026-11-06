/**
 * Resumable export, pure part: what is kept of a film being encoded, and when it may be taken up again. The encoded
 * packets are stored one GOP (a key frame and the frames that follow it) per chunk, with a small manifest; the rule of
 * the resume point, the fingerprint that ties a stored export to its project, and the cleanup decision live here, with
 * no browser API. The storage (`storage.ts`), the recorder (`recorder.ts`) and the dialog are built on it.
 * See ARCHITECTURE.md « Resumable export ».
 */

/** A stored export older than this is deleted, whatever its project. */
export const RESUME_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
export const MANIFEST_VERSION = 1

/** One encoded frame, as it comes out of the encoder. */
export interface StoredPacket {
  key: boolean
  /** presentation time, seconds */
  timestamp: number
  duration: number
  data: Uint8Array
}

/** What the muxer needs to describe the track, kept with the first packets (`description` in base64). */
export interface StoredConfig {
  codec: string
  codedWidth?: number
  codedHeight?: number
  description?: string
  colorSpace?: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }
}

export interface ResumeManifest {
  version: number
  /** fingerprint of the project and its settings (`fingerprint`) */
  key: string
  width: number
  height: number
  fps: number
  /** frames of the whole film */
  frameCount: number
  /** file name of the film, for the dialog */
  name: string
  container: string
  codec: string
  config: StoredConfig | null
  /** frames whose packets are stored: the next one to render. Always at the start of a GOP. */
  frames: number
  /** chunk files written (0 to chunks - 1) and their bytes */
  chunks: number
  bytes: number
  createdAt: number
  updatedAt: number
}

/** What an export that wants to resume must match. */
export interface ResumeExpectation {
  key: string
  width: number
  height: number
  fps: number
  frameCount: number
}

/** Hash of a text (cyrb53: two 32-bit mixes, 53 bits), in hexadecimal. Not cryptographic: it tells two projects apart. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The manifest as stored, or null when it is not one this version reads (another version, damaged). */
export function parseManifest(raw: unknown): ResumeManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<ResumeManifest>
  const ok =
    m.version === MANIFEST_VERSION &&
    typeof m.key === 'string' &&
    typeof m.name === 'string' &&
    typeof m.container === 'string' &&
    typeof m.codec === 'string' &&
    [m.width, m.height, m.fps, m.frameCount, m.frames, m.chunks, m.bytes, m.createdAt, m.updatedAt].every(isNumber) &&
    (m.config === null || (typeof m.config === 'object' && typeof m.config?.codec === 'string'))
  return ok ? (m as ResumeManifest) : null
}

/** True when the stored export is too old to be offered. */
export function isStale(manifest: Pick<ResumeManifest, 'updatedAt'>, now: number): boolean {
  return now - manifest.updatedAt > RESUME_MAX_AGE_MS || manifest.updatedAt > now + RESUME_MAX_AGE_MS
}

/**
 * The frame to resume from (the first one to render), or null when this export cannot take the stored one up: another
 * project or setting, a size or length that changed, nothing stored yet, everything stored already, or too old.
 */
export function resumePoint(manifest: ResumeManifest | null, expected: ResumeExpectation, now: number): number | null {
  if (!manifest || isStale(manifest, now) || manifest.config === null) return null
  const same =
    manifest.key === expected.key &&
    manifest.width === expected.width &&
    manifest.height === expected.height &&
    manifest.fps === expected.fps &&
    manifest.frameCount === expected.frameCount
  if (!same || manifest.frames <= 0 || manifest.frames >= manifest.frameCount || manifest.chunks <= 0) return null
  return manifest.frames
}

/** What to do with what is stored when the app starts: `delete` when it is too old or damaged. */
export function cleanupDecision(manifest: ResumeManifest | null, now: number): 'keep' | 'delete' | 'none' {
  if (!manifest) return 'none'
  return isStale(manifest, now) || manifest.config === null || manifest.frames <= 0 ? 'delete' : 'keep'
}

/** Share of the film kept, 0 to 1. */
export const keptShare = (manifest: Pick<ResumeManifest, 'frames' | 'frameCount'>): number =>
  manifest.frameCount > 0 ? Math.min(1, manifest.frames / manifest.frameCount) : 0

// ---------------------------------------------------------------------------
// Chunks: [count u32] then per packet [key u8, timestamp f64, duration f64, size u32], then the data of each
// ---------------------------------------------------------------------------

const PACKET_HEADER_BYTES = 21

export function encodeChunk(packets: readonly StoredPacket[]): Uint8Array {
  const head = 4 + packets.length * PACKET_HEADER_BYTES
  const out = new Uint8Array(head + packets.reduce((sum, p) => sum + p.data.length, 0))
  const view = new DataView(out.buffer)
  view.setUint32(0, packets.length, true)
  let at = head
  packets.forEach((p, i) => {
    const h = 4 + i * PACKET_HEADER_BYTES
    view.setUint8(h, p.key ? 1 : 0)
    view.setFloat64(h + 1, p.timestamp, true)
    view.setFloat64(h + 9, p.duration, true)
    view.setUint32(h + 17, p.data.length, true)
    out.set(p.data, at)
    at += p.data.length
  })
  return out
}

/** The packets of a chunk, or null when it is cut short or damaged. */
export function decodeChunk(bytes: Uint8Array): StoredPacket[] | null {
  if (bytes.length < 4) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(0, true)
  const head = 4 + count * PACKET_HEADER_BYTES
  if (head > bytes.length) return null
  const packets: StoredPacket[] = []
  let at = head
  for (let i = 0; i < count; i++) {
    const h = 4 + i * PACKET_HEADER_BYTES
    const size = view.getUint32(h + 17, true)
    if (at + size > bytes.length) return null
    packets.push({
      key: view.getUint8(h) === 1,
      timestamp: view.getFloat64(h + 1, true),
      duration: view.getFloat64(h + 9, true),
      data: bytes.subarray(at, at + size),
    })
    at += size
  }
  return at === bytes.length ? packets : null
}

// ---------------------------------------------------------------------------
// Decoder configuration
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

/** The decoder configuration of the encoder's first packet, in a form JSON keeps. */
export function storeConfig(config: {
  codec: string
  codedWidth?: number
  codedHeight?: number
  description?: AllowSharedBufferSource
  colorSpace?: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }
}): StoredConfig {
  const d = config.description
  const description = d ? toBase64(ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d)) : undefined
  const { colorSpace } = config
  return {
    codec: config.codec,
    ...(config.codedWidth !== undefined && { codedWidth: config.codedWidth }),
    ...(config.codedHeight !== undefined && { codedHeight: config.codedHeight }),
    ...(description !== undefined && { description }),
    ...(colorSpace && { colorSpace: { primaries: colorSpace.primaries, transfer: colorSpace.transfer, matrix: colorSpace.matrix, fullRange: colorSpace.fullRange } }),
  }
}

/** Back to what the muxer takes (`description` as bytes). */
export function loadConfig(stored: StoredConfig): {
  codec: string
  codedWidth?: number
  codedHeight?: number
  description?: Uint8Array
  colorSpace?: StoredConfig['colorSpace']
} {
  const { description, ...rest } = stored
  return { ...rest, ...(description !== undefined && { description: fromBase64(description) }) }
}

/** Frame number of a packet at `fps`. */
export const frameOf = (packet: Pick<StoredPacket, 'timestamp'>, fps: number): number => Math.round(packet.timestamp * fps)

/**
 * What the video encoder takes to keep its packets and to continue a stored export (`createVideoEncoder`). Built by
 * `encoderHooks` (hooks.ts) from what the recorder and the stored export give: the encoder itself only calls them.
 */
export interface ResumeHooks {
  /** keeps each packet out of the encoder of `source`, and hands the packets of a stored export to the muxer before any new one */
  attach(source: import('mediabunny').VideoSampleSource): Promise<void>
}

/** JSON with the keys sorted and `undefined` dropped: the same value gives the same text, whatever the order it was built in. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/** A track in a few numbers that survive saving and reopening (the project file rounds the coordinates, and gives new ids). */
export function trackDigest(track: { name: string; segments: { points: { lon: number; lat: number }[] }[] }): unknown {
  const round = (n: number) => Math.round(n * 1e4) / 1e4
  let lon = 0
  let lat = 0
  for (const s of track.segments) {
    for (const p of s.points) {
      lon += p.lon
      lat += p.lat
    }
  }
  return [track.name, track.segments.map((s) => s.points.length), round(lon), round(lat)]
}
