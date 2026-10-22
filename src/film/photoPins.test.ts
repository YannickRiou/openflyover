import { describe, expect, it } from 'vitest'
import type { TrackPath } from '../flyover/path'
import type { FilmMedia } from './model'
import { PIN_AIM_SHARE, PIN_APPROACH_S, PIN_RELEASE_S, pinAims, photoPins, pinAimWeight, pinLit } from './photoPins'

const path = { count: 2, lengthM: 1000 } as unknown as TrackPath
const clock = { progressAtTime: (t: number) => t / 100 }
const photo = (id: string, startS: number, kind: FilmMedia['kind'] = 'image'): FilmMedia =>
  ({ id, startS, durationS: 5, kind, src: `photo-${id}`, layout: 'carte', anchor: 'bottom-right', size: 1, kenBurns: false }) as FilmMedia

describe('photoPins', () => {
  it('places each picture where the marker is when it appears, videos left out', () => {
    const pins = photoPins([photo('a', 20), photo('b', 50, 'video'), photo('c', 150)], path, clock)
    expect(pins.map((p) => [p.id, p.atM])).toEqual([['a', 200], ['c', 1000]])
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
    const alone = photoPins([photo('a', 20), photo('b', 80)], path, clock)
    expect(pinAims(alone, 100)).toEqual([])
    expect(pinAims(alone, 22)).toEqual([{ pin: alone[0], share: PIN_AIM_SHARE }])
    const pins = photoPins([photo('a', 20), photo('b', 36)], path, clock)
    const both = pinAims(pins, 27)
    expect(both.map((x) => x.pin.id)).toEqual(['a', 'b'])
    expect(both.reduce((sum, x) => sum + x.share, 0)).toBeCloseTo(PIN_AIM_SHARE)
  })
})
