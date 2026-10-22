import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { FOREST_MARGIN_M, MAX_FOREST_POLYGONS, fetchTrackForest, forestQuery, isValidForest, parseForest } from './forest'
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
  segments: [{ points: [{ lon: 6.78, lat: 45.9 }, { lon: 6.79, lat: 45.91 }] }],
})

describe('forestQuery', () => {
  it('asks for forest and wood ways and multipolygons with their geometry, in the corridor', () => {
    const q = forestQuery(track)
    expect(q).toContain('way["landuse"="forest"]')
    expect(q).toContain('relation["natural"="wood"]["type"="multipolygon"]')
    expect(q).toContain('out geom qt;')
    const south = Number(/\((-?[\d.]+),/.exec(q)![1])
    expect(south).toBeCloseTo(45.9 - FOREST_MARGIN_M / M, 4)
  })
})

describe('parseForest', () => {
  const response = {
    elements: [
      { type: 'way', id: 1, tags: { landuse: 'forest', leaf_type: 'needleleaved' }, geometry: square(6.8, 45.9, 300) },
      { type: 'way', id: 2, tags: { natural: 'wood' }, geometry: square(6.81, 45.9, 40) },
      { type: 'way', id: 3, tags: { natural: 'wood', leaf_type: 'leafless' }, geometry: square(6.82, 45.9, 100).slice(0, 4) },
      {
        type: 'relation',
        id: 4,
        tags: { type: 'multipolygon', landuse: 'forest', leaf_type: 'mixed' },
        members: [
          { type: 'way', ref: 10, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(0, 3) },
          { type: 'way', ref: 11, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(2) },
          { type: 'way', ref: 12, role: 'inner', geometry: square(6.833, 45.903, 100) },
        ],
      },
      { type: 'way', id: 10, tags: { landuse: 'forest' }, geometry: square(6.83, 45.9, 1000).slice(0, 3) },
    ],
  }

  it('keeps the forests with their leaf type, the holes of a relation, and drops the small and the open ones', () => {
    const forests = parseForest(response)
    expect(forests.map((f) => f.id)).toEqual(['relation/4', 'way/1'])
    const relation = forests[0]
    expect(relation.leaf).toBe('mixed')
    expect(relation.holes).toHaveLength(1)
    expect(relation.outer).toHaveLength(4)
    expect(forests[1].leaf).toBe('needleleaved')
    // a forest that does not say its leaves has no leaf key (compact cache)
    expect(parseForest({ elements: [response.elements[2], { ...response.elements[0], tags: { landuse: 'forest' } }] })[0]).not.toHaveProperty('leaf')
  })

  it('keeps the largest forests when there are too many, and rejects an error response', () => {
    const many = Array.from({ length: MAX_FOREST_POLYGONS + 20 }, (_, i) => ({
      type: 'way',
      id: 100 + i,
      tags: { landuse: 'forest' },
      geometry: square(6.8 + (i % 20) * 0.001, 45.9 + Math.floor(i / 20) * 0.001, 100 + i),
    }))
    const kept = parseForest({ elements: many })
    expect(kept).toHaveLength(MAX_FOREST_POLYGONS)
    expect(kept[0].id).toBe(`way/${100 + MAX_FOREST_POLYGONS + 19}`)
    expect(() => parseForest({ elements: [], remark: 'runtime error: Query timed out' })).toThrow()
  })
})

describe('isValidForest', () => {
  it('accepts a density of the slider only', () => {
    expect(isValidForest({ enabled: true, density: 60 })).toBe(true)
    expect(isValidForest({ enabled: false, density: 5 })).toBe(false)
    expect(isValidForest({ enabled: true, density: 1000 })).toBe(false)
  })
})

describe('fetchTrackForest', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('queries once per track through the shared Overpass cache', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { landuse: 'forest' }, geometry: square(6.8, 45.9, 300) }] })))
    const deps: OverpassDeps = { fetch: fetch as unknown as OverpassDeps['fetch'], sleep: async () => {}, storage: null, now: () => 0 }
    const a = await fetchTrackForest(track, undefined, deps)
    const b = await fetchTrackForest(track, undefined, deps)
    expect(a).toHaveLength(1)
    expect(b).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
