import { describe, expect, it } from 'vitest'
import type { HeightGrid } from '../core/types'
import {
  DEFAULT_DEM_CLEAN,
  clampSeaToZero,
  cleanDem,
  isValidDemClean,
  removeSeaPillars,
  removeSeaSpikes,
  sameDemClean,
  withDemCleanDefaults,
} from './demClean'

function grid(width: number, height: number, fill: (x: number, y: number) => number): HeightGrid {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y)
  return { width, height, data }
}

const at = (g: HeightGrid, x: number, y: number) => g.data[y * g.width + x]

describe('removeSeaSpikes', () => {
  it('removes an isolated spike (and pit) over the sea', () => {
    const g = grid(7, 7, (x, y) => (x === 3 && y === 3 ? 600 : x === 5 && y === 1 ? -400 : 0))
    const out = removeSeaSpikes(g)
    expect(at(out, 3, 3)).toBe(0)
    expect(at(out, 5, 1)).toBe(0)
    expect(Array.from(out.data).every((h) => h === 0)).toBe(true)
  })

  it('removes a spike on the tile edge and does not modify its input', () => {
    const g = grid(5, 5, (x, y) => (x === 0 && y === 2 ? 800 : 2))
    const out = removeSeaSpikes(g)
    expect(at(out, 0, 2)).toBe(2)
    expect(at(g, 0, 2)).toBe(800)
  })

  it('keeps a mountain peak (high neighbourhood)', () => {
    const g = grid(9, 9, (x, y) => 1800 + 300 * Math.max(0, 3 - Math.hypot(x - 4, y - 4)))
    expect(Array.from(removeSeaSpikes(g).data)).toEqual(Array.from(g.data))
  })

  it('keeps a lone peak whose surroundings are above sea level', () => {
    const g = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 900 : 120))
    expect(at(removeSeaSpikes(g), 2, 2)).toBe(900)
  })

  it('keeps a coast: sea on one side, a steep land on the other', () => {
    const g = grid(8, 8, (x) => (x < 4 ? 0 : 400 + 20 * x))
    expect(Array.from(removeSeaSpikes(g).data)).toEqual(Array.from(g.data))
  })

  it('keeps the tip of a cape (a land pixel with land neighbours)', () => {
    const g = grid(7, 7, (x, y) => (x >= 3 && y >= 2 && y <= 4 ? 300 : 0))
    expect(Array.from(removeSeaSpikes(g).data)).toEqual(Array.from(g.data))
  })

  it('keeps a spike under the threshold, and leaves nodata alone', () => {
    const g = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 100 : 0))
    g.data[0] = NaN
    const out = removeSeaSpikes(g)
    expect(at(out, 2, 2)).toBe(100)
    expect(out.data[0]).toBeNaN()
  })
})

describe('removeSeaPillars', () => {
  /** a cone of `top` m and `radius` px at (cx, cy), over a sea at `sea` m */
  const cone = (size: number, cx: number, cy: number, top: number, radius: number, sea = 0) =>
    grid(size, size, (x, y) => Math.max(sea, top * (1 - Math.hypot(x - cx, y - cy) / radius)))

  it('lowers a pillar of many pixels to the sea around it (Mapterhorn, off Scandola: 1556 m, 533 px at z12)', () => {
    const g = cone(40, 20, 20, 1556, 13, -12) // 525 px above 20 m, 14.1 m per pixel
    // smooth flanks: the one-pixel filter keeps it whole
    expect(at(removeSeaSpikes(g), 20, 20)).toBe(1556)
    const out = removeSeaPillars(g, 14.1)
    expect(Math.max(...out.data)).toBeLessThanOrEqual(20)
    expect(at(out, 20, 20)).toBeCloseTo(at(out, 20, 8), 0) // the sea around its foot
    expect(at(g, 20, 20)).toBe(1556)
  })

  it('also lowers its part cut by the tile edge, and does not need the whole of it', () => {
    const out = removeSeaPillars(cone(30, 2, 15, 1100, 12), 14.1)
    expect(Math.max(...out.data)).toBeLessThanOrEqual(20)
  })

  it('keeps a real sea stack (Stac Lee, St Kilda: 172 m, 48 m from its heart to the sea)', () => {
    const g = grid(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 14 ? 172 : 0)) // 3.5 m per pixel
    expect(removeSeaPillars(g, 3.5)).toBe(g)
  })

  it('keeps islets under the threshold, cliffs and capes, mountains and nodata', () => {
    // a steep islet of 140 m, a 400 m cliff coast with a narrow 300 m cape
    const g = grid(40, 40, (x, y) =>
      Math.hypot(x - 6, y - 6) < 2 ? 140 : x >= 28 ? 400 : y >= 18 && y <= 21 && x >= 12 ? 300 : 0,
    )
    g.data[0] = NaN
    expect(removeSeaPillars(g, 14.1)).toBe(g)
    const mountain = grid(20, 20, (x, y) => 1800 + 300 * Math.max(0, 3 - Math.hypot(x - 10, y - 10)))
    expect(removeSeaPillars(mountain, 14.1)).toBe(mountain)
  })

  it('judges the steepness in metres: the same pixels are a pillar at z12 and a wide island at z8', () => {
    const g = cone(40, 20, 20, 600, 6)
    expect(Math.max(...removeSeaPillars(g, 14.1).data)).toBeLessThanOrEqual(20)
    expect(removeSeaPillars(g, 225)).toBe(g)
  })
})

describe('clampSeaToZero and cleanDem', () => {
  it('brings the negative heights to 0 and keeps nodata', () => {
    const g = clampSeaToZero({ width: 4, height: 1, data: Float32Array.of(-30, 0, 12, NaN) })
    expect(Array.from(g.data.slice(0, 3))).toEqual([0, 0, 12])
    expect(g.data[3]).toBeNaN()
  })

  it('does nothing while off, removes spikes when on, and clamps only on request', () => {
    const g = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 500 : -40))
    expect(cleanDem(g, DEFAULT_DEM_CLEAN)).toBe(g)
    const spikesOnly = cleanDem(g, { enabled: true, seaToZero: false })
    expect(at(spikesOnly, 2, 2)).toBe(-40)
    expect(at(cleanDem(g, { enabled: true, seaToZero: true }), 2, 2)).toBe(0)
    // seaToZero alone does not clean
    expect(cleanDem(g, { enabled: false, seaToZero: true })).toBe(g)
  })

  it('removes the pillars only when the ground width of the tile is known', () => {
    const g = grid(40, 40, (x, y) => Math.max(0, 1100 * (1 - Math.hypot(x - 20, y - 20) / 12)))
    const on = { enabled: true, seaToZero: true }
    expect(at(cleanDem(g, on), 20, 20)).toBe(1100)
    expect(at(cleanDem(g, on, 40 * 14.1), 20, 20)).toBe(0)
  })
})

describe('setting helpers', () => {
  it('defaults, validity and comparison', () => {
    expect(DEFAULT_DEM_CLEAN).toEqual({ enabled: false, seaToZero: false })
    expect(withDemCleanDefaults({ enabled: true })).toEqual({ enabled: true, seaToZero: false })
    expect(withDemCleanDefaults(undefined)).toEqual(DEFAULT_DEM_CLEAN)
    expect(isValidDemClean({ enabled: true, seaToZero: true })).toBe(true)
    expect(sameDemClean({ enabled: false, seaToZero: true }, DEFAULT_DEM_CLEAN)).toBe(true)
    expect(sameDemClean({ enabled: true, seaToZero: true }, { enabled: true, seaToZero: false })).toBe(false)
  })
})
