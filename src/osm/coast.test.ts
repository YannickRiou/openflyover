import { describe, expect, it } from 'vitest'
import type { LonLatBounds } from '../core/types'
import { MAX_COAST_POINTS, chainCoastWays, clipChainsToBoxes, reduceCoast, seaCells, seaPolygons, seaSide } from './coast'
import type { WaterPolygon } from './water'

type Pt = [number, number]

/** Area of a polygon in square degrees: outer minus holes. */
function area(polygon: WaterPolygon): number {
  const ring = (r: readonly Pt[]) => {
    let sum = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) sum += r[j][0] * r[i][1] - r[i][0] * r[j][1]
    return Math.abs(sum / 2)
  }
  return ring(polygon.outer) - polygon.holes.reduce((n, h) => n + ring(h), 0)
}
const total = (polygons: readonly WaterPolygon[]) => polygons.reduce((n, p) => n + area(p), 0)

/** 0.2° × 0.2° box around (0.1, 45). */
const box: LonLatBounds = { west: 0, south: 44.9, east: 0.2, north: 45.1 }

/** A coast going east along 45°N: the land is on its left (north), the sea south of it. */
const eastward: Pt[] = [[-0.1, 45], [0.3, 45]]

describe('seaPolygons', () => {
  it('keeps the water on the right of the coast, whatever its direction', () => {
    const south = seaPolygons([eastward], [box])
    expect(south).toHaveLength(1)
    expect(south[0].kind).toBe('sea')
    expect(total(south)).toBeCloseTo(0.2 * 0.1, 9)
    expect(south[0].outer.every(([, lat]) => lat <= 45)).toBe(true)
    const north = seaPolygons([[...eastward].reverse()], [box])
    expect(total(north)).toBeCloseTo(0.2 * 0.1, 9)
    expect(north[0].outer.every(([, lat]) => lat >= 45)).toBe(true)
  })

  it('closes the sea around a cape, a bay and several pieces of coast', () => {
    // a peninsula of land (0.1° wide, 0.04° tall) entering from the west edge: the sea is the rest of the cell
    const cape: Pt[] = [[-0.1, 45.02], [0.1, 45.02], [0.1, 45.06], [-0.1, 45.06]]
    expect(total(seaPolygons([cape], [box]))).toBeCloseTo(0.04 - 0.1 * 0.04, 9)
    // two separate coasts cut the cell in three: the sea is the middle strip
    const upper: Pt[] = [[-0.1, 45.05], [0.3, 45.05]]
    const lower: Pt[] = [[0.3, 44.95], [-0.1, 44.95]]
    const strip = seaPolygons([upper, lower], [box])
    expect(total(strip)).toBeCloseTo(0.2 * 0.1, 9)
  })

  it('makes an island a hole and a clockwise ring (a lagoon) a polygon of its own', () => {
    const island: Pt[] = [[0.05, 44.95], [0.1, 44.95], [0.1, 45], [0.05, 45], [0.05, 44.95]]
    const around = seaPolygons([island], [box])
    expect(around).toHaveLength(1)
    expect(around[0].holes).toHaveLength(1)
    expect(total(around)).toBeCloseTo(0.04 - 0.05 * 0.05, 9)
    const lagoon = [...island].reverse()
    const inside = seaPolygons([lagoon], [box])
    expect(total(inside)).toBeCloseTo(0.05 * 0.05, 9)
  })

  it('tells a cell without a coast from the side of the nearest one', () => {
    const southBox: LonLatBounds = { west: 0, south: 44.5, east: 0.2, north: 44.7 }
    const northBox: LonLatBounds = { west: 0, south: 45.3, east: 0.2, north: 45.5 }
    expect(total(seaPolygons([eastward], [southBox]))).toBeCloseTo(0.04, 9)
    expect(seaPolygons([eastward], [northBox])).toEqual([])
  })

  it('draws nothing without a coast, so a polder far from any sea stays land', () => {
    expect(seaPolygons([], [box])).toEqual([])
  })

  it('does not draw the corridor twice where its boxes overlap', () => {
    const next: LonLatBounds = { west: 0.1, south: 44.9, east: 0.3, north: 45.1 }
    const polygons = seaPolygons([eastward], [box, next])
    expect(total(polygons)).toBeCloseTo(0.3 * 0.1, 9)
    expect(seaCells([box, next])).toHaveLength(3)
  })

  it('falls back to the rectangle of the cell when the coast does not close there', () => {
    // the coast stops inside the cell: data cut off
    const broken: Pt[] = [[-0.1, 45], [0.1, 45]]
    const polygons = seaPolygons([broken], [box])
    expect(polygons).toHaveLength(1)
    expect(total(polygons)).toBeCloseTo(0.04, 9)
  })

  it('does not call a cell sea for an island standing in a lagoon', () => {
    const lagoon: Pt[] = [[0.02, 44.92], [0.02, 45.08], [0.18, 45.08], [0.18, 44.92], [0.02, 44.92]]
    const island: Pt[] = [[0.08, 44.98], [0.12, 44.98], [0.12, 45.02], [0.08, 45.02], [0.08, 44.98]]
    const polygons = seaPolygons([lagoon, island], [box])
    expect(polygons).toHaveLength(1)
    expect(polygons[0].holes).toHaveLength(1)
    expect(total(polygons)).toBeCloseTo(0.16 * 0.16 - 0.04 * 0.04, 9)
  })

  it('closes the sea where a single way leaves the cell and comes back in', () => {
    // east along 45°N, north out of the cell at 0.05, back along 45.2, south at 0.1: an inlet of sea between the two legs
    const inlet: Pt[] = [[-0.1, 45], [0.05, 45], [0.05, 45.2], [0.1, 45.2], [0.1, 45], [0.3, 45]]
    expect(total(seaPolygons([inlet], [box]))).toBeCloseTo(0.2 * 0.1 + 0.05 * 0.1, 9)
  })

  it('takes a vertex exactly on the edge of the cell as an exit, and a graze as an exit and an entry', () => {
    const onEdge: Pt[] = [[-0.1, 45], [0.2, 45], [0.3, 45]]
    const edge = seaPolygons([onEdge], [box])
    expect(edge).toHaveLength(1)
    expect(total(edge)).toBeCloseTo(0.2 * 0.1, 9)
    // up to the north edge at (0.1, 45.1) and down again: the sea is below the two slopes
    const graze: Pt[] = [[-0.1, 45], [0.1, 45.1], [0.3, 45]]
    expect(total(seaPolygons([graze], [box]))).toBeCloseTo(0.035, 9)
  })
})

