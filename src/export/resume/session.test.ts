import { describe, expect, it } from 'vitest'
import { memoryStorage } from './memoryStorage'
import { createRecorder } from './recorder'
import { frameOf, type StoredPacket } from './resume'
import { beginRun } from './session'
import { storedPackets } from './storage'

const FPS = 24
const GOP = 4
const job = { key: 'k', width: 100, height: 100, fps: FPS, frameCount: 20, name: 'Film' }
const config = { codec: 'avc1' }
const packet = (frame: number): StoredPacket => ({ key: frame % GOP === 0, timestamp: frame / FPS, duration: 1 / FPS, data: new Uint8Array([frame]) })
const feed = (push: (p: StoredPacket, c?: typeof config) => void, from: number, to: number) => {
  for (let f = from; f < to; f++) push(packet(f), f === 0 ? config : undefined)
}

describe('recorder', () => {
  it('writes a chunk per complete GOP, then the manifest that announces it', async () => {
    const storage = memoryStorage()
    const rec = createRecorder({ storage, job, now: () => 5 })
    rec.setCodec('mp4', 'avc')
    feed(rec.push, 0, 10)
    await rec.settle()
    // frames 8 and 9 are an unfinished GOP: not kept
    expect(storage.manifest).toMatchObject({ frames: 8, chunks: 2, container: 'mp4', codec: 'avc', config, updatedAt: 5 })
    expect(storage.chunks.size).toBe(2)
  })

  it('gives up and deletes what it kept when a write fails (quota)', async () => {
    const storage = memoryStorage()
    const rec = createRecorder({ storage, job })
    rec.setCodec('mp4', 'avc')
    feed(rec.push, 0, 5)
    await rec.settle()
    expect(storage.manifest?.frames).toBe(4)
    storage.failWrites = new Error('quota')
    feed(rec.push, 5, 9)
    await rec.settle()
    expect(rec.active).toBe(false)
    expect(storage.manifest).toBeNull()
    expect(storage.chunks.size).toBe(0)
  })

  it('gives up on packets that are not one per frame in order', async () => {
    const storage = memoryStorage()
    const rec = createRecorder({ storage, job })
    rec.setCodec('mp4', 'avc')
    rec.push(packet(0), config)
    rec.push(packet(2))
    expect(rec.active).toBe(false)
  })

  it('discard deletes everything', async () => {
    const storage = memoryStorage()
    const rec = createRecorder({ storage, job })
    rec.setCodec('mp4', 'avc')
    feed(rec.push, 0, 9)
    await rec.discard()
    expect(storage.manifest).toBeNull()
    expect(storage.chunks.size).toBe(0)
  })
})

describe('an export interrupted then resumed', () => {
  /** frames of the packets a muxer would receive: the stored ones, then the new ones */
  const muxed = async (run: Awaited<ReturnType<typeof beginRun>>, storage: ReturnType<typeof memoryStorage>) => {
    const out: number[] = []
    if (run.prior) for await (const p of run.prior()) out.push(frameOf(p, FPS))
    run.recorder.setCodec('mp4', 'avc')
    for (let f = run.startFrame; f < job.frameCount; f++) run.recorder.push(packet(f), f === 0 ? config : undefined)
    await run.recorder.settle()
    for (let f = run.startFrame; f < job.frameCount; f++) out.push(f)
    expect(storage).toBeDefined()
    return out
  }

  it('gives a film of the same frames as one made in one go', async () => {
    const storage = memoryStorage()
    const first = await beginRun(storage, job, false)
    first.recorder.setCodec('mp4', 'avc')
    // the tab dies after frame 13: 3 GOPs are kept, frames 12 and 13 are redone
    feed(first.recorder.push, 0, 14)
    await first.recorder.settle()
    expect(storage.manifest?.frames).toBe(12)

    const second = await beginRun(storage, job, true)
    expect(second.startFrame).toBe(12)
    const frames = await muxed(second, storage)
    expect(frames).toEqual(Array.from({ length: job.frameCount }, (_, i) => i))
    // the continued recording keeps the complete GOPs (the last one ends with the film)
    expect(storage.manifest?.frames).toBe(16)
  })

  it('starts over, and deletes what was stored, when asked not to resume or when the project changed', async () => {
    const storage = memoryStorage()
    const first = await beginRun(storage, job, false)
    first.recorder.setCodec('mp4', 'avc')
    feed(first.recorder.push, 0, 9)
    await first.recorder.settle()
    expect((await beginRun(storage, { ...job, key: 'other' }, true)).startFrame).toBe(0)
    expect(storage.manifest).toBeNull()
    const again = await beginRun(storage, job, true)
    expect(again.startFrame).toBe(0)
  })

  it('reads the stored packets back in order', async () => {
    const storage = memoryStorage()
    const run = await beginRun(storage, job, false)
    run.recorder.setCodec('mp4', 'avc')
    feed(run.recorder.push, 0, 9)
    await run.recorder.settle()
    const frames: number[] = []
    for await (const p of storedPackets(storage, storage.manifest!)) frames.push(frameOf(p, FPS))
    expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})
