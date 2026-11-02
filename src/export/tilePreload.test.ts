import { describe, expect, it } from 'vitest'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { filmTilesToPreload, preloadTiles } from './tilePreload'

/** A track of 10 km going south from Chamonix. */
const points = Array.from({ length: 101 }, (_, i) => ({ lon: 6.87, lat: 45.92 - i * 0.0009 }))
const bounds = { west: 6.87, east: 6.87, south: 45.92 - 100 * 0.0009, north: 45.92 }
const input = {
  points,
  bounds,
  terrain: getTerrainSource('mapterhorn'),
  imagery: getImagerySource('arcgis-world-imagery'),
  imageryZoomOffset: 0,
  cameraHeightM: 300,
  viewportHeightPx: 1080,
  maxBytes: Infinity,
}
/** z/x/y of a Mapterhorn or Esri URL (Esri puts the row before the column) */
const keyOf = (url: string) => {
  const m = /\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/.exec(url)!
  return url.includes('arcgis') ? { z: +m[1], y: +m[2], x: +m[3] } : { z: +m[1], x: +m[2], y: +m[3] }
}

describe('filmTilesToPreload', () => {
  it('lists the terrain and the imagery, Esri included (fetched, never stored), the coarse tiles first and the fine ones along the track', () => {
    const { urls, planned } = filmTilesToPreload(input)
    expect(urls).toHaveLength(planned)
    expect(urls.some((u) => u.includes('mapterhorn'))).toBe(true)
    expect(urls.some((u) => u.includes('arcgis'))).toBe(true)
    // the deepest terrain tiles come in the order the track goes south: the first ones are north of the last ones
    // (the tiles before the start of the track all take its first point: a tie)
    const terrain = urls.filter((u) => u.includes('mapterhorn')).map(keyOf)
    const deepest = Math.max(...terrain.map((k) => k.z))
    const rows = terrain.filter((k) => k.z === deepest).map((k) => k.y)
    const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
    const quarter = Math.floor(rows.length / 4)
    expect(mean(rows.slice(0, quarter))).toBeLessThan(mean(rows.slice(-quarter)))
    // a coarse tile never comes after a fine one
    const zooms = terrain.map((k) => k.z)
    expect(zooms.indexOf(deepest)).toBeGreaterThan(zooms.lastIndexOf(Math.min(...zooms)))
  })

  it('stops at the size the device keeps, the start of the film first', () => {
    const all = filmTilesToPreload(input)
    const cut = filmTilesToPreload({ ...input, maxBytes: all.estimatedBytes / 4 })
    expect(cut.planned).toBe(all.planned)
    expect(cut.urls.length).toBeLessThan(all.urls.length)
    expect(cut.estimatedBytes).toBeLessThanOrEqual(all.estimatedBytes / 4)
    expect(all.urls.slice(0, cut.urls.length)).toEqual(cut.urls)
  })
})

describe('preloadTiles', () => {
  it('fetches every tile a few at a time, skips those of an offline pack, and only counts the failures', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://t/${i}`)
    let running = 0
    let most = 0
    const fetched: string[] = []
    const progress: number[] = []
    const result = await preloadTiles(urls, {
      download: async (url) => {
        running++
        most = Math.max(most, running)
        await new Promise((r) => setTimeout(r, 1))
        running--
        if (url.endsWith('/7')) throw new Error('404')
        fetched.push(url)
      },
      stored: { covers: (url) => url.endsWith('/3'), get: async () => new Blob(['x']) },
      isCanceled: () => false,
      onProgress: (done) => progress.push(done),
      concurrency: 4,
    })
    expect(result).toEqual({ done: 20, failed: 1 })
    expect(most).toBe(4)
    expect(fetched).toHaveLength(18)
    expect(fetched).not.toContain('https://t/3')
    expect(progress.at(-1)).toBe(20)
  })

  it('keeps a server within its own limit, the others taking the free places', async () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://${i % 2 ? 'slow' : 'fast'}/${i}`)
    const running = { slow: 0, fast: 0 }
    const most = { slow: 0, fast: 0, all: 0 }
    const result = await preloadTiles(urls, {
      download: async (url) => {
        const host = url.includes('slow') ? 'slow' : 'fast'
        running[host]++
        most[host] = Math.max(most[host], running[host])
        most.all = Math.max(most.all, running.slow + running.fast)
        await new Promise((r) => setTimeout(r, host === 'slow' ? 5 : 1))
        running[host]--
      },
      isCanceled: () => false,
      concurrency: 6,
      maxRequestsOf: (url) => (url.includes('slow') ? 2 : Infinity),
    })
    expect(result).toEqual({ done: 40, failed: 0 })
    expect(most.slow).toBe(2)
    expect(most.fast).toBe(4)
    expect(most.all).toBe(6)
  })

  it('stops asking once the export is canceled', async () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://t/${i}`)
    let calls = 0
    const result = await preloadTiles(urls, { download: async () => void calls++, isCanceled: () => calls >= 5, concurrency: 1 })
    expect(calls).toBe(5)
    expect(result.done).toBe(5)
  })
})
