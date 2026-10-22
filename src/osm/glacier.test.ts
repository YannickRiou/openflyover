import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { GLACIER_MARGIN_M, MAX_GLACIER_POLYGONS, MAX_GLACIER_VERTICES, MIN_GLACIER_AREA_M2, fetchTrackGlacier, glacierQuery, parseGlacier } from './glacier'
import { clearOverpassMemoryCache, type OverpassDeps } from './overpass'

const M = 111_320
const K = Math.cos((45.9 * Math.PI) / 180) * M

/** Square ring of `sideM` metres with its lower-left corner at (lon, lat), closed, as Overpass geometry. */
function square(lon: number, lat: number, sideM: number): { lat: number; lon: number }[] {
  const dLon = sideM / K
  const dLat = sideM / M
  return [
    { lon, lat },
    { lon: lon + dLon, lat },
    { lon: lon + dLon, lat: lat + dLat },
    { lon, lat: lat + dLat },
    { lon, lat },
  ]
}

const track = buildTrack({
  name: 't',
  source: 'gpx',
  segments: [{ points: [{ lon: 6.93, lat: 45.9 }, { lon: 6.94, lat: 45.91 }] }],
})

describe('glacierQuery', () => {
  it('asks for the glacier ways and multipolygons with their geometry, in the corridor', () => {
    const q = glacierQuery(track)
    expect(q).toContain('way["natural"="glacier"]')
    expect(q).toContain('relation["natural"="glacier"]["type"="multipolygon"]')
    expect(q).toContain('out geom qt;')
    const south = Number(/\((-?[\d.]+),/.exec(q)![1])
    expect(south).toBeCloseTo(45.9 - GLACIER_MARGIN_M / M, 4)
  })
})

describe('parseGlacier', () => {
  const response = {
    elements: [
      { type: 'way', id: 1, tags: { natural: 'glacier' }, geometry: square(6.93, 45.9, 600) },
      // 100 m × 100 m: under the area of a glacier
      { type: 'way', id: 2, tags: { natural: 'glacier' }, geometry: square(6.94, 45.9, 100) },
      // not closed
      { type: 'way', id: 3, tags: { natural: 'glacier' }, geometry: square(6.95, 45.9, 900).slice(0, 4) },
      {
        type: 'relation',
        id: 4,
        tags: { type: 'multipolygon', natural: 'glacier' },
        members: [
          { type: 'way', ref: 10, role: 'outer', geometry: square(6.96, 45.9, 2000).slice(0, 3) },
          { type: 'way', ref: 11, role: 'outer', geometry: square(6.96, 45.9, 2000).slice(2) },
          { type: 'way', ref: 12, role: 'inner', geometry: square(6.962, 45.902, 200) },
        ],
      },
      // member of the relation: drawn by the relation
      { type: 'way', id: 10, tags: { natural: 'glacier' }, geometry: square(6.96, 45.9, 2000).slice(0, 3) },
    ],
  }

  it('keeps the large glaciers, largest first, with the holes of a relation', () => {
    const glaciers = parseGlacier(response)
    expect(glaciers.map((g) => g.id)).toEqual(['relation/4', 'way/1'])
    expect(glaciers[0].holes).toHaveLength(1)
    expect(glaciers[0].outer).toHaveLength(4)
    // no leaf type or other tag in the compact result
    expect(Object.keys(glaciers[1]).sort()).toEqual(['holes', 'id', 'outer'])
    expect(MIN_GLACIER_AREA_M2).toBe(20_000)
  })

  it('keeps the largest glaciers when there are too many, and rejects an error response', () => {
    const many = Array.from({ length: MAX_GLACIER_POLYGONS + 20 }, (_, i) => ({
      type: 'way',
      id: 100 + i,
      tags: { natural: 'glacier' },
      geometry: square(6.8 + (i % 20) * 0.01, 45.9 + Math.floor(i / 20) * 0.005, 300 + i),
    }))
    const kept = parseGlacier({ elements: many })
    expect(kept).toHaveLength(MAX_GLACIER_POLYGONS)
    expect(kept[0].id).toBe(`way/${100 + MAX_GLACIER_POLYGONS + 19}`)
    expect(() => parseGlacier({ elements: [], remark: 'runtime error: Query timed out' })).toThrow()
  })

  it('keeps the largest glaciers while their vertices fit', () => {
    // wavy rings of 500 vertices that the simplification keeps, the first the largest
    const wavy = (i: number) =>
      Array.from({ length: 501 }, (_, k) => {
        const a = (2 * Math.PI * (k % 500)) / 500
        const r = ((1500 - i * 5) / 2) * (k % 2 ? 1.2 : 1)
        return { lon: 6.8 + i * 0.05 + (r * Math.cos(a)) / K, lat: 45.9 + (r * Math.sin(a)) / M }
      })
    const kept = parseGlacier({ elements: Array.from({ length: 80 }, (_, i) => ({ type: 'way', id: i + 1, tags: { natural: 'glacier' }, geometry: wavy(i) })) })
    const vertices = kept.reduce((n, g) => n + g.outer.length, 0)
    expect(vertices).toBeLessThanOrEqual(MAX_GLACIER_VERTICES)
    expect(vertices).toBeGreaterThan(MAX_GLACIER_VERTICES - 500)
    expect(kept[0].id).toBe('way/1')
    expect(kept.map((g) => g.id)).not.toContain('way/80')
  })
})

describe('fetchTrackGlacier', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('queries once per track through the shared Overpass cache', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { natural: 'glacier' }, geometry: square(6.93, 45.9, 600) }] })))
    const deps: OverpassDeps = { fetch: fetch as unknown as OverpassDeps['fetch'], sleep: async () => {}, storage: null, now: () => 0 }
    const a = await fetchTrackGlacier(track, undefined, deps)
    const b = await fetchTrackGlacier(track, undefined, deps)
    expect(a).toHaveLength(1)
    expect(b).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
