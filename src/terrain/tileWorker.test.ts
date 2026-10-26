import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TileKey } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { tileCenter } from '../geo/mercator'
import { cleanDem } from './demClean'
import { decodeDemPixels } from './dem'
import { buildTileGeometry } from './mesh'
import { resultBuffers, runTileJob, type TileJob, type TileResult } from './tileJob'

const KEY: TileKey = { z: 12, x: 2126, y: 1457 }
const CENTER = tileCenter(KEY)
const SIZE = 64

/** Terrarium pixels of a ridge with a sea corner (some nodata, some spikes of the sea). */
function terrariumPixels(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const h = x < 10 && y < 10 ? -3 + ((x * y) % 5) : 1500 + 900 * Math.sin(x / 7) * Math.cos(y / 9)
      const v = Math.round((h + 32768) * 256)
      const p = (y * SIZE + x) * 4
      rgba.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, x === 40 && y === 40 ? 0 : 255], p)
    }
  }
  return rgba
}

function stubCanvas(): ImageBitmap {
  const rgba = terrariumPixels()
  class FakeOffscreenCanvas {
    width: number
    height: number
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    getContext() {
      return { clearRect() {}, drawImage() {}, getImageData: () => ({ data: rgba }) }
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  return { width: SIZE, height: SIZE, close() {} } as unknown as ImageBitmap
}

const job = (bitmap: ImageBitmap, partial: Partial<TileJob> = {}): TileJob => ({
  bitmap,
  encoding: 'terrarium',
  clean: { enabled: true, seaToZero: false },
  tileWidthM: 9800,
  key: KEY,
  origin: { lon: CENTER.lon + 0.01, lat: CENTER.lat - 0.01 },
  geometry: { segments: 16, exaggeration: 1.5, skirtDepthM: 120 },
  ...partial,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('./tileJob')
  vi.resetModules()
})

describe('runTileJob', () => {
  it('gives the grid and the geometry the main thread builds, bit for bit, also after the hand-over', () => {
    const bitmap = stubCanvas()
    const j = job(bitmap)
    const grid = cleanDem(decodeDemPixels(terrariumPixels(), SIZE, SIZE, 'terrarium'), j.clean!, j.tileWidthM)
    const frame = createLocalFrame(j.origin.lon, j.origin.lat)
    const expected = buildTileGeometry(KEY, grid, frame, j.geometry)

    const built = runTileJob(j)
    // what the worker's message does: the buffers move, the page reads them as they arrive
    const received = structuredClone(built, { transfer: resultBuffers(built) })

    expect(received.grid.width).toBe(SIZE)
    expect(Array.from(received.grid.data)).toEqual(Array.from(grid.data)) // NaN equal to NaN here
    expect(Array.from(received.grid.data).some(Number.isNaN)).toBe(true)
    expect(received.mesh.positions).toEqual(expected.geometry.getAttribute('position').array)
    expect(received.mesh.normals).toEqual(expected.geometry.getAttribute('normal').array)
    expect(received.mesh.uvs).toEqual(expected.geometry.getAttribute('uv').array)
    expect(received.mesh.index).toEqual(expected.geometry.getIndex()!.array)
    expect(received.mesh.minHeight).toBe(expected.minHeight)
    expect(received.mesh.maxHeight).toBe(expected.maxHeight)
  })
})

describe('buildTileOffThread', () => {
  it('resolves with undefined where there is no Worker (the page builds the tile)', async () => {
    const { buildTileOffThread } = await import('./tileWorker')
    expect(await buildTileOffThread(job(stubCanvas()))).toBeUndefined()
  })

  /** A Worker that answers like `tile.worker.ts`, or as `reply` says. */
  function stubWorkers(reply: (message: { id: number }) => unknown) {
    const made: FakeWorker[] = []
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onmessageerror: (() => void) | null = null
      terminated = false
      constructor() {
        made.push(this)
      }
      postMessage(message: { id: number }) {
        queueMicrotask(() => this.onmessage?.({ data: reply(message) } as MessageEvent))
      }
      terminate() {
        this.terminated = true
      }
    }
    class FakeBitmap {
      close() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('OffscreenCanvas', class {})
    vi.stubGlobal('ImageBitmap', FakeBitmap)
    vi.stubGlobal('createImageBitmap', async () => new FakeBitmap())
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    return { made, bitmap: new FakeBitmap() as unknown as ImageBitmap }
  }

  const tile = (heights: number[], max = 5) => ({
    grid: { width: heights.length, height: 1, data: Float32Array.from(heights) },
    mesh: { minHeight: 0, maxHeight: max } as unknown as TileResult['mesh'],
  })

  /** What the page builds for the check (`runTileJob` of tileJob.ts, which needs a canvas). */
  async function pageBuilds(own: TileResult | Error) {
    const run = vi.fn(() => {
      if (own instanceof Error) throw own
      return own
    })
    vi.doMock('./tileJob', async (original) => ({ ...(await original<typeof import('./tileJob')>()), runTileJob: run }))
    return run
  }

  it('hands the tile to a worker and returns its result', async () => {
    const result = tile([1, NaN, 3])
    const { made, bitmap } = stubWorkers(({ id }) => ({ id, result }))
    await pageBuilds(tile([1, NaN, 3]))
    const { buildTileOffThread } = await import('./tileWorker')
    expect(await buildTileOffThread(job(bitmap))).toBe(result)
    expect(made).toHaveLength(4) // at most four, whatever the machine
  })

  it('builds the first tile on the page too, once, and keeps the pool when they agree', async () => {
    const { made, bitmap } = stubWorkers(({ id }) => ({ id, result: tile([1, NaN, 3]) }))
    const run = await pageBuilds(tile([1, NaN, 3]))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { buildTileOffThread } = await import('./tileWorker')
    await Promise.all([buildTileOffThread(job(bitmap)), buildTileOffThread(job(bitmap))])
    await buildTileOffThread(job(bitmap))
    expect(run).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
    expect(made.some((w) => w.terminated)).toBe(false)
    warn.mockRestore()
  })

  it.each([
    ['a height', tile([1, 2, 4])],
    ['a nodata place', tile([1, 2, NaN])],
    ['the highest point', tile([1, 2, 3], 6)],
  ])('drops the pool and keeps the page tile when %s differs', async (_what, own) => {
    const { made, bitmap } = stubWorkers(({ id }) => ({ id, result: tile([1, 2, 3]) }))
    await pageBuilds(own)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { buildTileOffThread } = await import('./tileWorker')
    // two tiles in flight: the first gets the page's tile, the other is left to the engine; later ones skip the workers
    const [first, second] = await Promise.all([buildTileOffThread(job(bitmap)), buildTileOffThread(job(bitmap))])
    expect(first).toBe(own)
    expect(second).toBeUndefined()
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(made.every((w) => w.terminated)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[terrain\]/)
    warn.mockRestore()
  })

  it('leaves the tile to the engine, and checks the next one, when the page cannot build it', async () => {
    const { bitmap } = stubWorkers(({ id }) => ({ id, result: tile([1, 2, 3]) }))
    const run = await pageBuilds(new Error('bad tile'))
    const { buildTileOffThread } = await import('./tileWorker')
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('falls back (undefined) when a worker fails on a tile, and keeps the pool', async () => {
    const { made, bitmap } = stubWorkers(({ id }) => ({ id, failed: true }))
    const { buildTileOffThread } = await import('./tileWorker')
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(made.some((w) => w.terminated)).toBe(false)
  })

  it('drops the pool for good when a worker cannot read pixels or dies', async () => {
    const { made, bitmap } = stubWorkers(({ id }) => ({ id, unsupported: true }))
    const { buildTileOffThread } = await import('./tileWorker')
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(made.every((w) => w.terminated)).toBe(true)
    expect(await buildTileOffThread(job(bitmap))).toBeUndefined()
    expect(made).toHaveLength(4) // no new workers

    // a worker that errors resolves the tile it holds
    vi.resetModules()
    const second = stubWorkers(() => ({ id: -1 }))
    const again = await import('./tileWorker')
    const waiting = again.buildTileOffThread(job(second.bitmap))
    await new Promise((resolve) => setTimeout(resolve)) // the tile is with the worker
    second.made[0].onerror?.()
    expect(await waiting).toBeUndefined()
  })
})
