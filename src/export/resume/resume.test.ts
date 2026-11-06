import { describe, expect, it } from 'vitest'
import {
  MANIFEST_VERSION,
  RESUME_MAX_AGE_MS,
  cleanupDecision,
  decodeChunk,
  encodeChunk,
  fingerprint,
  keptShare,
  loadConfig,
  parseManifest,
  resumePoint,
  storeConfig,
  type ResumeManifest,
  type StoredPacket,
} from './resume'

const NOW = 1_000_000_000_000
const manifest = (over: Partial<ResumeManifest> = {}): ResumeManifest => ({
  version: MANIFEST_VERSION,
  key: 'abc',
  width: 1080,
  height: 1920,
  fps: 24,
  frameCount: 1440,
  name: 'Film',
  container: 'mp4',
  codec: 'avc',
  config: { codec: 'avc1.42001f' },
  frames: 480,
  chunks: 10,
  bytes: 1000,
  createdAt: NOW - 1000,
  updatedAt: NOW - 500,
  ...over,
})
const job = { key: 'abc', width: 1080, height: 1920, fps: 24, frameCount: 1440 }

describe('fingerprint', () => {
  it('tells texts apart and is stable', () => {
    expect(fingerprint('a project')).toBe(fingerprint('a project'))
    expect(fingerprint('a project')).not.toBe(fingerprint('a project '))
    expect(fingerprint('')).toMatch(/^[0-9a-f]{14}$/)
  })
})

describe('resumePoint', () => {
  it('resumes at the first frame not stored', () => {
    expect(resumePoint(manifest(), job, NOW)).toBe(480)
  })
  it('refuses another project, size, rate or length', () => {
    for (const other of [{ key: 'x' }, { width: 720 }, { height: 1080 }, { fps: 30 }, { frameCount: 1441 }]) {
      expect(resumePoint(manifest(), { ...job, ...other }, NOW)).toBeNull()
    }
  })
  it('refuses nothing stored, everything stored, a missing configuration and a stale export', () => {
    expect(resumePoint(null, job, NOW)).toBeNull()
    expect(resumePoint(manifest({ frames: 0 }), job, NOW)).toBeNull()
    expect(resumePoint(manifest({ chunks: 0 }), job, NOW)).toBeNull()
    expect(resumePoint(manifest({ frames: 1440 }), job, NOW)).toBeNull()
    expect(resumePoint(manifest({ config: null }), job, NOW)).toBeNull()
    expect(resumePoint(manifest({ updatedAt: NOW - RESUME_MAX_AGE_MS - 1 }), job, NOW)).toBeNull()
  })
})

describe('cleanupDecision', () => {
  it('keeps a recent export, deletes an old or empty one', () => {
    expect(cleanupDecision(null, NOW)).toBe('none')
    expect(cleanupDecision(manifest(), NOW)).toBe('keep')
    expect(cleanupDecision(manifest({ updatedAt: NOW - RESUME_MAX_AGE_MS - 1 }), NOW)).toBe('delete')
    expect(cleanupDecision(manifest({ frames: 0 }), NOW)).toBe('delete')
    expect(cleanupDecision(manifest({ config: null }), NOW)).toBe('delete')
  })
  it('shares the film kept', () => {
    expect(keptShare(manifest())).toBeCloseTo(1 / 3)
  })
})

describe('parseManifest', () => {
  it('reads a manifest and refuses another version or damage', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(manifest())))).toEqual(manifest())
    expect(parseManifest({ ...manifest(), version: 99 })).toBeNull()
    expect(parseManifest({ ...manifest(), frames: 'x' })).toBeNull()
    expect(parseManifest(null)).toBeNull()
  })
})

describe('chunks', () => {
  const packets: StoredPacket[] = [
    { key: true, timestamp: 0, duration: 1 / 24, data: new Uint8Array([1, 2, 3]) },
    { key: false, timestamp: 1 / 24, duration: 1 / 24, data: new Uint8Array([]) },
    { key: false, timestamp: 2 / 24, duration: 1 / 24, data: new Uint8Array([9]) },
  ]
  it('round-trips', () => {
    expect(decodeChunk(encodeChunk(packets))).toEqual(packets)
  })
  it('refuses a chunk cut short', () => {
    const bytes = encodeChunk(packets)
    expect(decodeChunk(bytes.subarray(0, bytes.length - 1))).toBeNull()
    expect(decodeChunk(new Uint8Array([1]))).toBeNull()
  })
})

describe('decoder configuration', () => {
  it('keeps the description bytes through JSON', () => {
    const stored = storeConfig({ codec: 'avc1', codedWidth: 8, codedHeight: 8, description: new Uint8Array([1, 2, 255]) })
    const back = loadConfig(JSON.parse(JSON.stringify(stored)))
    expect(back.codec).toBe('avc1')
    expect([...back.description!]).toEqual([1, 2, 255])
  })
})
