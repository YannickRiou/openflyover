import { describe, expect, it } from 'vitest'
import { CENTRE_FADE, EDGE_FADE, buildRiverStrip, ribbonEdgeOffsets, stripHeights } from './riverStrip'

const M = 111_320
const LAT = 45.9
const K = Math.cos((LAT * Math.PI) / 180) * M

/** Points of a line going east from (6.8, 45.9), `n` points `stepM` metres apart. */
const east = (n: number, stepM: number): [number, number][] => Array.from({ length: n }, (_, i) => [6.8 + (i * stepM) / K, LAT])

const local = (strip: ReturnType<typeof buildRiverStrip>, v: number) => [(strip.lonLat[2 * v] - 6.8) * K, (strip.lonLat[2 * v + 1] - LAT) * M]

describe('buildRiverStrip', () => {
  it('is a ribbon of the given width around the line, three vertices per sample', () => {
    const strip = buildRiverStrip(east(3, 100), 12)
    // two 100 m pieces cut in two to stay under 60 m: 5 samples
    expect(strip.fade).toHaveLength(15)
    for (let i = 0; i < 5; i++) {
      const [left, centre, right] = [3 * i, 3 * i + 1, 3 * i + 2].map((v) => local(strip, v))
      expect(left[1] - right[1]).toBeCloseTo(12, 3)
      expect((left[1] + right[1]) / 2).toBeCloseTo(centre[1], 3)
      expect(left[0]).toBeCloseTo(centre[0], 3)
    }
  })

  it('fades from the middle to the banks', () => {
    const strip = buildRiverStrip(east(2, 50), 8)
    expect([...strip.fade.slice(0, 3)]).toEqual([EDGE_FADE, CENTRE_FADE, EDGE_FADE])
  })

  it('cuts long pieces so the ribbon can follow its valley', () => {
    const strip = buildRiverStrip(east(2, 500), 8, 60)
    expect(strip.fade.length / 3).toBe(Math.ceil(500 / 60) + 1)
  })

  it('has its triangles counter-clockwise in lon / lat (front face up) and covering width × length', () => {
    const strip = buildRiverStrip(east(2, 120), 10)
    let area = 0
    for (let t = 0; t < strip.index.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => local(strip, strip.index[t + k]))
      const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
      expect(signed).toBeGreaterThan(0)
      area += signed
    }
    expect(area).toBeCloseTo(10 * 120, 0)
  })

  it('mitres a bend without spiking', () => {
    const bend = buildRiverStrip([[6.8, LAT], [6.8 + 100 / K, LAT], [6.8 + 100 / K, LAT + 100 / M]], 10, 1000)
    const left = local(bend, 3)
    const right = local(bend, 5)
    // at the corner the banks are further than half a width from the line, never more than twice
    expect(Math.hypot(left[0] - 100, left[1])).toBeGreaterThan(5)
    expect(Math.hypot(left[0] - 100, left[1])).toBeLessThanOrEqual(10.01)
    expect(Math.hypot(right[0] - 100, right[1])).toBeLessThanOrEqual(10.01)
  })

  it('is empty for a line without length', () => {
    expect(buildRiverStrip([], 10).index).toHaveLength(0)
    expect(buildRiverStrip([[6.8, LAT], [6.8, LAT]], 10).index).toHaveLength(0)
  })
})

describe('stripHeights', () => {
  it('fills the gaps of the relief with the nearest known sample', () => {
    expect([...stripHeights([Number.NaN, 5, Number.NaN, Number.NaN, 9, Number.NaN])!]).toEqual([5, 5, 5, 5, 9, 9])
  })

  it('is null while no height is known', () => {
    expect(stripHeights([Number.NaN, Number.NaN])).toBeNull()
    expect(stripHeights([])).toBeNull()
  })
})

describe('ribbonEdgeOffsets', () => {
  it('gives each bank its offset from the middle vertex, and none to the middle', () => {
    const strip = buildRiverStrip(east(3, 60), 10, 60)
    const xz = Array.from({ length: strip.fade.length }, (_, v) => local(strip, v)).flat()
    const offsets = ribbonEdgeOffsets(xz)
    expect(offsets).toHaveLength(xz.length)
    for (let i = 0; i < xz.length / 6; i++) {
      expect(Array.from(offsets.slice(6 * i + 2, 6 * i + 4))).toEqual([0, 0])
      const [lx, lz, rx, rz] = [offsets[6 * i], offsets[6 * i + 1], offsets[6 * i + 4], offsets[6 * i + 5]]
      expect(Math.hypot(lx, lz)).toBeCloseTo(5, 3)
      expect(lx).toBeCloseTo(-rx, 4)
      expect(lz).toBeCloseTo(-rz, 4)
    }
  })
})
