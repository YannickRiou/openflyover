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
  MIN_THINNING,
  NEAR_TRACK_M,
  TREE_HEIGHT_M,
  densityFactor,
  distanceToPath,
  distanceToPaths,
  hash01,
  placeTrees,
  thinning,
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
const options = { density: 60, maxTrees: 100_000, paths: [path] }

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

  it('never places more than the budget, and thins the far chunks instead of dropping them', () => {
    const big = forest(6.8, 45.9, 6000)
    const all = placeTrees([big], options)
    const limited = placeTrees([big], { ...options, maxTrees: 20_000 })
    expect(total(all)).toBeGreaterThan(20_000)
    expect(total(limited)).toBeLessThanOrEqual(20_000)
    // most of the budget is used, and every chunk of the forest is still there
    expect(total(limited)).toBeGreaterThan(20_000 * 0.8)
    expect(limited.map((c) => c.key).sort()).toEqual(all.map((c) => c.key).sort())
    // full density near the track, far fewer trees in the chunks beyond, none emptied
    const count = (chunks: typeof all, key: string) => chunks.find((c) => c.key === key)!.count
    const byDistance = [...all].sort((a, b) => distanceToPath(a.centre, path) - distanceToPath(b.centre, path))
    expect(count(limited, byDistance[0].key)).toBe(count(all, byDistance[0].key))
    const far = byDistance.slice(-10).map((c) => c.key)
    const farTotal = (chunks: typeof all) => far.reduce((n, key) => n + count(chunks, key), 0)
    expect(farTotal(limited)).toBeLessThan(farTotal(all) * 0.5)
    for (const key of far) expect(count(limited, key)).toBeGreaterThan(0)
  })

  it('places the same trees for the same budget, and keeps within it with a tiny budget', () => {
    const big = forest(6.8, 45.9, 6000)
    const options2 = { ...options, maxTrees: 5_000 }
    const a = placeTrees([big], options2)
    const b = placeTrees([big], options2)
    expect(total(a)).toBeLessThanOrEqual(5_000)
    expect(b.map((c) => [c.key, c.count])).toEqual(a.map((c) => [c.key, c.count]))
    expect(Array.from(b[b.length - 1].lonLat)).toEqual(Array.from(a[a.length - 1].lonLat))
    expect(total(placeTrees([big], { ...options, maxTrees: 300 }))).toBeLessThanOrEqual(300)
  })

  it('measures the distance to the nearest of several tracks', () => {
    // the same forest, far from the first track and on the second one: its chunks keep their full density
    const farForest = forest(6.8, 45.9 + 8000 / M, 600)
    const second: LonLat[] = [{ lon: 6.8, lat: 45.9 + 8000 / M }, { lon: 6.82, lat: 45.9 + 8000 / M }]
    const alone = total(placeTrees([farForest], { ...options, paths: [path] }))
    const both = total(placeTrees([farForest], { ...options, paths: [path, second] }))
    expect(alone).toBeLessThan(both * (FAR_DENSITY_RATIO + 0.1))
    expect(both).toBeGreaterThan(36 * 60 * 0.9)
    expect(distanceToPaths({ lon: 6.81, lat: 45.9 + 8000 / M }, [path, second])).toBeCloseTo(0, 0)
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

describe('thinning', () => {
  const distance = [0, 1000, 3000, 6000, 9000]

  it('keeps every chunk at full density when the budget is enough', () => {
    expect(thinning(distance, [10, 10, 10, 10, 10], 50)).toEqual([1, 1, 1, 1, 1])
    expect(thinning([], [], 10)).toEqual([])
  })

  it('fits the budget, keeps the nearest chunk whole and falls with the distance', () => {
    const expected = [400, 500, 600, 700, 800]
    const shares = thinning(distance, expected, 1500)
    const sum = shares.reduce((n, m, i) => n + m * expected[i], 0)
    expect(sum).toBeLessThanOrEqual(1500)
    expect(sum).toBeGreaterThan(1500 * 0.99)
    expect(shares[0]).toBe(1)
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeLessThan(shares[i - 1])
      expect(shares[i]).toBeGreaterThanOrEqual(MIN_THINNING)
    }
  })

  it('does not depend on the order of the chunks', () => {
    const expected = [400, 500, 600, 700, 800]
    const shares = thinning(distance, expected, 1500)
    const order = [3, 0, 4, 2, 1]
    const shuffled = thinning(order.map((i) => distance[i]), order.map((i) => expected[i]), 1500)
    order.forEach((i, k) => expect(shuffled[k]).toBeCloseTo(shares[i], 9))
  })

  it('never reaches zero, even when the budget is below the minimal thinning', () => {
    const expected = [1000, 1000, 1000]
    const shares = thinning([0, 5000, 10_000], expected, 30)
    expect(shares.reduce((n, m, i) => n + m * expected[i], 0)).toBeCloseTo(30, 6)
    expect(Math.min(...shares)).toBeGreaterThan(0)
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
