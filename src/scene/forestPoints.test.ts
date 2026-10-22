import { describe, expect, it } from 'vitest'
import type { LonLat } from '../core/types'
import type { ForestPolygon } from '../osm/forest'
import { pointInRing } from '../osm/water'
import {
  BROADLEAF,
  BY_ALTITUDE,
  CHUNK_M,
  CONIFER,
  CONIFER_ALTITUDE_M,
  FAR_DENSITY_RATIO,
  FAR_TRACK_M,
  NEAR_TRACK_M,
  TREE_HEIGHT_M,
  densityFactor,
  distanceToPath,
  hash01,
  placeTrees,
  treeKind,
} from './forestPoints'
import { TREE_WIDTH_RATIO, createTreeGeometries } from './treeGeometry'

const M = 111_320
const K = Math.cos((45.9 * Math.PI) / 180) * M

/** Square forest of `sideM` metres with its lower-left corner at (lon, lat). */
function forest(lon: number, lat: number, sideM: number, extra: Partial<ForestPolygon> = {}): ForestPolygon {
  const dLon = sideM / K
  const dLat = sideM / M
  return {
    id: `way/${lon}/${lat}`,
    outer: [[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat]],
    holes: [],
    ...extra,
  }
}

const path: LonLat[] = [{ lon: 6.8, lat: 45.9 }, { lon: 6.82, lat: 45.9 }]
const near = forest(6.8, 45.9, 600)
const options = { density: 60, maxTrees: 100_000, path }

const total = (chunks: ReturnType<typeof placeTrees>) => chunks.reduce((n, c) => n + c.count, 0)

describe('placeTrees', () => {
  it('puts about `density` trees on every hectare of the forest', () => {
    const chunks = placeTrees([near], options)
    // 600 × 600 m = 36 ha at 60 trees per hectare
    expect(total(chunks)).toBeGreaterThan(36 * 60 * 0.9)
    expect(total(chunks)).toBeLessThan(36 * 60 * 1.1)
  })

  it('gives the same trees every run, whatever the order of the forests', () => {
    const other = forest(6.805, 45.903, 400, { leaf: 'needleleaved' })
    const a = placeTrees([near, other], options)
    const b = placeTrees([other, near], options)
    expect(b.map((c) => c.key)).toEqual(a.map((c) => c.key))
    expect(Array.from(b[0].lonLat)).toEqual(Array.from(a[0].lonLat))
    expect(Array.from(placeTrees([near, other], options)[0].height)).toEqual(Array.from(a[0].height))
  })

  it('keeps the trees inside the forest and out of its holes', () => {
    const dLon = 600 / K
    const dLat = 600 / M
    const hole: [number, number][] = [[6.8 + dLon / 4, 45.9 + dLat / 4], [6.8 + dLon / 2, 45.9 + dLat / 4], [6.8 + dLon / 2, 45.9 + dLat / 2], [6.8 + dLon / 4, 45.9 + dLat / 2]]
    const holed = { ...near, holes: [hole] }
    const ring = hole.map(([lon, lat]) => ({ lon, lat }))
    const outer = near.outer.map(([lon, lat]) => ({ lon, lat }))
    const all = placeTrees([holed], options)
    expect(total(all)).toBeLessThan(total(placeTrees([near], options)))
    for (const chunk of all) {
      for (let i = 0; i < chunk.count; i++) {
        const p = { lon: chunk.lonLat[2 * i], lat: chunk.lonLat[2 * i + 1] }
        expect(pointInRing(p, outer)).toBe(true)
        expect(pointInRing(p, ring)).toBe(false)
      }
    }
  })

  it('splits a large forest into chunks, each tree in the chunk of its place', () => {
    const chunks = placeTrees([forest(6.8, 45.9, 4000)], options)
    expect(chunks.length).toBeGreaterThanOrEqual(9)
    expect(new Set(chunks.map((c) => c.key)).size).toBe(chunks.length)
    for (const chunk of chunks) {
      expect(chunk.radiusM).toBeGreaterThan(CHUNK_M / 2)
      expect(chunk.lonLat).toHaveLength(2 * chunk.count)
      expect(chunk.kind).toHaveLength(chunk.count)
    }
  })

  it('varies height, colour and turn, within bounds', () => {
    const [chunk] = placeTrees([near], options)
    expect(Math.min(...chunk.height)).toBeGreaterThanOrEqual(TREE_HEIGHT_M.min)
    expect(Math.max(...chunk.height)).toBeLessThanOrEqual(TREE_HEIGHT_M.max)
    expect(Math.max(...chunk.height) - Math.min(...chunk.height)).toBeGreaterThan(8)
    expect(new Set(chunk.variation).size).toBeGreaterThan(chunk.count / 2)
    expect(Math.max(...chunk.yaw)).toBeLessThan(2 * Math.PI)
  })

  it('takes the kind from leaf_type, and from the altitude when OpenStreetMap does not say', () => {
    const kinds = (leaf?: ForestPolygon['leaf']) => new Set(placeTrees([forest(6.8, 45.9, 600, leaf ? { leaf } : {})], options).flatMap((c) => Array.from(c.kind)))
    expect(kinds('needleleaved')).toEqual(new Set([CONIFER]))
    expect(kinds('broadleaved')).toEqual(new Set([BROADLEAF]))
    expect(kinds('mixed')).toEqual(new Set([CONIFER, BROADLEAF]))
    expect(kinds()).toEqual(new Set([BY_ALTITUDE]))
    expect(treeKind(BY_ALTITUDE, CONIFER_ALTITUDE_M + 1)).toBe('conifer')
    expect(treeKind(BY_ALTITUDE, 600)).toBe('broadleaf')
    expect(treeKind(CONIFER, 0)).toBe('conifer')
    expect(treeKind(BROADLEAF, 2500)).toBe('broadleaf')
  })

  it('never places more than the budget, nearest chunks first', () => {
    const big = forest(6.8, 45.9, 6000)
    const all = placeTrees([big], options)
    const limited = placeTrees([big], { ...options, maxTrees: 20_000 })
    expect(total(all)).toBeGreaterThan(20_000)
    expect(total(limited)).toBeLessThanOrEqual(20_000)
    expect(total(limited)).toBeGreaterThan(10_000)
    // what is kept is the start of the nearest-first order
    expect(limited.map((c) => c.key)).toEqual(all.slice(0, limited.length).map((c) => c.key))
  })

  it('thins out with the distance to the track', () => {
    const farForest = forest(6.8, 45.9 + 4500 / M, 600)
    const farTrees = total(placeTrees([farForest], options))
    const nearTrees = total(placeTrees([near], options))
    expect(farTrees).toBeLessThan(nearTrees * 0.7)
    expect(farTrees).toBeGreaterThan(nearTrees * FAR_DENSITY_RATIO * 0.7)
  })

  it('places nothing without forest, density or budget', () => {
    expect(placeTrees([], options)).toEqual([])
    expect(placeTrees([near], { ...options, density: 0 })).toEqual([])
    expect(placeTrees([near], { ...options, maxTrees: 0 })).toEqual([])
  })
})

