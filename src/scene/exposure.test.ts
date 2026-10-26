import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  autoExposureEv,
  DAYLIGHT_EXPOSURE,
  MARKER_LIGHT_FLOOR,
  markerLight,
  NEUTRAL_MARKER_LIGHT,
  nightFillIntensity,
  NIGHT_FILL_INTENSITY,
  sceneExposure,
  sunElevation,
} from './exposure'

const deg = (d: number) => (d * Math.PI) / 180

describe('sunElevation', () => {
  it('is the angle between the sun direction and the local horizon', () => {
    const up = new Vector3(0, 0, 1)
    expect(sunElevation(new Vector3(0, 0, 1), up)).toBeCloseTo(Math.PI / 2, 9)
    expect(sunElevation(new Vector3(1, 0, 0), up)).toBeCloseTo(0, 9)
    expect(sunElevation(new Vector3(Math.cos(deg(30)), 0, -Math.sin(deg(30))), up)).toBeCloseTo(deg(-30), 9)
  })
})

describe('autoExposureEv', () => {
  it('adds nothing in daylight and opens up through dusk to night', () => {
    expect(autoExposureEv(deg(45))).toBe(0)
    expect(autoExposureEv(deg(10))).toBe(0)
    expect(autoExposureEv(deg(2))).toBeCloseTo(1.5, 9)
    expect(autoExposureEv(deg(-6))).toBeCloseTo(3, 9)
    expect(autoExposureEv(deg(-12))).toBeCloseTo(4.5, 9)
    expect(autoExposureEv(deg(-18))).toBe(6)
    expect(autoExposureEv(deg(-60))).toBe(6)
  })

  it('never decreases while the sun goes down', () => {
    let previous = -Infinity
    for (let d = 30; d >= -30; d -= 0.5) {
      const ev = autoExposureEv(deg(d))
      expect(ev).toBeGreaterThanOrEqual(previous)
      previous = ev
    }
  })
})

describe('sceneExposure', () => {
  it('scales the daylight exposure by the automatic and user stops', () => {
    expect(sceneExposure(deg(40), 0)).toBe(DAYLIGHT_EXPOSURE)
    expect(sceneExposure(deg(40), 1)).toBe(DAYLIGHT_EXPOSURE * 2)
    expect(sceneExposure(deg(40), -2)).toBe(DAYLIGHT_EXPOSURE / 4)
    expect(sceneExposure(deg(-18), 0)).toBe(DAYLIGHT_EXPOSURE * 64)
  })
})

describe('nightFillIntensity', () => {
  it('is off while the sun is up and full from civil dusk', () => {
    expect(nightFillIntensity(deg(5))).toBe(0)
    expect(nightFillIntensity(deg(0))).toBe(0)
    expect(nightFillIntensity(deg(-3))).toBeCloseTo(NIGHT_FILL_INTENSITY / 2, 12)
    expect(nightFillIntensity(deg(-30))).toBe(NIGHT_FILL_INTENSITY)
  })

  it('« Clarté des nuits » adds stops at night only', () => {
    expect(nightFillIntensity(deg(5), 3)).toBe(0)
    expect(nightFillIntensity(deg(-30), 2)).toBe(NIGHT_FILL_INTENSITY * 4)
  })
})

describe('markerLight', () => {
  const clear = { sunScale: 1, skyScale: 1 }
  const at = (d: number, weather = clear) => markerLight(deg(d), weather)
  const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

  it('is neutral in daylight', () => {
    expect(at(45)).toEqual(NEUTRAL_MARKER_LIGHT)
    expect(at(20)).toEqual(NEUTRAL_MARKER_LIGHT)
  })

  it('warms at sunrise and sunset: red kept, blue most reduced', () => {
    const golden = at(5)
    const horizon = at(0)
    expect(golden.r).toBe(1)
    expect(golden.b).toBeLessThan(golden.g)
    expect(golden.g).toBeLessThan(golden.r)
    expect(horizon.b).toBeLessThan(golden.b)
    // still bright: a white ball stays a light cream
    expect(luminance(horizon)).toBeGreaterThan(0.7)
  })

  it('turns bluish and dimmer at night, but readable', () => {
    const night = at(-30)
    expect(night.b).toBeGreaterThan(night.r)
    expect(night.b).toBeGreaterThan(night.g)
    expect(luminance(night)).toBeLessThan(luminance(at(0)))
    expect(luminance(night)).toBeGreaterThan(0.4)
    expect(at(-8).b).toBeGreaterThan(at(-8).r)
  })

  it('goes from the warm to the blue tint without crossing a dull grey', () => {
    for (let degrees = 3; degrees >= -30; degrees -= 0.5) {
      const light = at(degrees)
      expect(Math.max(light.r, light.g, light.b) - Math.min(light.r, light.g, light.b), `${degrees}°`).toBeGreaterThan(0.1)
    }
  })

  it('changes gradually with the sun, with no jump and no channel under the floor', () => {
    let previous = at(90)
    for (let degrees = 90; degrees >= -60; degrees -= 0.25) {
      const light = at(degrees)
      for (const k of ['r', 'g', 'b'] as const) {
        expect(light[k]).toBeGreaterThanOrEqual(MARKER_LIGHT_FLOOR)
        expect(light[k]).toBeLessThanOrEqual(1)
        expect(Math.abs(light[k] - previous[k])).toBeLessThan(0.04)
      }
      previous = light
    }
  })

  it('keeps the floor under the worst weather, and loses its warmth under clouds', () => {
    const storm = { sunScale: 0.1, skyScale: 0.3 }
    for (const degrees of [-40, -14, -6, 0, 10, 60]) for (const k of ['r', 'g', 'b'] as const) expect(at(degrees, storm)[k]).toBeGreaterThanOrEqual(MARKER_LIGHT_FLOOR)
    expect(at(0, storm).b / at(0, storm).r).toBeGreaterThan(at(0).b / at(0).r)
    expect(luminance(at(60, storm))).toBeLessThan(1)
    expect(luminance(at(60, storm))).toBeGreaterThan(0.8)
    // never a dull dim marker: bright enough whatever the sun and the weather
    for (const degrees of [-40, -14, -6, 0, 10, 60]) expect(luminance(at(degrees, storm))).toBeGreaterThan(0.45)
  })
})
