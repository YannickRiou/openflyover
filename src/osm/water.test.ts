import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LonLat } from '../core/types'
import { buildTrack } from '../import/stats'
import { clearOverpassMemoryCache, type OverpassDeps } from './overpass'
import {
  MAX_LINE_LENGTH_M,
  WATER_LINE_MARGIN_M,
  WATER_MARGIN_M,
  fetchTrackWater,
  fetchTrackWaterShapes,
  isWaterLine,
  lineWidthM,
  taggedWidthM,
  parseWater,
  parseWaterLines,
  parseWaterShapes,
  pointInRing,
  ringAreaM2,
  runsOutside,
  stitchRings,
  waterLinesQuery,
  waterQuery,
  type WaterLine,
  type WaterPolygon,
} from './water'
import { corridorBoxes } from './overpass'

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

describe('waterQuery', () => {
  it('asks for water ways and multipolygons with their geometry, in a wide corridor', () => {
    const q = waterQuery(track)
    expect(q).toContain('way["natural"="water"]')
    expect(q).toContain('relation["waterway"="riverbank"]["type"="multipolygon"]')
    expect(q).toContain('out geom qt;')
    const south = Number(/\((-?[\d.]+),/.exec(q)![1])
    expect(south).toBeCloseTo(45.9 - WATER_MARGIN_M / M, 4)
  })
})

describe('rings', () => {
  it('stitches member ways end to end, in either direction, and drops what does not close', () => {
    const a: LonLat = { lon: 0, lat: 0 }
    const b: LonLat = { lon: 1, lat: 0 }
    const c: LonLat = { lon: 1, lat: 1 }
    const d: LonLat = { lon: 0, lat: 1 }
    const rings = stitchRings([[a, b], [c, b], [c, d, a], [{ lon: 5, lat: 5 }, { lon: 6, lat: 6 }]])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(rings[0][0]).toEqual(rings[0][4])
  })

  it('measures areas and tests points', () => {
    const ring = square(6.8, 45.9, 100)
    expect(ringAreaM2(ring)).toBeCloseTo(10_000, -1)
    expect(pointInRing({ lon: 6.8001, lat: 45.9001 }, ring)).toBe(true)
    expect(pointInRing({ lon: 6.79, lat: 45.9001 }, ring)).toBe(false)
  })
})

describe('parseWater', () => {
  const response = {
    elements: [
      { type: 'way', id: 1, tags: { natural: 'water', water: 'lake' }, geometry: square(6.8, 45.9, 300) },
      { type: 'way', id: 2, tags: { natural: 'water' }, geometry: square(6.81, 45.9, 20) },
      { type: 'way', id: 3, tags: { waterway: 'riverbank' }, geometry: square(6.82, 45.9, 100).slice(0, 4) },
      {
        type: 'relation',
        id: 4,
        tags: { type: 'multipolygon', natural: 'water', water: 'river' },
        members: [
          { type: 'way', ref: 10, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(0, 3) },
          { type: 'way', ref: 11, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(2) },
          { type: 'way', ref: 12, role: 'inner', geometry: square(6.833, 45.903, 100) },
          { type: 'node', ref: 13, role: '' },
        ],
      },
      { type: 'way', id: 10, tags: { natural: 'water' }, geometry: square(6.83, 45.9, 1000).slice(0, 3) },
    ],
  }

  it('keeps closed rings and multipolygons with their holes, largest first, drops small or open ones', () => {
    const polygons = parseWater(response)
    expect(polygons.map((p) => p.id)).toEqual(['relation/4', 'way/1'])
    const [river, lake] = polygons
    expect(river.kind).toBe('river')
    expect(river.holes).toHaveLength(1)
    expect(lake.kind).toBe('lake')
    // open rings, rounded to 1e-6°
    expect(lake.outer).toHaveLength(4)
    expect(lake.outer[0]).toEqual([6.8, 45.9])
  })

  it('throws on a server-side error', () => {
    expect(() => parseWater({ remark: 'runtime error: timeout', elements: [] })).toThrow()
    expect(() => parseWater({})).toThrow()
  })
})

describe('fetchTrackWater', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('queries once per track through the shared Overpass cache', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { natural: 'water' }, geometry: square(6.8, 45.9, 300) }] })))
    const deps: OverpassDeps = { fetch: fetch as unknown as OverpassDeps['fetch'], sleep: async () => {}, storage: null, now: () => 0 }
    const a = await fetchTrackWater(track, undefined, deps)
    const b = await fetchTrackWater(track, undefined, deps)
    expect(a).toHaveLength(1)
    expect(b).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