describe('helpers', () => {
  it('thins the density linearly between the near and the far distance', () => {
    expect(densityFactor(0)).toBe(1)
    expect(densityFactor(NEAR_TRACK_M)).toBe(1)
    expect(densityFactor(FAR_TRACK_M)).toBeCloseTo(FAR_DENSITY_RATIO)
    expect(densityFactor(100_000)).toBeCloseTo(FAR_DENSITY_RATIO)
    expect(densityFactor((NEAR_TRACK_M + FAR_TRACK_M) / 2)).toBeCloseTo((1 + FAR_DENSITY_RATIO) / 2)
  })

  it('hashes to [0, 1), differently for each input', () => {
    const values = Array.from({ length: 200 }, (_, i) => hash01(i, 7, 1))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(new Set(values).size).toBe(200)
    expect(hash01(3, 4, 1)).toBe(hash01(3, 4, 1))
    expect(hash01(3, 4, 1)).not.toBe(hash01(3, 4, 2))
  })

  it('measures the distance to the track', () => {
    expect(distanceToPath({ lon: 6.81, lat: 45.9 + 1000 / M }, path)).toBeCloseTo(1000, -1)
    expect(distanceToPath({ lon: 6.81, lat: 45.9 }, [])).toBe(0)
  })
})

describe('tree shapes', () => {
  it('are light, unit-sized, painted and based on the ground', () => {
    const shapes = createTreeGeometries()
    for (const kind of ['conifer', 'broadleaf'] as const) {
      const g = shapes[kind]
      const triangles = g.getAttribute('position').count / 3
      expect(triangles).toBeGreaterThanOrEqual(20)
      expect(triangles).toBeLessThanOrEqual(60)
      expect(g.getAttribute('color').count).toBe(3 * triangles)
      g.computeBoundingBox()
      expect(g.boundingBox!.min.y).toBeCloseTo(0, 1)
      expect(g.boundingBox!.max.y).toBeCloseTo(1, 1)
      expect(g.boundingBox!.max.x).toBeLessThanOrEqual(1.001)
      expect(TREE_WIDTH_RATIO[kind]).toBeGreaterThan(0)
    }
  })
})
