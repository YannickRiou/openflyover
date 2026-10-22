import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildFilmClock } from '../film/clock'
import type { FilmCameraKey } from '../film/model'
import { PIN_AIM_RAISE, PIN_AIM_SHARE, PIN_APPROACH_S } from '../film/photoPins'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { DEFAULT_CAMERA } from './cameraSettings'
import { computeFilmView, type FilmViewOptions } from './filmCamera'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath } from './path'
import { aimTowardsPins, pinLocalPosition, type AimPin } from './pinAim'

const frame = createLocalFrame(6.85, 45.9)
/** ~4.4 km straight north at 1000 m */
const path = buildTrackPath(
  buildTrack({ name: 't', source: 'gpx', segments: [{ points: [{ lon: 6.85, lat: 45.88, ele: 1000 }, { lon: 6.85, lat: 45.92, ele: 1000 }] }] }),
)
const flat = () => 1000
const clockWith = (cameraKeys: FilmCameraKey[] = []) =>
  buildFilmClock({
    opening: { style: 'aucune', durationS: 0 },
    closing: { style: 'aucune', durationS: 0 },
    stops: [],
    cameraKeys,
    lengthM: path.lengthM,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
  })
const clock = clockWith()
const options: FilmViewOptions = { exaggeration: 1, liftM: 3, camera: { ...DEFAULT_CAMERA, cameraSmoothingS: 0 }, durationS: 60, aspect: 16 / 9 }
/** a pin 600 m east of the track, its photo on screen from 30 s to 36 s */
const pin: AimPin = { startS: 30, endS: 36, lon: 6.85 + 0.0076, lat: 45.9 }
const at = (t: number, pins?: readonly AimPin[], c = clock, extra: Partial<FilmViewOptions> = {}) =>
  computeFilmView(path, c, t, c.progressAtTime(t), frame, flat, { ...options, ...extra, pins })

describe('the camera turns towards a photo pin', () => {
  it('leaves the view alone without a pin, out of the photo\'s window, or with the setting off', () => {
    const plain = at(33)
    expect(at(33, []).target.distanceTo(plain.target)).toBe(0)
    expect(at(10, [pin]).target.distanceTo(at(10).target)).toBe(0)
    expect(at(60, [pin]).target.distanceTo(at(60).target)).toBe(0)
  })

  it('turns the aim, not the camera, towards the pin while its photo is on screen', () => {
    const plain = at(33)
    const turned = at(33, [pin])
    expect(turned.position.distanceTo(plain.position)).toBe(0)
    expect(turned.marker.distanceTo(plain.marker)).toBe(0)
    const foot = pinLocalPosition(pin, frame, flat, 1, 3, new Vector3())
    // towards the pin, by its share of the way (the raise aims a little above the foot)
    const shift = turned.target.clone().sub(plain.target)
    const wanted = foot.clone().sub(plain.target)
    expect(shift.dot(wanted)).toBeGreaterThan(0)
    expect(shift.length()).toBeGreaterThan(0.5 * PIN_AIM_SHARE * wanted.length())
    expect(shift.length()).toBeLessThan(PIN_AIM_SHARE * (wanted.length() + plain.position.distanceTo(foot) * PIN_AIM_RAISE) + 1e-6)
  })

  it('eases in over the approach, up to the pin\'s share', () => {
    const shifts = [30 - PIN_APPROACH_S, 30 - PIN_APPROACH_S / 2, 30].map((t) => at(t, [pin]).target.distanceTo(at(t).target))
    expect(shifts[0]).toBe(0)
    expect(shifts[1]).toBeGreaterThan(0)
    expect(shifts[2]).toBeGreaterThan(shifts[1])
  })

  it('gives a frame the same view whether or not earlier frames were computed', () => {
    const alone = at(32, [pin])
    for (let t = 0; t < 40; t += 0.5) at(t, [pin])
    const after = at(32, [pin])
    expect(after.target.toArray()).toEqual(alone.target.toArray())
    expect(after.position.toArray()).toEqual(alone.position.toArray())
  })

  it('is taken away by a camera key (a pose set by hand wins), and not applied in the shots of the opening and closing', () => {
    const key: FilmCameraKey = { id: 'camera-1', atM: path.lengthM * 0.5, distance: 1, pitchDeg: 30, headingOffsetDeg: 0 }
    const keyed = clockWith([key])
    const t = keyed.timeAtProgress(0.5)
    const inWindow: AimPin = { ...pin, startS: t - 1, endS: t + 5 }
    expect(at(t, [inWindow], keyed).target.distanceTo(at(t, undefined, keyed).target)).toBeLessThan(1e-6)
    const shot = buildFilmClock({
      opening: { style: 'descente', durationS: 6 },
      closing: { style: 'aucune', durationS: 0 },
      stops: [],
      lengthM: path.lengthM,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
    expect(at(3, [{ ...pin, startS: 0, endS: 8 }], shot).target.distanceTo(at(3, undefined, shot).target)).toBe(0)
  })

  it('aimTowardsPins returns the same view when no pin pulls or the strength is nil', () => {
    const view = at(10)
    expect(aimTowardsPins(view, [pin], 10, frame, flat, 1, 3)).toBe(view)
    expect(aimTowardsPins(view, [pin], 33, frame, flat, 1, 3, 0)).toBe(view)
  })
})
