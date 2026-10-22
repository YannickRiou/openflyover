import { describe, expect, it } from 'vitest'
import type { WaterPolygon } from '../osm/water'
import { buildSeaMesh, buildWaterMesh, clipRing, lakeLevel } from './waterMesh'

const M = 111_320
const LAT = 45.9
const K = Math.cos((LAT * Math.PI) / 180) * M

/** Square of `sideM` metres centred on (6.8, 45.9), as an open [lon, lat] ring. */
function square(sideM: number, lon = 6.8, lat = LAT): [number, number][] {
  const h = sideM / 2
  return [
    [lon - h / K, lat - h / M],
    [lon + h / K, lat - h / M],
    [lon + h / K, lat + h / M],
    [lon - h / K, lat + h / M],
  ]
}

/** Total area of the triangles (m², local metres). */
function meshArea(mesh: ReturnType<typeof buildWaterMesh>): number {
  let area = 0
  const xy = (i: number) => [(mesh.lonLat[2 * i] - 6.8) * K, (mesh.lonLat[2 * i + 1] - LAT) * M]
  for (let t = 0; t < mesh.index.length; t += 3) {
    const [a, b, c] = [xy(mesh.index[t]), xy(mesh.index[t + 1]), xy(mesh.index[t + 2])]
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  return area
}

describe('clipRing', () => {
  it('clips a ring to a rectangle', () => {
    const out = clipRing([[-1, -1], [3, -1], [3, 3], [-1, 3]], 0, 0, 2, 2)
    expect(out).toHaveLength(4)
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(2)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(2)
    }
    expect(clipRing([[5, 5], [6, 5], [6, 6]], 0, 0, 2, 2)).toEqual([])
  })
})

describe('buildWaterMesh', () => {
  const lake: WaterPolygon = { id: 'way/1', kind: 'lake', outer: square(500), holes: [] }

  it('covers the polygon with grid cells, holes left out', () => {
    const mesh = buildWaterMesh(lake, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(meshArea(mesh)).toBeCloseTo(250_000, -2)
    const island = buildWaterMesh({ ...lake, holes: [square(100)] }, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(meshArea(island)).toBeCloseTo(240_000, -2)
    // vertices inside the water every cell, not only on the shore
    expect(mesh.lonLat.length / 2).toBeGreaterThan(60)
  })

  it('fades from 0 on the shore to 1 beyond fadeM', () => {
    const mesh = buildWaterMesh(lake, { cellM: 60, maxCells: 40, fadeM: 40 })
    let shore = 0
    let open = 0
    for (let v = 0; v < mesh.fade.length; v++) {
      const x = (mesh.lonLat[2 * v] - 6.8) * K
      const y = (mesh.lonLat[2 * v + 1] - LAT) * M
      const d = 250 - Math.max(Math.abs(x), Math.abs(y))
      expect(mesh.fade[v]).toBeCloseTo(Math.min(1, d / 40), 2)
      if (d < 0.01) shore++
      if (d > 40) open++
    }
    expect(shore).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(0)
  })

  it('caps the number of cells of a large lake', () => {
    const big = buildWaterMesh({ ...lake, outer: square(20_000) }, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(big.index.length / 3).toBeLessThanOrEqual(40 * 40 * 4)
    expect(meshArea(big)).toBeCloseTo(4e8, -5)
  })
})

describe('buildSeaMesh', () => {
  const sea: WaterPolygon = { id: 'sea/0', kind: 'sea', outer: square(5000), holes: [] }

  it('triangulates the polygon as it is, islands left out, counter-clockwise', () => {
    const mesh = buildSeaMesh(sea)
    expect(meshArea(mesh)).toBeCloseTo(25_000_000, -3)
    expect(mesh.index.length).toBe(6)
    expect(meshArea(buildSeaMesh({ ...sea, holes: [square(1000)] }))).toBeCloseTo(24_000_000, -3)
    const xy = (i: number) => [(mesh.lonLat[2 * i] - 6.8) * K, (mesh.lonLat[2 * i + 1] - LAT) * M]
    const [a, b, c] = [mesh.index[0], mesh.index[1], mesh.index[2]].map(xy)
    expect((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).toBeGreaterThan(0)
  })

  it('has no shore to fade from', () => {
    expect([...buildSeaMesh(sea).fade].every((f) => f === 1)).toBe(true)
  })
})

describe('lakeLevel', () => {
  it('takes a high percentile of the heights inside the lake, not of the shore', () => {
    // shore at 1010 (a steep bank), inside 1000 with a few seams up to 1003
    const heights = [1010, 1010, 1010, 1010, 1000, 1000, 1001, 1001, 1002, 1003]
    const fade = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1]
    expect(lakeLevel(heights, fade)).toBe(1002)
  })

  it('ignores the vertices whose relief is not loaded yet, and says so when none is known', () => {
    expect(lakeLevel([Number.NaN, 1000, 1000, 1000, 1000, 1004], [1, 1, 1, 1, 1, 1])).toBe(1000)
    expect(lakeLevel([Number.NaN, Number.NaN], [1, 1])).toBeNaN()
  })

  it('falls back to the median of every vertex for a thin lake with almost nothing inside', () => {
    expect(lakeLevel([1000, 1001, 1002, 1003, 1004], [0, 0.1, 0.2, 0, 1])).toBe(1002)
  })
})
