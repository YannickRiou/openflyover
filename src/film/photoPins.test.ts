import { describe, expect, it } from 'vitest'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import type { FilmMedia } from './model'
import { PIN_AIM_SHARE, PIN_MAX_FROM_MARKER_M, pinsMoveWithTime, PIN_APPROACH_S, PIN_RELEASE_S, photoPins, pinAimWeight, pinAims, pinLit } from './photoPins'

// a straight track along a parallel, 0.01° of longitude ≈ 775 m, 4 points: 0 – 2.3 km
const track = buildTrack({
  name: 'droite',
  source: 'gpx',
  segments: [{ points: [6.8, 6.81, 6.82, 6.83].map((lon) => ({ lon, lat: 45.9 })) }],
})
const path = buildTrackPath(track)
const clock = { progressAtTime: (t: number) => t / 100 }
const photo = (id: string, startS: number, kind: FilmMedia['kind'] = 'image'): FilmMedia =>
  ({ id, startS, durationS: 5, kind, src: `s-${id}`, layout: 'carte', anchor: 'bottom-right', size: 1, kenBurns: false }) as FilmMedia
const thumbed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`s-${id}`, { thumb: 'data:image/jpeg;base64,AA' }]))

describe('photoPins', () => {
  it('places each picture where the marker is when it appears, videos included', () => {
    const pins = photoPins([photo('a', 20), photo('b', 50, 'video'), photo('c', 150)], path, clock, thumbed('a', 'b', 'c'))
    expect(pins.map((p) => [p.id, Math.round(p.atM / path.lengthM * 100)])).toEqual([['a', 20], ['b', 50], ['c', 100]])
    expect(pins[0].lon).toBeCloseTo(6.8 + 0.03 * 0.2, 4)
    expect(pins[0].lat).toBeCloseTo(45.9, 4)
  })
  it('leaves out a medium without a thumbnail', () => {
    expect(photoPins([photo('a', 20), photo('b', 30)], path, clock, thumbed('b')).map((p) => p.id)).toEqual(['b'])
  })
  it('puts a geotagged photo at the track point nearest to where it was taken when that is near the marker', () => {
    const table = { 's-a': { thumb: 'data:image/jpeg;base64,AA', lon: 6.8301, lat: 45.9005 } }
    const [a] = photoPins([photo('a', 90)], path, clock, table)
    expect(a.atM).toBeCloseTo(path.lengthM, -1)
    expect(a.lon).toBeCloseTo(6.83, 3)
  })
  it('keeps a geotagged photo under the marker when its place is far from it (a loop or an out-and-back passes twice)', () => {
    const table = { 's-a': { thumb: 'data:image/jpeg;base64,AA', lon: 6.8301, lat: 45.9005 } }
    const [a] = photoPins([photo('a', 20)], path, clock, table)
    expect(a.atM).toBeCloseTo(path.lengthM * 0.2, -1)
    expect(Math.abs(path.lengthM - a.atM)).toBeGreaterThan(PIN_MAX_FROM_MARKER_M)
  })
  it('ignores a position too far from the track', () => {
    const table = { 's-a': { thumb: 'data:image/jpeg;base64,AA', lon: 7.5, lat: 45.9 } }
    const [a] = photoPins([photo('a', 20)], path, clock, table)
    expect(a.atM).toBeCloseTo(path.lengthM * 0.2, -1)
  })
  it('gives nothing without a track', () => {
    expect(photoPins([photo('a', 20)], { ...path, count: 0 }, clock, thumbed('a'))).toEqual([])
  })
})

describe('pin timing', () => {
  it('moves with the film time while the marker holds only with the setting on and a medium on the timeline', () => {
    expect(pinsMoveWithTime({ photoPins: true }, { media: [photo('a', 1)] })).toBe(true)
    expect(pinsMoveWithTime({ photoPins: false }, { media: [photo('a', 1)] })).toBe(false)
    expect(pinsMoveWithTime({ photoPins: true }, { media: [] })).toBe(false)
  })
  it('pulls nothing out of the window of the photo', () => {
    const [pin] = photoPins([photo('a', 40)], path, clock, thumbed('a'))
    expect(pinAims([pin], 40 - PIN_APPROACH_S)).toEqual([])
    expect(pinAims([pin], 45 + PIN_RELEASE_S)).toEqual([])
    expect(pinAims([pin], 41)).toHaveLength(1)
  })
  it('lights up while the photo is on screen only', () => {
    const pin = { startS: 20, endS: 25 }
    expect([19.9, 20, 24.9, 25].map((t) => pinLit(pin, t))).toEqual([false, true, true, false])
  })
  it('eases the aim in before the photo, holds it, eases out after', () => {
    const pin = { startS: 40, endS: 45 }
    expect(pinAimWeight(pin, 40 - PIN_APPROACH_S)).toBe(0)
    expect(pinAimWeight(pin, 40 - PIN_APPROACH_S / 2)).toBeCloseTo(0.5)
    expect(pinAimWeight(pin, 42)).toBe(1)
    expect(pinAimWeight(pin, 45 + PIN_RELEASE_S / 2)).toBeCloseTo(0.5)
    expect(pinAimWeight(pin, 45 + PIN_RELEASE_S)).toBe(0)
  })
  it('shares the pull between a pin being left and the next being approached', () => {
    const alone = photoPins([photo('a', 20), photo('b', 80)], path, clock, thumbed('a', 'b'))
    expect(pinAims(alone, 100)).toEqual([])
    expect(pinAims(alone, 22)).toEqual([{ pin: alone[0], share: PIN_AIM_SHARE }])
    const pins = photoPins([photo('a', 20), photo('b', 36)], path, clock, thumbed('a', 'b'))
    const both = pinAims(pins, 27)
    expect(both.map((x) => x.pin.id)).toEqual(['a', 'b'])
    expect(both.reduce((sum, x) => sum + x.share, 0)).toBeCloseTo(PIN_AIM_SHARE)
  })
})