describe('clipChainsToBoxes', () => {
  it('keeps the segments that cross a box, cut where the chain leaves it', () => {
    const chain: Pt[] = [[-1, 45], [-0.5, 45], [0.1, 45], [0.15, 45.05], [2, 45.05], [3, 45.05], [0.15, 44.95], [0.05, 44.95]]
    const pieces = clipChainsToBoxes([chain], [box])
    expect(pieces).toEqual([
      [[-0.5, 45], [0.1, 45], [0.15, 45.05], [2, 45.05]],
      [[3, 45.05], [0.15, 44.95], [0.05, 44.95]],
    ])
  })

  it('opens a closed ring at a gap, so no piece wraps around its first point', () => {
    const ring: Pt[] = [[0.1, 45], [0.15, 45], [0.15, 46], [-3, 46], [-3, 45], [0.1, 45]]
    const pieces = clipChainsToBoxes([ring], [box])
    expect(pieces).toHaveLength(1)
    expect(pieces[0][0]).toEqual([-3, 45])
    expect(pieces[0][pieces[0].length - 1]).toEqual([0.15, 46])
  })

  it('keeps a ring entirely inside as it is', () => {
    const ring: Pt[] = [[0.05, 44.95], [0.1, 44.95], [0.1, 45], [0.05, 44.95]]
    expect(clipChainsToBoxes([ring], [box])).toEqual([ring])
  })
})

describe('seaSide', () => {
  it('reads the side of a vertex from the two segments that meet there', () => {
    // a coast turning north at 0.1: its convex corner points to the sea at the south-east
    const corner: Pt[] = [[-0.1, 45], [0.1, 45], [0.1, 45.1]]
    expect(seaSide([corner], [0.2, 44.95])).toBe('sea')
    expect(seaSide([corner], [0, 45.05])).toBe('land')
    expect(seaSide([corner], [0.2, 45.2])).toBe('sea')
  })
})

describe('coast ways', () => {
  it('joins ways end to end in their direction only', () => {
    const a: Pt[] = [[0, 0], [1, 0]]
    const b: Pt[] = [[1, 0], [2, 0]]
    const c: Pt[] = [[2, 0], [3, 0]]
    expect(chainCoastWays([c, a, b])).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]])
    // b runs the other way: it does not continue a
    expect(chainCoastWays([a, [...b].reverse() as Pt[]])).toHaveLength(2)
  })

  it('closes a loop made of several ways', () => {
    const chains = chainCoastWays([[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 0]]])
    expect(chains).toHaveLength(1)
    expect(chains[0][0]).toEqual(chains[0][chains[0].length - 1])
  })

  it('simplifies the coast, coarser while it is too big', () => {
    const wavy: Pt[] = Array.from({ length: 3000 }, (_, i) => [i * 1e-4, 45 + 4e-5 * (i % 2) * (1 + (i % 7))])
    expect(reduceCoast([wavy])[0].length).toBeLessThanOrEqual(MAX_COAST_POINTS)
    const reduced = reduceCoast([wavy], 500)
    expect(reduced[0].length).toBeLessThanOrEqual(500)
    expect(reduced[0][0]).toEqual(wavy[0])
  })
})