/** A line going east from (lon, lat), `n` points `stepM` metres apart, as Overpass geometry. */
function eastLine(lon: number, lat: number, n: number, stepM = 100): { lat: number; lon: number }[] {
  return Array.from({ length: n }, (_, i) => ({ lon: lon + (i * stepM) / K, lat }))
}

describe('waterLinesQuery', () => {
  it('asks for the coastline in the wide corridor and for the waterway lines in the narrow one', () => {
    const q = waterLinesQuery(track)
    expect(q).toContain('way["natural"="coastline"]')
    expect(q).toContain('way["waterway"="river"]')
    expect(q).toContain('way["waterway"="stream"]')
    expect(q).toContain('way["waterway"="canal"]')
    expect(q).toContain('out geom qt;')
    const souths = [...q.matchAll(/\((-?[\d.]+),/g)].map((m) => Number(m[1]))
    expect(Math.min(...souths)).toBeCloseTo(45.9 - WATER_MARGIN_M / M, 4)
    expect(souths.filter((v) => Math.abs(v - (45.9 - WATER_LINE_MARGIN_M / M)) < 1e-4)).toHaveLength(3)
  })
})

describe('line widths', () => {
  it('reads the width tag, clamped, and ignores what is not a number', () => {
    expect(taggedWidthM('25')).toBe(25)
    expect(taggedWidthM('8,5 m')).toBe(8.5)
    expect(taggedWidthM('wide')).toBeUndefined()
    expect(taggedWidthM(undefined)).toBeUndefined()
    expect(taggedWidthM('9000')).toBe(150)
    expect(taggedWidthM('0')).toBe(1)
  })

  it('takes the width of the kind when the line has none', () => {
    expect(lineWidthM({ kind: 'river' })).toBe(12)
    expect(lineWidthM({ kind: 'canal' })).toBe(8)
    expect(lineWidthM({ kind: 'stream' })).toBe(2.5)
    expect(lineWidthM({ kind: 'river', width: 30 })).toBe(30)
  })
})

describe('parseWaterLines', () => {
  it('keeps rivers, canals and streams, without tunnels, culverts or ways too short', () => {
    const lines = parseWaterLines([
      { type: 'way', id: 1, tags: { waterway: 'river' }, geometry: eastLine(6.8, 45.9, 10) },
      { type: 'way', id: 2, tags: { waterway: 'stream' }, geometry: eastLine(6.8, 45.91, 10) },
      { type: 'way', id: 3, tags: { waterway: 'stream', tunnel: 'culvert' }, geometry: eastLine(6.8, 45.92, 10) },
      { type: 'way', id: 4, tags: { waterway: 'drain' }, geometry: eastLine(6.8, 45.93, 10) },
      { type: 'way', id: 5, tags: { waterway: 'stream' }, geometry: eastLine(6.8, 45.94, 2, 10) },
      { type: 'node', id: 6, tags: { waterway: 'stream' } },
    ])
    expect(lines.map((l) => l.id)).toEqual(['way/1', 'way/2'])
    expect(lines.map(lineWidthM)).toEqual([12, 2.5])
    // the width of the kind is not stored: it is read when drawn
    expect(lines[0].width).toBeUndefined()
    // straight line simplified to its ends
    expect(lines[0].points).toHaveLength(2)
  })

  it('keeps the widest first when there is too much, up to the length cap', () => {
    const long = (id: number, lat: number, waterway: string) => ({
      type: 'way',
      id,
      tags: { waterway },
      geometry: eastLine(6, lat, 2, MAX_LINE_LENGTH_M * 0.6),
    })
    const lines = parseWaterLines([long(1, 45, 'stream'), long(2, 46, 'river'), long(3, 47, 'canal')])
    expect(lines.map((l) => l.id)).toEqual(['way/2'])
  })
})

describe('parseWaterShapes', () => {
  const boxes = corridorBoxes(track, WATER_MARGIN_M)

  it('turns the coastline into sea polygons on its right and keeps the stream lines', () => {
    const south = boxes[0].south
    const west = boxes[0].west
    const east = boxes[0].east
    const mid = (boxes[0].south + boxes[0].north) / 2
    const response = {
      elements: [
        // going east: the sea is to the south
        { type: 'way', id: 7, tags: { natural: 'coastline' }, geometry: [{ lon: west - 0.1, lat: mid }, { lon: east + 0.1, lat: mid }] },
        { type: 'way', id: 8, tags: { waterway: 'stream' }, geometry: eastLine(6.78, 45.9, 10) },
      ],
    }
    const shapes = parseWaterShapes(response, boxes)
    const seas = shapes.filter((s): s is WaterPolygon => !isWaterLine(s))
    expect(seas.length).toBeGreaterThan(0)
    expect(seas.every((s) => s.kind === 'sea')).toBe(true)
    expect(Math.min(...seas.flatMap((s) => s.outer.map((p) => p[1])))).toBeCloseTo(south, 5)
    expect(Math.max(...seas.flatMap((s) => s.outer.map((p) => p[1])))).toBeCloseTo(mid, 5)
    expect(shapes.filter(isWaterLine).map((l) => l.id)).toEqual(['way/8'])
  })

  it('draws no sea without a coastline', () => {
    expect(parseWaterShapes({ elements: [] }, boxes)).toEqual([])
  })

  it('throws on a server-side error', () => {
    expect(() => parseWaterShapes({ remark: 'runtime error: timeout', elements: [] }, boxes)).toThrow()
  })
})

describe('fetchTrackWaterShapes', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('is a second request per track, cached', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 8, tags: { waterway: 'river' }, geometry: eastLine(6.78, 45.9, 10) }] })))
    const deps: OverpassDeps = { fetch: fetch as unknown as OverpassDeps['fetch'], sleep: async () => {}, storage: null, now: () => 0 }
    const a = await fetchTrackWaterShapes(track, undefined, deps)
    expect(a).toHaveLength(1)
    expect(await fetchTrackWaterShapes(track, undefined, deps)).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('runsOutside', () => {
  const riverbank: WaterPolygon = {
    id: 'way/1',
    kind: 'river',
    outer: [[6.8, 45.899], [6.802, 45.899], [6.802, 45.901], [6.8, 45.901]],
    holes: [],
  }
  const line = (points: [number, number][]): WaterLine => ({ id: 'way/9', kind: 'river', points })

  it('leaves a line that no polygon covers as it is', () => {
    const l = line([[6.79, 45.9], [6.791, 45.9]])
    expect(runsOutside(l, [riverbank])).toEqual([l])
  })

  it('cuts out what a riverbank polygon already draws, keeping the first point inside so the ribbon reaches it', () => {
    const l = line([[6.79, 45.9], [6.795, 45.9], [6.801, 45.9], [6.805, 45.9], [6.81, 45.9]])
    const runs = runsOutside(l, [riverbank])
    expect(runs.map((r) => r.points.map((p) => p[0]))).toEqual([[6.79, 6.795, 6.801], [6.801, 6.805, 6.81]])
    expect(runs.map((r) => r.id)).toEqual(['way/9#0', 'way/9#1'])
  })

  it('drops a line entirely inside a polygon', () => {
    expect(runsOutside(line([[6.8005, 45.9], [6.801, 45.9]]), [riverbank])).toEqual([])
  })

  it('does not count a polygon hole as covered', () => {
    const lake: WaterPolygon = { ...riverbank, holes: [[[6.8005, 45.8995], [6.8015, 45.8995], [6.8015, 45.9005], [6.8005, 45.9005]]] }
    const l = line([[6.8, 45.9], [6.801, 45.9]])
    expect(runsOutside(l, [lake])).toHaveLength(1)
  })
})
