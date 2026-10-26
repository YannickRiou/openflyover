import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { buildFilmClock } from '../film/clock'
import type { FilmClockInput } from '../film/clock'
import type { FilmCameraKey, FilmShot, FilmStop, SituationFraming } from '../film/model'
import { situationTiming } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { centroid } from '../geo/lonLat'
import { buildTrack } from '../import/stats'
import type { HeightSampler } from '../scene/trackLineSet'
import { computeCameraView, MIN_GROUND_CLEARANCE_M } from './camera'
import { DEFAULT_CAMERA, DEFAULT_FOCAL_MM, focalDolly, fovDegOf, type CameraStyle } from './cameraSettings'
import {
  blendViews,
  computeFilmView,
  dayViewAt,
  lookAtView,
  recapViewAt,
  filmViewMovesWithTime,
  framedGroup,
  GROUP_FRAMING_MARGIN,
  groundReach,
  heldMotionTimeS,
  JUMP_S,
  keyedCamera,
  keyFramingAt,
  keyFramingFrom,
  keyView,
  markerAt,
  OVERVIEW_DISTANCE_FACTOR,
  OVERVIEW_PITCH_DEG,
  overviewDistanceM,
  overviewView,
  COUNTRY_DISTANCE_FACTOR,
  REGION_DISTANCE_FACTOR,
  REGION_FIT_MARGIN,
  REGION_MAX_DISTANCE_M,
  REGION_MIN_DISTANCE_M,
  REGION_PITCH_DEG,
  REGION_HIGHLIGHT_FADE,
  REGION_REACH_M,
  regionDistanceM,
  regionHighlightOpacity,
  regionView,
  shotBlend,
  SHOT_GLIDE_DEG,
  shotWeight,
  situationFramingOf,
  smootherstep,
  stopOrbitRad,
  STOP_WIDE_DISTANCE_FACTOR,
  SWEEP_DEG,
  SWEEP_SHARE,
  sweepRad,
  trackBox,
  turnedView,
  type FilmViewOptions,
} from './filmCamera'
import { hairpins, steepSampler } from './__fixtures__/markerVisible'
import { auditFilmCamera } from './filmAudit'
import { filmClockFor } from '../film/clock'
import { DEFAULT_DAY_CARDS, DEFAULT_FILM, RECAP_S } from '../film/model'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath, trackPathOf } from './path'
import { buildSequence } from './sequence'

const frame = createLocalFrame(6.85, 45.9)
/** ~4.4 km straight north at 1000 m */
const path = buildTrackPath(
  buildTrack({
    name: 't',
    source: 'gpx',
    segments: [{ points: [{ lon: 6.85, lat: 45.88, ele: 1000 }, { lon: 6.85, lat: 45.92, ele: 1000 }] }],
  }),
)
const flat = () => 1000
/**
 * without the smoothing in film time, the lead room and the bank (they follow the film's speed, `motionShares`), so the
 * views compare exactly with the flight camera (timeSmoothing.test.ts)
 */
const CAMERA = { ...DEFAULT_CAMERA, cameraSmoothingS: 0, leadRoomPct: 0, bankDeg: 0 }
const options: FilmViewOptions = { exaggeration: 1, liftM: 3, camera: CAMERA, durationS: 60, aspect: 16 / 9 }

const clockOf = (opening: FilmShot, closing: FilmShot, stops: FilmStop[] = [], cameraKeys: FilmCameraKey[] = []) =>
  buildFilmClock({
    opening,
    closing,
    stops,
    cameraKeys,
    lengthM: path.lengthM,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
  } satisfies FilmClockInput)

const flightAt = (progress: number, timeS: number) =>
  computeCameraView(path, progress, frame, flat, { ...options, timeS })

function expectSameView(a: { position: Vector3; target: Vector3 }, b: { position: Vector3; target: Vector3 }, tolerance = 1e-6) {
  expect(a.position.distanceTo(b.position)).toBeLessThan(tolerance)
  expect(a.target.distanceTo(b.target)).toBeLessThan(tolerance)
}

describe('easing', () => {
  it('smootherstep: 0 → 1, symmetric, flat ends', () => {
    expect(smootherstep(-1)).toBe(0)
    expect(smootherstep(0.5)).toBe(0.5)
    expect(smootherstep(2)).toBe(1)
    expect(smootherstep(0.01)).toBeLessThan(1e-4)
  })

  it('descente eases over the whole shot, saut moves in JUMP_S at the end of the opening / start of the closing', () => {
    expect(shotBlend('descente', 'opening', 3, 6)).toBe(0.5)
    expect(shotBlend('saut', 'opening', 6 - JUMP_S - 0.01, 6)).toBe(0)
    expect(shotBlend('saut', 'opening', 6 - JUMP_S / 2, 6)).toBeCloseTo(0.5, 12)
    expect(shotBlend('saut', 'closing', JUMP_S / 2, 4)).toBeCloseTo(0.5, 12)
    expect(shotBlend('saut', 'closing', JUMP_S, 4)).toBe(1)
    expect(shotBlend('saut', 'opening', 0.25, 0.5)).toBe(0.5)
  })

  it('cut: the wide view over the whole shot, the weight jumping at the boundary; « Enchaîné » is the shot blend', () => {
    for (const transition of ['coupe', 'fondu-noir', 'fondu-blanc'] as const) {
      const shot: FilmShot = { style: 'descente', durationS: 6, transition }
      for (const localS of [0, 3, 6 - 1e-9]) expect(shotWeight(shot, 'opening', localS, 6)).toBe(0)
      for (const localS of [0, 2.5, 5]) expect(shotWeight(shot, 'closing', localS, 5)).toBe(1)
    }
    for (const shot of [{ style: 'saut', durationS: 6 }, { style: 'saut', durationS: 6, transition: 'enchaine' }] as FilmShot[]) {
      for (const localS of [0, 5.6, 5.8, 6]) expect(shotWeight(shot, 'opening', localS, 6)).toBe(shotBlend('saut', 'opening', localS, 6))
    }
  })

  it('stop orbit: still at both ends of the window, out at the middle, bounded', () => {
    expect(stopOrbitRad(4, 0, 5.5)).toBe(0)
    expect(stopOrbitRad(4, 5.5, 5.5)).toBeCloseTo(0, 12)
    expect(stopOrbitRad(4, 2.75, 5.5)).toBeCloseTo((24 * Math.PI) / 180, 12)
    expect(stopOrbitRad(60, 30, 60)).toBeCloseTo((120 * Math.PI) / 180, 12)
  })
})

describe('overview', () => {
  const joined = flightAt(0, 0)

  it('frames the whole track from the side of the flight camera, farther for a tall frame', () => {
    const view = overviewView(path, frame, flat, 1, 16 / 9, joined)
    // centre of the track at ground height
    expect(view.target.x).toBeCloseTo(0, 0)
    expect(view.target.y).toBeCloseTo(frame.toLocal(6.85, 45.9, 1000).y, 0)
    const diagonal = path.lengthM
    expect(view.position.distanceTo(view.target)).toBeCloseTo(OVERVIEW_DISTANCE_FACTOR * diagonal, -1)
    // the chase camera of a northbound track is south of the marker: the overview too
    expect(view.position.z).toBeGreaterThan(view.target.z)
    const tall = overviewView(path, frame, flat, 1, 9 / 16, joined)
    expect(tall.position.distanceTo(tall.target)).toBeCloseTo((16 / 9) * view.position.distanceTo(view.target), 3)
  })

  it('blend: the end views exactly, geometric distance in between, never under the clearance', () => {
    const a = overviewView(path, frame, flat, 1, 16 / 9, joined)
    expect(blendViews(a, joined, 0, frame, flat, 1)).toBe(a)
    expect(blendViews(a, joined, 1, frame, flat, 1)).toBe(joined)
    const mid = blendViews(a, joined, 0.5, frame, flat, 1)
    const da = a.position.distanceTo(a.target)
    const db = joined.position.distanceTo(joined.target)
    expect(mid.position.distanceTo(mid.target)).toBeCloseTo(Math.sqrt(da * db), 3)
    const high = () => 1e9
    const low = { target: new Vector3(0, 0, 0), position: new Vector3(0, 10, 100) }
    const clamped = blendViews(low, { target: new Vector3(0, 0, 0), position: new Vector3(0, 20, 200) }, 0.5, frame, high, 1)
    const at = frame.toLonLat(clamped.position)
    expect(clamped.position.y).toBeCloseTo(frame.toLocal(at.lon, at.lat, 1e9 + MIN_GROUND_CLEARANCE_M).y, 0)
  })

  it('blend of opposite headings: the tilt goes straight from one to the other, the heading turns all along (no dive)', () => {
    // a region view from the south at 65°, a flight view from the north at 30°: the 3D blend went through the zenith
    const tilted = (headingDeg: number, tiltDeg: number, distance: number) => {
      const h = (headingDeg * Math.PI) / 180
      const t = (tiltDeg * Math.PI) / 180
      const back = new Vector3(-Math.sin(h) * Math.cos(t), Math.sin(t), Math.cos(h) * Math.cos(t))
      return { target: new Vector3(), position: back.multiplyScalar(distance) }
    }
    const region = tilted(0, 65, 50_000)
    const flight = tilted(170, 30, 2_000)
    let tilt = 65
    let heading = 0
    for (let k = 0.05; k < 1; k += 0.05) {
      const view = blendViews(region, flight, k, frame, null, 1)
      const back = view.position.clone().sub(view.target).normalize()
      const nextTilt = (Math.asin(back.y) * 180) / Math.PI
      const nextHeading = (Math.atan2(-back.x, back.z) * 180) / Math.PI
      expect(nextTilt).toBeLessThan(tilt)
      expect(nextHeading).toBeGreaterThan(heading)
      expect(nextHeading - heading).toBeLessThan(170 * 0.06)
      tilt = nextTilt
      heading = nextHeading
    }
  })
})

describe('region view (« Depuis la région »)', () => {
  const joined = flightAt(0, 0)
  const pitchDeg = (view: { position: Vector3; target: Vector3 }) => {
    const from = view.position.clone().sub(view.target)
    return (Math.asin(from.y / from.length()) * 180) / Math.PI
  }

  it('ground reach: the farthest frame corner on flat ground, as a camera of the scene sees it', () => {
    for (const [pitch, aspect] of [[REGION_PITCH_DEG, 16 / 9], [OVERVIEW_PITCH_DEG, 16 / 9], [REGION_PITCH_DEG, 9 / 16]]) {
      const camera = new PerspectiveCamera(50, aspect)
      camera.position.set(0, Math.sin((pitch * Math.PI) / 180), Math.cos((pitch * Math.PI) / 180))
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      let farthest = 0
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ray = new Vector3(x, y, 0.5).unproject(camera).sub(camera.position)
        const hit = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y)
        farthest = Math.max(farthest, hit.length())
      }
      expect(groundReach(pitch, aspect)).toBeCloseTo(farthest, 9)
    }
  })

  it('distance: ×8 the diagonal within 55–165 km, « Pays » farther, a region box filling the frame, within reach, never under the overview', () => {
    // start altitude of the region view: a short outing from the minimum, a medium one ×8 its diagonal, a long one capped
    expect(regionDistanceM(1_000, 300, 16 / 9)).toBeCloseTo(REGION_MIN_DISTANCE_M, 6)
    expect(regionDistanceM(10_000, 3_000, 16 / 9)).toBeCloseTo(REGION_DISTANCE_FACTOR * 10_000, 6)
    expect(regionDistanceM(50_000, 15_000, 16 / 9)).toBeCloseTo(REGION_MAX_DISTANCE_M, 6)
    expect(regionDistanceM(10_000, 3_000, 16 / 9, 'pays')).toBeCloseTo(COUNTRY_DISTANCE_FACTOR * REGION_DISTANCE_FACTOR * 10_000, 6)
    // a highlighted region: its larger side fills the frame height, with the margin
    const fitted = regionDistanceM(10_000, 3_000, 16 / 9, 'region', { widthM: 120_000, heightM: 80_000 })
    expect(fitted).toBeCloseTo((REGION_FIT_MARGIN * 120_000) / (2 * Math.tan((25 * Math.PI) / 180)), 6)
    // the frame reaches no farther than REGION_REACH_M beyond the track's box
    const far = regionDistanceM(10_000, 3_000, 16 / 9, 'pays', { widthM: 2_000_000, heightM: 1_000_000 })
    expect(far * groundReach(REGION_PITCH_DEG, 16 / 9)).toBeCloseTo(3_000 + REGION_REACH_M, 6)
    for (const [diagonal, halfSide, aspect] of [[100, 0, 16 / 9], [4_400, 0, 9 / 16], [300_000, 100_000, 1]]) {
      expect(regionDistanceM(diagonal, halfSide, aspect)).toBeGreaterThanOrEqual(overviewDistanceM(diagonal, aspect))
    }
  })

  it('the overview target and side, farther and steeper', () => {
    const overview = overviewView(path, frame, flat, 1, 16 / 9, joined)
    const region = regionView(path, frame, flat, 1, 16 / 9, joined)
    expect(region.target.distanceTo(overview.target)).toBeLessThan(1e-9)
    expect(region.position.distanceTo(region.target)).toBeCloseTo(regionDistanceM(path.lengthM, 0, 16 / 9), -1)
    expect(pitchDeg(region)).toBeCloseTo(REGION_PITCH_DEG, 6)
    expect(pitchDeg(overview)).toBeCloseTo(OVERVIEW_PITCH_DEG, 6)
    expect(region.position.z).toBeGreaterThan(region.target.z)
  })

  it('opening from the region view to the flight, closing back up to it, smooth and always closing in at 30 i/s', () => {
    const clock = clockOf({ style: 'situation', durationS: 8 }, { style: 'situation', durationS: 6 })
    expectSameView(computeFilmView(path, clock, 0, 0, frame, flat, options), regionView(path, frame, flat, 1, 16 / 9, flightAt(0, 0)))
    expectSameView(computeFilmView(path, clock, 8, 0, frame, flat, options), flightAt(0, 0))
    const end = computeFilmView(path, clock, clock.totalTime(), 1, frame, flat, options)
    expectSameView(end, regionView(path, frame, flat, 1, 16 / 9, flightAt(1, clock.flightS)))

    const range = (view: { position: Vector3; target: Vector3 }) => view.position.distanceTo(view.target)
    let previous = computeFilmView(path, clock, 0, 0, frame, flat, options)
    let previousStep = 0
    // the dive in 8 s from the region view (about 55 km up for this short track), frame by frame at 30 i/s
    const dive = range(previous)
    const meanStep = dive / (8 * 30)
    for (let t = 1 / 30; t <= 8; t += 1 / 30) {
      const view = computeFilmView(path, clock, t, 0, frame, flat, options)
      const step = view.position.distanceTo(previous.position)
      expect(range(view)).toBeLessThan(range(previous))
      // the eased dive peaks at 3 × its mean speed (688 m per frame for 55 km in 8 s), with no jolt between frames
      expect(step).toBeLessThan(3.2 * meanStep)
      expect(Math.abs(step - previousStep)).toBeLessThan(0.1 * meanStep)
      previous = view
      previousStep = step
    }
  })
})

describe('region highlight opacity', () => {
  const highlighted = { style: 'situation', durationS: 8, highlight: true } as const

  it('whole at the region view, gone during the dive, back up at the closing; none elsewhere or without the highlight', () => {
    const clock = clockOf(highlighted, { ...highlighted, durationS: 6 })
    const closingS = clock.openingS + clock.flightS
    expect(regionHighlightOpacity(clock, 0)).toBe(1)
    expect(regionHighlightOpacity(clock, 8)).toBe(0)
    expect(regionHighlightOpacity(clock, 30)).toBe(0)
    expect(regionHighlightOpacity(clock, clock.totalTime())).toBe(1)
    // fading by the share of the region view left: whole above REGION_HIGHLIGHT_FADE.to, gone below its `from`
    let previous = 1
    for (let t = 0; t <= 8; t += 0.1) {
      const k = shotWeight(clock.opening, 'opening', t, 8)
      const opacity = regionHighlightOpacity(clock, t)
      if (1 - k >= REGION_HIGHLIGHT_FADE.to) expect(opacity).toBe(1)
      if (1 - k <= REGION_HIGHLIGHT_FADE.from) expect(opacity).toBe(0)
      expect(opacity).toBeLessThanOrEqual(previous)
      previous = opacity
    }
    expect(regionHighlightOpacity(clock, closingS + 3)).toBeCloseTo(regionHighlightOpacity(clock, 8 - (8 * 3) / 6), 9)
    for (const shot of [{ style: 'situation', durationS: 8 }, { style: 'descente', durationS: 8, highlight: true }] as const) {
      expect(regionHighlightOpacity(clockOf(shot, shot), 0)).toBe(0)
    }
  })

  it('a cut keeps it whole until the cut', () => {
    const clock = clockOf({ ...highlighted, transition: 'coupe' }, { style: 'aucune', durationS: 5 })
    expect(regionHighlightOpacity(clock, 8 - 1e-6)).toBe(1)
    expect(regionHighlightOpacity(clock, 8)).toBe(0)
  })

  it('whole during the hold, fading during the push-in (and the other way at the closing)', () => {
    // 3 s held + 5 s of push-in: the push-in plays the curve of a 5 s shot without hold
    const held = { ...highlighted, holdS: 3 }
    const clock = clockOf(held, { ...held, durationS: 6 })
    const plain = clockOf({ ...highlighted, durationS: 5 }, { ...highlighted, durationS: 3 })
    for (let t = 0; t <= 3; t += 0.25) expect(regionHighlightOpacity(clock, t)).toBe(1)
    for (let t = 3; t <= 8; t += 0.25) expect(regionHighlightOpacity(clock, t)).toBeCloseTo(regionHighlightOpacity(plain, t - 3), 9)
    const closingS = clock.openingS + clock.flightS
    const plainClosingS = plain.openingS + plain.flightS
    for (let s = 0; s <= 3; s += 0.25) {
      expect(regionHighlightOpacity(clock, closingS + s)).toBeCloseTo(regionHighlightOpacity(plain, plainClosingS + s), 9)
    }
    for (let s = 3; s <= 6; s += 0.25) expect(regionHighlightOpacity(clock, closingS + s)).toBe(1)
  })
})

describe('situation timing', () => {
  it('no hold: today’s single move over the whole shot', () => {
    for (let s = 0; s <= 9; s += 0.5) {
      expect(shotBlend('situation', 'opening', s, 9, 0)).toBe(smootherstep(s / 9))
      expect(shotBlend('situation', 'opening', s, 9)).toBe(shotBlend('descente', 'opening', s, 9))
      expect(shotBlend('situation', 'closing', s, 9)).toBe(smootherstep(s / 9))
    }
  })

  it('opening: held, then the move over the rest; closing: the move, then held', () => {
    expect(shotBlend('situation', 'opening', 0, 9, 3)).toBe(0)
    expect(shotBlend('situation', 'opening', 3, 9, 3)).toBe(0)
    expect(shotBlend('situation', 'opening', 6, 9, 3)).toBeCloseTo(0.5, 12)
    expect(shotBlend('situation', 'opening', 9, 9, 3)).toBe(1)
    expect(shotBlend('situation', 'closing', 3, 9, 3)).toBeCloseTo(0.5, 12)
    expect(shotBlend('situation', 'closing', 6, 9, 3)).toBe(1)
    expect(shotBlend('situation', 'closing', 8, 9, 3)).toBe(1)
    // only the 'situation' style holds; a hold longer than the shot leaves a cut at its end
    expect(shotBlend('descente', 'opening', 3, 9, 3)).toBe(smootherstep(3 / 9))
    expect(shotBlend('situation', 'opening', 4, 5, 9)).toBe(0)
    expect(shotBlend('situation', 'opening', 5, 5, 9)).toBe(1)
    expect(situationTiming({ durationS: 9, holdS: 3 })).toEqual({ holdS: 3, moveS: 6 })
    expect(situationTiming({ durationS: 9 })).toEqual({ holdS: 0, moveS: 9 })
  })
})

describe('situation framing', () => {
  const joined = flightAt(0, 0)
  const view = (framing: SituationFraming) => regionView(path, frame, flat, 1, 16 / 9, joined, { framing })
  const back = (v: { position: Vector3; target: Vector3 }) => v.position.clone().sub(v.target)

  it('no field set: the automatic framing', () => {
    expectSameView(view({}), regionView(path, frame, flat, 1, 16 / 9, joined), 1e-9)
    expectSameView(view({ heading: 'libre' }), view({}), 1e-9)
  })

  it('tilt from the vertical, distance as chosen, compass bearing', () => {
    const v = view({ tiltDeg: 10, distanceKm: 30, heading: 'boussole', bearingDeg: 0 })
    const b = back(v)
    expect(b.length()).toBeCloseTo(30_000, 3)
    expect((Math.acos(b.y / b.length()) * 180) / Math.PI).toBeCloseTo(10, 6)
    // north up: the camera south of its target (+Z south), looking north
    expect(b.x).toBeCloseTo(0, 6)
    expect(b.z).toBeGreaterThan(0)
    // 90°: looking east, from the west
    const east = back(view({ heading: 'boussole', bearingDeg: 90 }))
    expect(east.x).toBeLessThan(0)
    expect(east.z).toBeCloseTo(0, 6)
    // the chosen distance stays within the reach of the terrain and above the overview
    const steep = back(view({ tiltDeg: 60, distanceKm: 400 })).length()
    expect(steep * groundReach(30, 16 / 9)).toBeCloseTo(REGION_REACH_M, -2)
    expect(back(view({ distanceKm: 5 })).length()).toBeCloseTo(overviewDistanceM(path.lengthM, 16 / 9), -1)
  })

  it('headroom: the target of the automatic view sits that share of the frame height below the middle', () => {
    const plain = view({ heading: 'boussole', bearingDeg: 30 })
    const v = view({ heading: 'boussole', bearingDeg: 30, headroomPct: 20 })
    const camera = new PerspectiveCamera(50, 16 / 9)
    camera.position.copy(v.position)
    camera.lookAt(v.target)
    camera.updateMatrixWorld()
    const ndc = plain.target.clone().project(camera)
    expect(ndc.x).toBeCloseTo(0, 6)
    expect(ndc.y).toBeCloseTo(-0.4, 6)
  })

  it('captured from a view: tilt, distance and bearing back', () => {
    const v = view({ tiltDeg: 30, distanceKm: 40, heading: 'boussole', bearingDeg: 120 })
    expect(situationFramingOf(v.position, v.target)).toEqual({ tiltDeg: 30, distanceKm: 40, bearingDeg: 120 })
    // straight above: tilt at its minimum; far: distance at its maximum
    const above = situationFramingOf(new Vector3(0, 1e6, 0), new Vector3())
    expect(above).toMatchObject({ tiltDeg: 1, distanceKm: 400 })
  })

  it('the film view frames the shot’s region view', () => {
    const shot = { style: 'situation', durationS: 8, tiltDeg: 20, heading: 'boussole', bearingDeg: 45 } as const
    const clock = clockOf(shot, { style: 'aucune', durationS: 5 })
    expectSameView(computeFilmView(path, clock, 0, 0, frame, flat, options), view(shot))
  })
})

describe('computeFilmView', () => {
  const descent = clockOf({ style: 'descente', durationS: 6 }, { style: 'descente', durationS: 5 })

  it('opening: the overview first, the flight view where the flight starts, the marker on the track', () => {
    const start = computeFilmView(path, descent, 0, 0, frame, flat, options)
    expectSameView(start, overviewView(path, frame, flat, 1, 16 / 9, flightAt(0, 0)))
    expect(start.marker.distanceTo(flightAt(0, 0).marker)).toBeLessThan(1e-9)
    const handOver = computeFilmView(path, descent, 6 - 1e-6, 0, frame, flat, options)
    expectSameView(handOver, flightAt(0, 0), 1e-3)
    expectSameView(computeFilmView(path, descent, 6, 0, frame, flat, options), flightAt(0, 0))
  })

  it('closing: from the flight view at the end to the overview', () => {
    const t = descent.openingS + descent.flightS
    expectSameView(computeFilmView(path, descent, t, 1, frame, flat, options), flightAt(1, descent.flightS))
    const end = computeFilmView(path, descent, descent.totalTime(), 1, frame, flat, options)
    expectSameView(end, overviewView(path, frame, flat, 1, 16 / 9, flightAt(1, descent.flightS)))
  })

  it('cut: the overview held until the flight starts, the flight view held until the closing, then the overview', () => {
    const clock = clockOf({ style: 'descente', durationS: 6, transition: 'fondu-noir' }, { style: 'descente', durationS: 5, transition: 'coupe' })
    const overview = overviewView(path, frame, flat, 1, 16 / 9, flightAt(0, 0))
    for (const t of [0, 3, 6 - 1e-6]) expectSameView(computeFilmView(path, clock, t, 0, frame, flat, options), overview)
    expectSameView(computeFilmView(path, clock, 6, 0, frame, flat, options), flightAt(0, 0))
    const closingS = clock.openingS + clock.flightS
    expectSameView(computeFilmView(path, clock, closingS - 1e-6, 1, frame, flat, options), flightAt(1, clock.flightS - 1e-6), 1e-2)
    const end = overviewView(path, frame, flat, 1, 16 / 9, flightAt(1, clock.flightS))
    for (const t of [closingS, closingS + 2.5, clock.totalTime()]) expectSameView(computeFilmView(path, clock, t, 1, frame, flat, options), end)
  })

  it('continuous over the whole film (no jump between frames at 30 i/s)', () => {
    const clock = clockOf({ style: 'saut', durationS: 3 }, { style: 'descente', durationS: 4 }, [
      { id: 's', atM: 2000, durationS: 6, camera: 'orbite' },
    ])
    let previous = computeFilmView(path, clock, 0, 0, frame, flat, options)
    for (let t = 1 / 30; t <= clock.totalTime(); t += 1 / 30) {
      const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, options)
      // the fastest motion: the 0.6 s jump from a ~7 km overview
      expect(view.position.distanceTo(previous.position)).toBeLessThan(1000)
      previous = view
    }
  })

  // E-W ridge 1.2 km behind the start of the track (the camera comes in from the south over it), 2500 m above the valley
  const ridge: HeightSampler = (lon, lat) => 1000 + 2500 * Math.exp(-(((frame.toLocal(lon, lat, 0).z - 3400) / 400) ** 2) / 2)

  it('shots clear the relief on the way: a high ridge on the approach, never a skim over it, nor a hidden aim', () => {
    const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'descente', durationS: 6 })
    const groundY = (p: Vector3) => {
      const at = frame.toLonLat(p)
      return frame.toLocal(at.lon, at.lat, ridge(at.lon, at.lat) ?? 0).y
    }
    const shots: [number, number][] = [[0, 6], [clock.openingS + clock.flightS, clock.totalTime()]]
    for (const [from, to] of shots) {
      for (let t = from + 0.6; t < to - 0.6; t += 0.1) {
        const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, ridge, options)
        const d = view.position.distanceTo(view.target)
        // above the ground under it by a share of its distance, not only by the flight's 80 m
        expect(view.position.y - groundY(view.position)).toBeGreaterThanOrEqual(Math.min(0.05 * d, 300))
        // and the aim is not hidden behind the ridge
        for (let f = 0.1; f <= 0.9; f += 0.1) {
          const p = view.position.clone().lerp(view.target, f)
          expect(p.y - groundY(p)).toBeGreaterThan(0)
        }
      }
    }
  })

  it('shots aimed across a ridge: no jolt at 30 i/s when the blended aim passes under the relief', () => {
    // the highlighted region's centre 40 km west, its plain at 400 m; a N-S ridge west of the track, over the way of the
    // aim, whose straight blend from the region’s ground to the track’s passes hundreds of metres under it
    const region = { centre: frame.toLonLat(new Vector3(-40_000, 0, 0)), widthM: 110_000, heightM: 83_000 }
    const opts = { ...options, region }
    for (const ridgeAt of [1500, 2500, 4000]) {
      const sample: HeightSampler = (lon, lat) => {
        const { x } = frame.toLocal(lon, lat, 0)
        const plain = x < -8000 ? 400 : x < -3000 ? 1000 - (600 * (-x - 3000)) / 5000 : 1000
        return plain + 1000 * Math.exp(-(((x + ridgeAt) / 700) ** 2) / 2)
      }
      for (const style of ['descente', 'situation', 'balayage'] as const) {
        const shot: FilmShot = { style, durationS: 9, highlight: true }
        const clock = clockOf(shot, shot)
        const closingS = clock.openingS + clock.flightS
        for (const [from, to] of [[0, clock.openingS], [closingS, clock.totalTime()]]) {
          const views = Array.from({ length: Math.round((to - from) * 30) + 1 }, (_, i) =>
            computeFilmView(path, clock, from + i / 30, clock.progressAtTime(from + i / 30), frame, sample, opts),
          )
          // change of the camera's and the aim's motion from one frame to the next, per metre of the camera's distance
          let jolt = 0
          for (let i = 1; i + 1 < views.length; i++) {
            const d = views[i].position.distanceTo(views[i].target)
            for (const k of ['position', 'target'] as const) {
              const change = views[i + 1][k].clone().sub(views[i][k]).sub(views[i][k].clone().sub(views[i - 1][k]))
              jolt = Math.max(jolt, change.length() / d)
            }
          }
          // a smooth dive: ~0.002 (0.06 to 0.11 when the camera rode 10× the aim's depth under the ridge)
          expect(jolt, `ridge ${ridgeAt} m, ${style}, ${from === 0 ? 'opening' : 'closing'}`).toBeLessThan(0.005)
        }
      }
    }
  })

  it('shots never dive far from the other view: no lower than a glide slope above it', () => {
    // a 220 km track: the overview is hundreds of km up, the flight view a few km from the start
    const long = buildTrackPath(
      buildTrack({ name: 'l', source: 'gpx', segments: [{ points: [{ lon: 5, lat: 45, ele: 1000 }, { lon: 7.8, lat: 45, ele: 1000 }] }] }),
    )
    const clock = buildFilmClock({
      opening: { style: 'descente', durationS: 6 },
      closing: { style: 'descente', durationS: 6 },
      stops: [],
      cameraKeys: [],
      lengthM: long.lengthM,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
    const flight = computeFilmView(long, clock, 6, 0, frame, flat, options)
    for (let t = 1; t <= 4.5; t += 0.25) {
      const view = computeFilmView(long, clock, t, 0, frame, flat, options)
      const away = Math.hypot(view.position.x - flight.position.x, view.position.z - flight.position.z)
      expect(view.position.y - flight.position.y).toBeGreaterThanOrEqual(away * Math.tan(SHOT_GLIDE_DEG * (Math.PI / 180)) - 1e-6)
    }
  })

  it('opening and closing, all along: above the ground, the tilt going one way between the end views, the marker in the frame', { timeout: 60_000 }, () => {
    const twisty = hairpins()
    const centre = centroid(twisty.bounds)
    const grounds = [
      { name: 'flat', path, frame, sample: flat as HeightSampler },
      { name: 'ridge', path, frame, sample: ridge },
      { name: 'massif', path: trackPathOf(twisty), frame: createLocalFrame(centre.lon, centre.lat), sample: steepSampler },
    ]
    const tiltDeg = (v: { position: Vector3; target: Vector3 }) => {
      const sight = v.target.clone().sub(v.position)
      return (-Math.asin(sight.y / sight.length()) * 180) / Math.PI
    }
    const camera = new PerspectiveCamera(50, 16 / 9)
    for (const g of grounds) {
      // « Planeur », « Poursuite », « Drone haut »
      for (const pitchDeg of [15, 30, 55]) {
        const opts = { ...options, camera: { ...CAMERA, pitchDeg } }
        for (const style of ['descente', 'saut', 'situation', 'balayage'] as const) {
          const shot: FilmShot = { style, durationS: 6 }
          const clock = buildFilmClock({
            opening: shot,
            closing: shot,
            stops: [],
            cameraKeys: [],
            lengthM: g.path.lengthM,
            highlightsM: [],
            durationS: 60,
            pacing: { ...DEFAULT_PACING, keepDuration: false },
          })
          const closingS = clock.openingS + clock.flightS
          for (const [from, to] of [[0, clock.openingS], [closingS, clock.totalTime()]]) {
            // 10 views a second
            const views = Array.from({ length: 61 }, (_, i) => {
              const t = from + ((to - from) * i) / 60
              return computeFilmView(g.path, clock, t, clock.progressAtTime(t), g.frame, g.sample, opts)
            })
            const up = tiltDeg(views[60]) >= tiltDeg(views[0])
            let lowest = Infinity
            let steadiest = tiltDeg(views[0])
            let backtrack = 0
            let offFrame = 0
            for (const view of views) {
              const at = g.frame.toLonLat(view.position)
              lowest = Math.min(lowest, view.position.y - g.frame.toLocal(at.lon, at.lat, g.sample(at.lon, at.lat) ?? 0).y)
              // the tilt never goes back: no dip toward the ground then recovery, nothing steeper than the end views
              const tilt = tiltDeg(view)
              steadiest = up ? Math.max(steadiest, tilt) : Math.min(steadiest, tilt)
              backtrack = Math.max(backtrack, Math.abs(tilt - steadiest))
              camera.position.copy(view.position)
              camera.lookAt(view.target)
              camera.updateMatrixWorld()
              const ndc = view.marker.clone().project(camera)
              const ahead = view.marker.clone().sub(view.position).dot(view.target.clone().sub(view.position)) > 0
              offFrame = Math.max(offFrame, ahead ? Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) : Infinity)
            }
            const label = `${g.name}, ${pitchDeg}°, ${style}, ${from === 0 ? 'opening' : 'closing'}`
            expect(lowest, label).toBeGreaterThanOrEqual(MIN_GROUND_CLEARANCE_M - 1)
            expect(backtrack, label).toBeLessThan(0.1)
            expect(offFrame, label).toBeLessThan(1)
          }
        }
      }
    }
  })

  it('stops: « orbite » turns around the held marker and comes back, « fixe » holds', () => {
    const stops: FilmStop[] = [
      { id: 'o', atM: 1000, durationS: 6, camera: 'orbite' },
      { id: 'f', atM: 3000, durationS: 6, camera: 'fixe' },
    ]
    const clock = clockOf({ style: 'aucune', durationS: 1 }, { style: 'aucune', durationS: 1 }, stops)
    const [orbit, fixed] = clock.stops
    const at = (t: number) => computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, options)
    const middle = (orbit.holdStartS + orbit.holdEndS) / 2
    const held = flightAt(orbit.progress, middle)
    expect(at(middle).target.distanceTo(held.target)).toBeLessThan(1e-9)
    expect(at(middle).position.distanceTo(held.position)).toBeGreaterThan(100)
    expectSameView(at(orbit.endS), flightAt(clock.progressAtTime(orbit.endS), orbit.endS))
    expectSameView(at(fixed.holdStartS + 1), at(fixed.holdEndS - 1))
  })

  it('moves with time: shots and orbiting stops, every stop when smoothed in time, the flight only for orbit / cinema', () => {
    const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'saut', durationS: 4 }, [
      { id: 'o', atM: 1000, durationS: 6, camera: 'orbite' },
      { id: 'f', atM: 3000, durationS: 6, camera: 'fixe' },
    ])
    const [orbit, fixed] = clock.stops
    const unsmoothed = (style: CameraStyle) => ({ ...CAMERA, style })
    expect(filmViewMovesWithTime(clock.stateAt(1), unsmoothed('chase'))).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(clock.totalTime()), unsmoothed('chase'))).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(orbit.holdStartS), unsmoothed('chase'))).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), unsmoothed('chase'))).toBe(false)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), DEFAULT_CAMERA)).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), { ...unsmoothed('chase'), endingS: 2 })).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), unsmoothed('orbit'))).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(40), { ...DEFAULT_CAMERA, style: 'sway' })).toBe(false)
  })
})

describe('computeFilmView — several tracks (follow)', () => {
  const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'aucune', durationS: 1 })
  /** ~2.2 km straight north, 2 km east of `path` */
  const other = buildTrackPath(
    buildTrack({
      name: 'o',
      source: 'gpx',
      segments: [{ points: [{ lon: 6.876, lat: 45.88, ele: 1000 }, { lon: 6.876, lat: 45.9, ele: 1000 }] }],
    }),
  )

  it('keeps the marker and the aim of a flight in the air, like the line', () => {
    const points = [{ lon: 6.85, lat: 45.88, ele: 1600 }, { lon: 6.85, lat: 45.92, ele: 1600 }]
    const flying = { ...buildTrackPath(buildTrack({ name: 'f', source: 'gpx', segments: [{ points }] })), flights: [{ startM: 0, endM: 5_000, offsetM: 0 }] }
    const air = frame.toLocal(6.85, 45.9, 1600 * 2 + 3).y
    expect(markerAt(flying, 0.5, frame, flat, 2, 3).y).toBeCloseTo(air, 3)
    const view = computeCameraView(flying, 0.5, frame, flat, { ...options, exaggeration: 2, timeS: 10 })
    expect(view.marker.y).toBeCloseTo(air, 3)
    expect(view.target.y).toBeGreaterThan(frame.toLocal(6.85, 45.9, 1500 * 2).y)
    // on the ground, the terrain wins as before
    const ground = frame.toLocal(6.85, 45.9, 1000 * 2 + 3).y
    expect(markerAt({ ...flying, flights: [] }, 0.5, frame, flat, 2, 3).y).toBeCloseTo(ground, 3)
  })

  it('flies the path the follow gives, the marker with it (a stage) or left on the film track (a racer)', () => {
    const t = clock.openingS + 10
    const stage = computeFilmView(path, clock, t, 0.3, frame, flat, { ...options, follow: () => ({ path: other, progress: 0.6 }) })
    const own = computeCameraView(other, 0.6, frame, flat, { ...options, timeS: 10 })
    expectSameView(stage, own)
    expect(stage.marker.distanceTo(own.marker)).toBeLessThan(1e-9)
    const racer = computeFilmView(path, clock, t, 0.3, frame, flat, { ...options, follow: () => ({ path: other, progress: 0.6, markerOnFilm: true }) })
    expectSameView(racer, own)
    expect(racer.marker.distanceTo(markerAt(path, 0.3, frame, flat, 1, 3))).toBeLessThan(1e-9)
    // the opening still starts on the overview of the film track, from the side of the followed view
    const start = computeFilmView(path, clock, 0, 0, frame, flat, { ...options, follow: () => ({ path: other, progress: 0 }) })
    expectSameView(start, overviewView(path, frame, flat, 1, 16 / 9, computeCameraView(other, 0, frame, flat, { ...options, timeS: 0 })))
  })

  it('frames a group: centred on it, far enough for its spread, never nearer than the flight view', () => {
    const view = flightAt(0.5, 10)
    const near = [
      { lon: 6.85, lat: 45.9 },
      { lon: 6.8501, lat: 45.9 },
    ]
    const close = framedGroup(view, near, frame, flat, 1, 16 / 9)
    expect(close.position.distanceTo(close.target)).toBeCloseTo(view.position.distanceTo(view.target), 6)
    const far = framedGroup(view, [{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }], frame, flat, 1, 16 / 9)
    const spread = frame.toLocal(6.9, 45.9, 1000).distanceTo(frame.toLocal(6.8, 45.9, 1000)) / 2
    expect(far.target.distanceTo(frame.toLocal(6.85, 45.9, 1000))).toBeLessThan(50)
    expect(far.position.distanceTo(far.target)).toBeGreaterThan(spread * GROUP_FRAMING_MARGIN)
    expect(framedGroup(view, near.slice(0, 1), frame, flat, 1, 16 / 9)).toBe(view)
  })
})

describe('camera keys', () => {
  const key = (id: string, atM: number, distance: number, pitchDeg: number, headingOffsetDeg = 0): FilmCameraKey => ({
    id,
    atM,
    distance,
    pitchDeg,
    headingOffsetDeg,
  })
  const keys = [key('camera-1', 1000, 2, 60), key('camera-2', 3000, 3, 70, 90)]
  const framing = (atM: number) => keyedCamera(DEFAULT_CAMERA, keys, atM, 500)

  it('the film settings far from the keys, each key at its place, eased in between', () => {
    expect(keyedCamera(DEFAULT_CAMERA, [], 1000, 500)).toBe(DEFAULT_CAMERA)
    expect(framing(400)).toEqual(DEFAULT_CAMERA)
    expect(framing(500)).toEqual(DEFAULT_CAMERA)
    expect(framing(750).distance).toBeCloseTo(1.5, 12)
    expect(framing(1000)).toEqual({ ...DEFAULT_CAMERA, distance: 2, pitchDeg: 60, headingOffsetDeg: 0 })
    expect(framing(2000)).toMatchObject({ distance: 2.5, pitchDeg: 65, headingOffsetDeg: 45 })
    expect(framing(3000)).toMatchObject({ distance: 3, pitchDeg: 70, headingOffsetDeg: 90 })
    expect(framing(3500)).toEqual(DEFAULT_CAMERA)
    // the style and the smoothing stay those of the film
    expect(keyedCamera({ ...DEFAULT_CAMERA, style: 'sway' }, keys, 2000, 500).style).toBe('sway')
  })

  it('no jerk: still at each key and at both ends of the eases', () => {
    const e = 1
    for (const atM of [500, 1000, 3000, 3500]) {
      for (const field of ['distance', 'pitchDeg', 'headingOffsetDeg'] as const) {
        const slope = (framing(atM + e)[field] - framing(atM - e)[field]) / (2 * e)
        expect(Math.abs(slope)).toBeLessThan(1e-4)
      }
    }
  })

  it('heading: the shorter way round', () => {
    const turn = [key('a', 0, 1, 30, 170), key('b', 1000, 1, 30, -170)]
    expect(keyedCamera(DEFAULT_CAMERA, turn, 500, 500).headingOffsetDeg).toBeCloseTo(180, 9)
  })

  it('the film view follows the keys (placed on the clock by position), a film without keys is unchanged', () => {
    const none = { style: 'aucune', durationS: 1 } as const
    const clock = clockOf(none, none, [], [key('camera-2', 3000, 3, 70), key('camera-1', 1000, 2, 60)])
    expect(clock.cameraKeys.map((k) => k.id)).toEqual(['camera-1', 'camera-2'])
    expect(clock.cameraKeys[0].timeS).toBeCloseTo(clock.timeAtProgress(1000 / path.lengthM), 9)
    const t = clock.timeAtProgress(1000 / path.lengthM)
    const keyed = computeFilmView(path, clock, t, 1000 / path.lengthM, frame, flat, options)
    const wanted = computeCameraView(path, 1000 / path.lengthM, frame, flat, { ...options, camera: { ...CAMERA, distance: 2, pitchDeg: 60 }, timeS: t })
    expectSameView(keyed, wanted)
    const plain = clockOf(none, none)
    expectSameView(computeFilmView(path, plain, 10, plain.progressAtTime(10), frame, flat, options), flightAt(plain.progressAtTime(10), 10))
  })

  it('continuous over a film with keys and every stop camera', () => {
    const none = { style: 'aucune', durationS: 1 } as const
    const clock = clockOf(
      none,
      none,
      [
        { id: 'o', atM: 800, durationS: 4, camera: 'orbite' },
        { id: 'l', atM: 1800, durationS: 4, camera: 'large' },
        { id: 'f', atM: 2600, durationS: 4, camera: 'fixe' },
        { id: 'c', atM: 3400, durationS: 4, camera: 'film' },
      ],
      [key('camera-1', 1500, 2.5, 70, 40), key('camera-2', 3000, 0.5, 15, -60)],
    )
    for (const style of ['chase', 'orbit'] as const) {
      const opts = { ...options, camera: { ...CAMERA, style } }
      let previous = computeFilmView(path, clock, 0, 0, frame, flat, opts)
      for (let t = 1 / 30; t <= clock.totalTime(); t += 1 / 30) {
        const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, opts)
        // the fastest move: the ease into the first key (600 m to 1.5 km away in 3 s)
        expect(view.position.distanceTo(previous.position)).toBeLessThan(50)
        previous = view
      }
    }
  })
})

describe('keyframes (« Images clés »): the view taken, exactly', () => {
  const none = { style: 'aucune', durationS: 1 } as const
  const hills = (lon: number, lat: number) => 1000 + 150 * Math.sin(lon * 400) * Math.cos(lat * 300)
  // a styled camera smoothed in time over relief: none of it moves the pose at the key
  const styled: FilmViewOptions = { ...options, camera: { ...DEFAULT_CAMERA, style: 'cinematic' } }
  const direction = (v: { position: Vector3; target: Vector3 }) => v.target.clone().sub(v.position).normalize()
  const DEG = Math.PI / 180

  it('a pose round-trips through its view, a stop widening and orbiting it included', () => {
    const base = { target: new Vector3(100, 1200, -50), reference: new Vector3(0.6, 0, -0.8), autoDistanceM: 800, wide: 0.4, orbitRad: 0.3 }
    const pose = { distance: 1.7, pitchDeg: 23.5, headingOffsetDeg: -131.2, aimRightM: 42, aimAheadM: -17 }
    const view = keyView(base, pose)
    const back = keyFramingFrom(base, view.position, view.target)
    for (const field of Object.keys(pose) as (keyof typeof pose)[]) expect(back[field]).toBeCloseTo(pose[field], 9)
    // a panned or refitted orbit looks at another point of the same line of sight: same pose
    const farther = keyFramingFrom(base, view.position, view.target.clone().lerp(view.position, -0.7))
    for (const field of Object.keys(pose) as (keyof typeof pose)[]) expect(farther[field]).toBeCloseTo(pose[field], 9)
  })

  it('the film shows the captured camera at the keyframe, eases in and out, and keeps the film camera away from it', () => {
    const plain = clockOf(none, none)
    const t = 20
    const p = plain.progressAtTime(t)
    const film = computeFilmView(path, plain, t, p, frame, hills, styled)
    // an orbited and panned 3D view
    const position = film.target.clone().add(new Vector3(-700, 450, 300))
    const lookAt = film.target.clone().add(new Vector3(30, 0, -20))
    const pose = keyFramingAt(path, plain, t, p, frame, hills, styled, position, lookAt)
    const clock = clockOf(none, none, [], [{ id: 'camera-1', atM: p * path.lengthM, ...pose }])
    const { timeS } = clock.cameraKeys[0]
    const viewAt = (c: typeof clock, s: number) => computeFilmView(path, c, s, c.progressAtTime(s), frame, hills, styled)
    const at = viewAt(clock, timeS)
    expect(at.position.distanceTo(position)).toBeLessThan(0.01)
    expect(direction(at).angleTo(lookAt.clone().sub(position).normalize()) / DEG).toBeLessThan(0.01)
    // the ease (3 s at the base speed) and beyond: the film's own camera
    expectSameView(viewAt(clock, timeS + 3.1), viewAt(plain, timeS + 3.1))
    expectSameView(viewAt(clock, timeS - 3.1), viewAt(plain, timeS - 3.1))
    // continuous: the ease covers the ~900 m to the taken view in 3 s
    let previous = viewAt(clock, timeS - 4)
    for (let s = timeS - 4; s <= timeS + 4; s += 1 / 30) {
      const view = viewAt(clock, s)
      expect(view.position.distanceTo(previous.position)).toBeLessThan(40)
      previous = view
    }
  })

  it('between two keyframes: each at its time, kept above the ground halfway', () => {
    const plain = clockOf(none, none)
    const take = (s: number, offset: Vector3) => {
      const p = plain.progressAtTime(s)
      const target = computeFilmView(path, plain, s, p, frame, hills, styled).target
      return { atM: p * path.lengthM, ...keyFramingAt(path, plain, s, p, frame, hills, styled, target.clone().add(offset), target) }
    }
    const clock = clockOf(none, none, [], [
      { id: 'camera-1', ...take(15, new Vector3(-400, 60, 0)) },
      { id: 'camera-2', ...take(35, new Vector3(400, 60, 0)) },
    ])
    for (const key of clock.cameraKeys) {
      const p = clock.progressAtTime(key.timeS)
      const view = computeFilmView(path, clock, key.timeS, p, frame, hills, styled)
      expect(view.position.distanceTo(computeFilmView(path, plain, key.timeS, p, frame, hills, styled).target)).toBeGreaterThan(300)
    }
    // halfway the pose swings over the target (heading eased the short way): above the relief there
    const middle = computeFilmView(path, clock, 25, clock.progressAtTime(25), frame, hills, styled)
    const below = frame.toLonLat(middle.position)
    expect(middle.position.y).toBeGreaterThan(frame.toLocal(below.lon, below.lat, hills(below.lon, below.lat)).y)
  })
})

describe("style 'free' (« Libre »): the keyframes alone", () => {
  const none = { style: 'aucune', durationS: 1 } as const
  const free: FilmViewOptions = { ...options, camera: { ...DEFAULT_CAMERA, style: 'free' } }
  const viewAt = (c: ReturnType<typeof clockOf>, s: number) => computeFilmView(path, c, s, c.progressAtTime(s), frame, flat, free)

  it('without keyframes: fixed on the whole track while the marker moves on', () => {
    const plain = clockOf(none, none)
    const early = viewAt(plain, 5)
    const late = viewAt(plain, 50)
    expectSameView(early, late)
    expect(early.marker.distanceTo(late.marker)).toBeGreaterThan(2000)
  })

  it('one keyframe: its captured view, held the whole film', () => {
    const plain = clockOf(none, none)
    const t = 20
    const p = plain.progressAtTime(t)
    const position = markerAt(path, p, frame, flat, 1, 3).add(new Vector3(-900, 500, 200))
    const lookAt = markerAt(path, 0.5, frame, flat, 1, 3)
    const pose = keyFramingAt(path, plain, t, p, frame, flat, free, position, lookAt)
    const clock = clockOf(none, none, [], [{ id: 'camera-1', atM: p * path.lengthM, ...pose }])
    for (const s of [2, t, 55]) {
      const view = viewAt(clock, s)
      expect(view.position.distanceTo(position)).toBeLessThan(0.01)
      expect(view.target.clone().sub(view.position).normalize().angleTo(lookAt.clone().sub(position).normalize())).toBeLessThan(1e-4)
    }
  })

  it('two keyframes: from one pose to the other, still at each', () => {
    const plain = clockOf(none, none)
    const take = (s: number, offset: Vector3) => {
      const p = plain.progressAtTime(s)
      const target = markerAt(path, p, frame, flat, 1, 3)
      return { atM: p * path.lengthM, ...keyFramingAt(path, plain, s, p, frame, flat, free, target.clone().add(offset), target) }
    }
    const clock = clockOf(none, none, [], [
      { id: 'camera-1', ...take(15, new Vector3(-600, 300, 0)) },
      { id: 'camera-2', ...take(40, new Vector3(600, 300, 0)) },
    ])
    const [a, b] = clock.cameraKeys
    expectSameView(viewAt(clock, 3), viewAt(clock, a.timeS), 1e-3)
    expectSameView(viewAt(clock, 58), viewAt(clock, b.timeS), 1e-3)
    let previous = viewAt(clock, a.timeS)
    for (let s = a.timeS; s <= b.timeS; s += 1 / 30) {
      const view = viewAt(clock, s)
      expect(view.position.distanceTo(previous.position)).toBeLessThan(15)
      previous = view
    }
  })

  it('keeps gliding from one keyframe to the next while the marker holds (timed by the film time)', () => {
    const keys = [
      { id: 'camera-1', atM: 0.2 * path.lengthM, distance: 1, pitchDeg: 30, headingOffsetDeg: -90 },
      { id: 'camera-2', atM: 0.8 * path.lengthM, distance: 1, pitchDeg: 30, headingOffsetDeg: 90 },
    ]
    const clock = clockOf(none, none, [], keys)
    const [a, b] = clock.cameraKeys
    // the same progress held, two film times: two views
    const p = clock.progressAtTime((a.timeS + b.timeS) / 2)
    const early = computeFilmView(path, clock, a.timeS + 1, p, frame, flat, free)
    const late = computeFilmView(path, clock, b.timeS - 1, p, frame, flat, free)
    expect(early.position.distanceTo(late.position)).toBeGreaterThan(100)
    expect(filmViewMovesWithTime(clock.stateAt(a.timeS + 1), free.camera!)).toBe(true)
  })
})

describe('stop cameras', () => {
  const none = { style: 'aucune', durationS: 1 } as const
  const stopsOf = (camera: FilmStop['camera']) => clockOf(none, none, [{ id: 's', atM: 2000, durationS: 6, camera }])
  const viewAt = (clock: ReturnType<typeof stopsOf>, t: number, style: 'chase' | 'orbit' = 'chase') =>
    computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, { ...options, camera: { ...CAMERA, style } })
  const distance = (view: { position: Vector3; target: Vector3 }) => view.position.distanceTo(view.target)

  it('« Vue large »: farther and higher at the middle, the flight view at both ends', () => {
    const wide = stopsOf('large')
    const plain = stopsOf('film')
    const [s] = wide.stops
    const middle = (s.startS + s.endS) / 2
    expect(distance(viewAt(wide, middle))).toBeCloseTo(STOP_WIDE_DISTANCE_FACTOR * distance(viewAt(plain, middle)), 0)
    expect(viewAt(wide, middle).position.y).toBeGreaterThan(viewAt(plain, middle).position.y)
    expectSameView(viewAt(wide, s.startS), viewAt(plain, s.startS))
    expectSameView(viewAt(wide, s.endS), viewAt(plain, s.endS))
    expect(filmViewMovesWithTime(wide.stateAt(middle), CAMERA)).toBe(true)
  })

  it('« Fixe » holds the orbit style, « Comme le film » lets it turn; both the same with the chase style', () => {
    const held = stopsOf('fixe')
    const plain = stopsOf('film')
    const [s] = held.stops
    expectSameView(viewAt(held, s.holdStartS + 0.1, 'orbit'), viewAt(held, s.holdEndS - 0.1, 'orbit'))
    expect(viewAt(plain, s.holdStartS + 0.1, 'orbit').position.distanceTo(viewAt(plain, s.holdEndS - 0.1, 'orbit').position)).toBeGreaterThan(10)
    expectSameView(viewAt(held, s.startS, 'orbit'), viewAt(plain, s.startS, 'orbit'))
    expectSameView(viewAt(held, s.endS, 'orbit'), viewAt(plain, s.endS, 'orbit'))
    expectSameView(viewAt(held, s.holdStartS + 1, 'chase'), viewAt(plain, s.holdStartS + 1, 'chase'))
  })

  it('held motion time: never backwards, the middle of the window during the hold', () => {
    const window = { startS: 10, holdStartS: 11.5, holdEndS: 14.5, endS: 16 }
    let previous = heldMotionTimeS(window, 9)
    expect(previous).toBe(9)
    for (let t = 9; t <= 17; t += 0.01) {
      const motion = heldMotionTimeS(window, t)
      expect(motion).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = motion
    }
    expect(heldMotionTimeS(window, 12)).toBe(13)
    expect(heldMotionTimeS(window, 16)).toBe(16)
  })
})

describe('balayage shot', () => {
  it('turns the overview first, then glides, and plays the closing backwards', () => {
    const L = 10
    expect(sweepRad('opening', 0, L)).toBeCloseTo((SWEEP_DEG * Math.PI) / 180)
    expect(sweepRad('opening', SWEEP_SHARE * L, L)).toBe(0)
    expect(shotBlend('balayage', 'opening', SWEEP_SHARE * L, L)).toBe(0)
    expect(shotBlend('balayage', 'opening', L, L)).toBe(1)
    expect(shotBlend('balayage', 'closing', 0, L)).toBe(0)
    expect(shotBlend('balayage', 'closing', (1 - SWEEP_SHARE) * L, L)).toBe(1)
    expect(sweepRad('closing', (1 - SWEEP_SHARE) * L, L)).toBe(0)
    expect(sweepRad('closing', L, L)).toBeCloseTo((SWEEP_DEG * Math.PI) / 180)
  })

  it('turns a view around the vertical through its target, keeping its distance and height', () => {
    const view = { target: new Vector3(10, 5, 0), position: new Vector3(110, 105, 0) }
    const turned = turnedView(view, Math.PI / 2)
    expect(turned.target).toEqual(view.target)
    expect(turned.position.distanceTo(view.target)).toBeCloseTo(view.position.distanceTo(view.target))
    expect(turned.position.y).toBeCloseTo(105)
    expect(turned.position.x).toBeCloseTo(10)
    expect(turnedView(view, 0)).toBe(view)
  })
})

describe('high view of the day during the night', () => {
  const HOUR = 3_600_000
  const DAY1 = Date.UTC(2026, 5, 1)
  // two days on the ridge-free valley: 20 km east in the day, a night, 8 km the next day
  const ride = (fromH: number, toH: number, lon0: number) => {
    const points = []
    for (let t = fromH * HOUR, k = 0; t <= toH * HOUR; t += HOUR / 2, k++) points.push({ lon: lon0 + k / 77.35, lat: 45.92, ele: 1000, time: DAY1 + t })
    return points
  }
  const day1 = ride(8, 18, 6.8)
  const day2 = ride(30, 34, day1[day1.length - 1].lon)
  const track = { ...buildTrack({ name: 'deux jours', source: 'gpx', segments: [{ points: day1 }, { points: day2 }] }), utcOffsetMin: 120 }
  const twoDays = trackPathOf(track)
  const where = createLocalFrame(6.9, 45.92)
  const clockOf = (view: boolean) =>
    filmClockFor({
      track,
      film: { ...DEFAULT_FILM, autoStops: false, opening: { style: 'descente', durationS: 6 }, closing: { style: 'descente', durationS: 6 }, dayCards: { ...DEFAULT_DAY_CARDS, enabled: true, view } },
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
  const opts: FilmViewOptions = { ...options, camera: { ...CAMERA, cameraSmoothingS: 0 } }

  it('up over the dusk, held over the night, down over the dawn; none without the option', () => {
    const clock = clockOf(true)
    const night = clock.nights[0]
    expect(dayViewAt(clock, night.startS - 0.1)).toBeNull()
    expect(dayViewAt(clock, night.endS + 0.1)).toBeNull()
    expect(dayViewAt(clock, night.startS)?.k).toBe(0)
    const middle = dayViewAt(clock, (night.startS + night.endS) / 2)
    expect(middle?.k).toBe(1)
    expect(middle?.day).toBe(clock.days[1])
    const up = Array.from({ length: 21 }, (_, i) => dayViewAt(clock, night.startS + ((night.holdStartS - night.startS) * i) / 20)?.k ?? -1)
    expect(up).toEqual([...up].sort((a, b) => a - b))
    expect(dayViewAt(clockOf(false), (night.startS + night.endS) / 2)).toBeNull()
  })

  it('the camera frames the route of the day at the middle of the night, and is the flight camera outside it', () => {
    const clock = clockOf(true)
    const night = clock.nights[0]
    const at = (t: number) => computeFilmView(twoDays, clock, t, clock.progressAtTime(t), where, flat, opts)
    const flight = at(night.startS - 1)
    const high = at((night.startS + night.endS) / 2)
    // far above the flight camera, looking at the middle of the next day's route
    expect(high.position.y).toBeGreaterThan(flight.position.y + 1500)
    const second = clock.days[1]
    const route = trackBox(twoDays, where, { fromM: second.startM, toM: second.endM })
    expect(high.target.x).toBeGreaterThan(route.minX)
    expect(high.target.x).toBeLessThan(route.maxX)
    // the camera before and after the pause is the one without the option
    const plain = clockOf(false)
    expectSameView(at(night.startS - 1), computeFilmView(twoDays, plain, night.startS - 1, plain.progressAtTime(night.startS - 1), where, flat, opts))
  })

  it('no jolt nor loss of the marker through the night, at 30 i/s', () => {
    const clock = clockOf(true)
    const night = clock.nights[0]
    const issues = auditFilmCamera(twoDays, clock, where, flat, opts, { fromS: night.startS - 2, toS: night.endS + 2 })
    expect(issues).toEqual([])
  })
  describe('« À la suite »: the night between two stages', () => {
    const stage = (name: string, points: typeof day1) => ({ ...buildTrack({ name, source: 'gpx', segments: [{ points }] }), utcOffsetMin: 120 })
    const sequence = buildSequence([stage('j1', day1), stage('j2', day2)])
    const path = trackPathOf(sequence.track)
    const sequenceClockOf = (recap: boolean, night = true) =>
      filmClockFor({
        track: sequence.track,
        film: { ...DEFAULT_FILM, autoStops: false, opening: { style: 'descente', durationS: 6 }, closing: { style: 'descente', durationS: 6 }, junctionDefault: { kind: 'fondu-noir', holdS: 1.5, card: true, night, recap } },
        durationS: 60,
        pacing: { ...DEFAULT_PACING, keepDuration: false },
        cutsM: sequence.cutsM,
        stageIds: sequence.stageIds,
      })

    it('« Revoir l’étape finie » over the night: the camera rises over the stage just finished; none without it', () => {
      const clock = sequenceClockOf(true)
      const [junction] = clock.junctions
      expect(junction).toMatchObject({ kind: 'nuit', view: true })
      const middle = dayViewAt(clock, (junction.startS + junction.endS) / 2)
      expect(middle).toMatchObject({ fromM: 0, toM: junction.atM, k: 1 })
      expect(dayViewAt(clock, junction.startS - 0.1)).toBeNull()
      expect(dayViewAt(sequenceClockOf(false), (junction.startS + junction.endS) / 2)).toBeNull()
      const at = (t: number) => computeFilmView(path, clock, t, clock.progressAtTime(t), where, flat, opts)
      const high = at((junction.startS + junction.endS) / 2)
      expect(high.position.y).toBeGreaterThan(at(junction.startS - 1).position.y + 1500)
      const route = trackBox(path, where, { fromM: 0, toM: junction.atM })
      expect(high.target.x).toBeGreaterThan(route.minX)
      expect(high.target.x).toBeLessThan(route.maxX)
    })

    it('« Revoir l’étape finie » without the night: a pause before the cut, the camera up over the stage until the fade', () => {
      const clock = sequenceClockOf(true, false)
      const [junction] = clock.junctions
      expect(junction.kind).toBe('fondu-noir')
      const recap = junction.recap!
      expect(recap.durationS).toBe(RECAP_S)
      // the pause comes before the junction and lengthens the film by as much
      expect(recap.endS).toBeLessThanOrEqual(junction.holdStartS)
      expect(clock.totalTime()).toBeCloseTo(sequenceClockOf(false, false).totalTime() + RECAP_S, 1)
      // the marker is still on the stage that ends
      expect(clock.progressAtTime(recap.holdStartS + 1) * path.lengthM).toBeLessThan(junction.atM)
      expect(recapViewAt(clock, recap.startS - 0.1)).toBeNull()
      expect(recapViewAt(clock, recap.holdStartS + 3)).toMatchObject({ fromM: 0, toM: junction.atM, k: 1 })
      expect(recapViewAt(clock, junction.holdStartS + 0.01)).toBeNull()
      const at = (t: number) => computeFilmView(path, clock, t, clock.progressAtTime(t), where, flat, opts)
      expect(at(recap.holdStartS + 3).position.y).toBeGreaterThan(at(recap.startS - 1).position.y + 1500)
      expect(sequenceClockOf(false, false).junctions[0].recap).toBeUndefined()
      // no jolt nor loss of the marker on the way up and while it holds, at 30 i/s
      expect(auditFilmCamera(path, clock, where, flat, opts, { fromS: recap.startS - 2, toS: junction.holdStartS - 0.1 })).toEqual([])
    })

    it('no jolt nor loss of the marker through the night, at 30 i/s', () => {
      const clock = sequenceClockOf(true)
      const [junction] = clock.junctions
      expect(auditFilmCamera(path, clock, where, flat, opts, { fromS: junction.startS - 2, toS: junction.endS + 2 })).toEqual([])
    })
  })
})

describe('« Bilan »: the camera holds the high view of the region', () => {
  // two outings of one region (a few km apart), the marker on the second
  const other = buildTrackPath(
    buildTrack({ name: 'u', source: 'gpx', segments: [{ points: [{ lon: 6.9, lat: 45.9, ele: 1100 }, { lon: 6.9, lat: 45.95, ele: 1100 }] }] }),
  )
  const region = buildTrackPath(
    buildTrack({
      name: 'region',
      source: 'gpx',
      segments: [
        { points: [{ lon: 6.85, lat: 45.88, ele: 1000 }, { lon: 6.85, lat: 45.92, ele: 1000 }] },
        { points: [{ lon: 6.9, lat: 45.9, ele: 1100 }, { lon: 6.9, lat: 45.95, ele: 1100 }] },
      ],
    }),
  )
  const clock = clockOf({ style: 'descente', durationS: 5 }, { style: 'situation', durationS: 4 })
  const held = (progress: number, stagePath = other) => ({ path: stagePath, progress, overview: region })
  const north = { target: new Vector3(), position: new Vector3(0, 0, 1) }

  it('is the overview of the region, north up, wherever the marker, the shot or the camera style', () => {
    const wanted = overviewView(region, frame, flat, 1, 16 / 9, north)
    for (const [timeS, progress] of [[0, 0], [2, 0], [8, 0.3], [20, 0.9], [clock.totalTime(), 1]]) {
      const view = computeFilmView(path, clock, timeS, progress, frame, flat, { ...options, follow: () => held(0.5) })
      expectSameView(view, wanted)
    }
    for (const style of ['orbit', 'free', 'suivi'] as CameraStyle[]) {
      expectSameView(computeFilmView(path, clock, 8, 0.3, frame, flat, { ...options, camera: { ...CAMERA, style }, follow: () => held(0.5) }), wanted)
    }
    // the camera stands south of what it frames, above it
    expect(wanted.position.z).toBeGreaterThan(wanted.target.z)
    const back = wanted.position.clone().sub(wanted.target)
    expect((Math.asin(back.y / back.length()) * 180) / Math.PI).toBeCloseTo(OVERVIEW_PITCH_DEG, 6)
  })

  it('shows the whole region: its box centre is the target', () => {
    const box = trackBox(region, frame)
    const view = computeFilmView(path, clock, 8, 0.3, frame, flat, { ...options, follow: () => held(0.5) })
    expect(view.target.x).toBeCloseTo((box.minX + box.maxX) / 2, -1)
    expect(view.target.z).toBeCloseTo((box.minZ + box.maxZ) / 2, -1)
  })

  it('puts the marker on the outing being drawn', () => {
    const at = (progress: number) => computeFilmView(path, clock, 8, 0.3, frame, flat, { ...options, follow: () => held(progress) }).marker
    expect(at(0).distanceTo(markerAt(other, 0, frame, flat, 1, 3))).toBeLessThan(1e-9)
    expect(at(1).distanceTo(markerAt(other, 1, frame, flat, 1, 3))).toBeLessThan(1e-9)
    expect(at(1).distanceTo(at(0))).toBeGreaterThan(1000)
  })

  it('flies the stage as ever without an overview', () => {
    const wanted = overviewView(region, frame, flat, 1, 16 / 9, north)
    const flown = computeFilmView(path, clock, 8, 0.3, frame, flat, { ...options, follow: () => ({ path: other, progress: 0.5 }) })
    expect(flown.position.distanceTo(wanted.position)).toBeGreaterThan(1000)
    expect(flown.target.distanceTo(markerAt(other, 0.5, frame, flat, 1, 3))).toBeLessThan(1000)
  })
})

describe('« Focale »: the lens changes the perspective, not the size of what is framed', () => {
  const FOCALS = [18, 26, 50, 85, 135]
  const withLens = (focalMm: number): FilmViewOptions => ({ ...options, camera: { ...CAMERA, focalMm } })
  const tanHalf = (focalMm: number) => Math.tan((fovDegOf(focalMm) * Math.PI) / 360)
  /** distance × tan(fov / 2): what the frame height covers at the target, the same whatever the lens when the size is kept */
  const coverage = (v: { position: Vector3; target: Vector3 }, focalMm: number) => v.position.distanceTo(v.target) * tanHalf(focalMm)
  const hills = (lon: number, lat: number) => 1000 + 150 * Math.sin(lon * 400) * Math.cos(lat * 300)

  it('the default lens is today\'s 50° field of view, exactly, and does not move the camera', () => {
    expect(fovDegOf(DEFAULT_FOCAL_MM)).toBe(50)
    expect(focalDolly(DEFAULT_FOCAL_MM)).toBe(1)
    expect(fovDegOf(18)).toBeGreaterThan(fovDegOf(26))
    expect(fovDegOf(135)).toBeLessThan(fovDegOf(26))
    expectSameView(computeCameraView(path, 0.5, frame, flat, { ...withLens(26), timeS: 5 }), computeCameraView(path, 0.5, frame, flat, { ...options, timeS: 5 }), 1e-12)
  })

  it('the marker keeps its size on the screen: a 10 m post at the marker spans the same height with any lens', () => {
    const heights = FOCALS.map((focalMm) => {
      const v = computeCameraView(path, 0.5, frame, hills, { ...withLens(focalMm), timeS: 20 })
      const lens = new PerspectiveCamera(fovDegOf(focalMm), 16 / 9, 1, 5e6)
      lens.position.copy(v.position)
      lens.lookAt(v.target)
      lens.updateMatrixWorld(true)
      lens.updateProjectionMatrix()
      const foot = v.marker.clone().project(lens)
      const top = v.marker.clone().add(new Vector3(0, 10, 0)).project(lens)
      return top.y - foot.y
    })
    for (const h of heights) expect(h / heights[1]).toBeGreaterThan(0.97)
    for (const h of heights) expect(h / heights[1]).toBeLessThan(1.03)
  })

  it('every style stands farther with a telephoto, closer with a wide angle, by the same factor (after the distance clamp)', () => {
    for (const style of ['chase', 'sway', 'orbit', 'top', 'cinematic'] as CameraStyle[]) {
      const distance = (focalMm: number) => {
        const v = computeCameraView(path, 0.5, frame, flat, { ...options, camera: { ...CAMERA, style, focalMm }, timeS: 20 })
        return v.position.distanceTo(v.target)
      }
      for (const focalMm of FOCALS) expect(distance(focalMm) / distance(26)).toBeCloseTo(focalDolly(focalMm), 2)
    }
  })

  it('the overview, the region view and a group keep their framing with a telephoto; a wide angle leaves the wide views where they are', () => {
    const joined = flightAt(0.5, 10)
    const group = [{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }]
    const box = { widthM: 120_000, heightM: 80_000 }
    const spread = frame.toLocal(6.9, 45.9, 1000).distanceTo(frame.toLocal(6.8, 45.9, 1000)) / 2
    const reference = coverage(overviewView(path, frame, flat, 1, 16 / 9, joined), DEFAULT_FOCAL_MM)
    for (const focalMm of FOCALS) {
      const tele = focalMm >= DEFAULT_FOCAL_MM
      // the same ground in the frame from a telephoto; from a wide angle, the default's distance (more land around)
      expect(overviewDistanceM(10_000, 9 / 16, focalMm)).toBeCloseTo(overviewDistanceM(10_000, 9 / 16) * (tele ? focalDolly(focalMm) : 1), 6)
      const overview = overviewView(path, frame, flat, 1, 16 / 9, joined, undefined, focalMm)
      if (tele) expect(coverage(overview, focalMm)).toBeCloseTo(reference, 3)
      else expect(overview.position.distanceTo(overview.target)).toBeCloseTo(overviewDistanceM(path.lengthM, 16 / 9), -1)
      for (const height of ['region', 'pays'] as const) {
        for (const diagonal of [1_000, 10_000]) {
          const lens = regionDistanceM(diagonal, diagonal / 4, 16 / 9, height, undefined, 0, REGION_PITCH_DEG, undefined, focalMm)
          const wanted = regionDistanceM(diagonal, diagonal / 4, 16 / 9, height)
          // at most the default's times the dolly (the reach of the terrain may cap it), and a telephoto never nearer than the default
          expect(lens).toBeLessThanOrEqual(wanted * (tele ? focalDolly(focalMm) : 1) + 1e-3)
          if (tele) expect(lens).toBeGreaterThanOrEqual(wanted - 1e-3)
          if (tele && height === 'region' && diagonal === 1_000) expect(lens).toBeCloseTo(wanted * focalDolly(focalMm), 3)
        }
      }
      // a box to fit fills the frame height with any lens
      const fitted = regionDistanceM(10_000, 3_000, 16 / 9, 'region', box, 0, REGION_PITCH_DEG, undefined, focalMm)
      if (tele) expect(fitted * tanHalf(focalMm)).toBeCloseTo((REGION_FIT_MARGIN * box.widthM) / 2, 3)
      const framed = framedGroup(joined, group, frame, flat, 1, 16 / 9, focalMm)
      expect(framed.position.distanceTo(framed.target) * tanHalf(focalMm)).toBeGreaterThan(GROUP_FRAMING_MARGIN * spread * 0.99)
    }
    // the region view stays within the reach of the terrain with every lens
    for (const focalMm of FOCALS) {
      const far = regionDistanceM(10_000, 3_000, 16 / 9, 'pays', { widthM: 2_000_000, heightM: 1_000_000 }, 0, REGION_PITCH_DEG, undefined, focalMm)
      expect(far * groundReach(REGION_PITCH_DEG, 16 / 9, focalMm)).toBeCloseTo(3_000 + REGION_REACH_M, 6)
    }
  })

  it('a keyframe frames the same with any lens: its distance is that of the lens, and the headroom follows the field of view', () => {
    const none = { style: 'aucune', durationS: 1 } as const
    const clock = clockOf(none, none, [], [{ id: 'camera-1', atM: 1500, distance: 2, pitchDeg: 40, headingOffsetDeg: 20, aimRightM: 0, aimAheadM: 0 }])
    const t = clock.cameraKeys[0].timeS
    for (const focalMm of FOCALS) {
      const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, withLens(focalMm))
      const wide = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, withLens(26))
      expect(coverage(view, focalMm)).toBeCloseTo(coverage(wide, 26), 3)
    }
  })

  it('the relief protections hold with a telephoto: never under the clearance, at every lens, over steep hills', () => {
    const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'descente', durationS: 6 })
    for (const focalMm of [18, 135]) {
      const issues = auditFilmCamera(path, clock, frame, hills, withLens(focalMm))
      expect(issues.filter((i) => i.kind !== 'jolt'), `${focalMm} mm`).toEqual([])
    }
  })
})

describe('« Espace devant » and « Inclinaison dans les virages » over a film', () => {
  const track = hairpins()
  const bendy = trackPathOf(track)
  const where = (() => {
    const c = centroid(track.bounds)
    return createLocalFrame(c.lon, c.lat)
  })()
  const BANK_MAX = 10
  const camera = { ...DEFAULT_CAMERA, style: 'sway' as const, bankDeg: BANK_MAX, leadRoomPct: 30 }
  const shots = { style: 'descente', durationS: 5 } as const
  const filmWith = (stops: FilmStop[], cameraKeys: FilmCameraKey[] = []) =>
    filmClockFor({ track, film: { ...DEFAULT_FILM, autoStops: false, opening: shots, closing: shots, stops, cameraKeys }, durationS: 60, pacing: DEFAULT_PACING, landmarks: [] })
  const stop: FilmStop = { id: 's', atM: 0.4 * bendy.lengthM, durationS: 12, camera: 'film' }
  const key: FilmCameraKey = { id: 'k', atM: 0.7 * bendy.lengthM, distance: 1, pitchDeg: 30, headingOffsetDeg: 0 }
  const viewsOf = (clock: ReturnType<typeof filmWith>, settings = camera) =>
    Array.from({ length: Math.floor(clock.totalTime() * 30) + 1 }, (_, i) => {
      const t = i / 30
      const options: FilmViewOptions = { exaggeration: 1, liftM: 3, camera: settings, durationS: 60, aspect: 16 / 9 }
      return { t, view: computeFilmView(bendy, clock, t, clock.progressAtTime(t), where, steepSampler, options) }
    })

  it('the bank is continuous through shots, stops and keys, none at the ends of the film or at a stop or a key, never past the setting', () => {
    const clock = filmWith([stop], [key])
    const rolls = viewsOf(clock).map(({ view }) => view.rollRad ?? 0)
    expect(Math.max(...rolls.map(Math.abs))).toBeGreaterThan((3 * Math.PI) / 180)
    expect(Math.max(...rolls.map(Math.abs))).toBeLessThanOrEqual((BANK_MAX * Math.PI) / 180 + 1e-9)
    // in these hairpins the roll turns by a few degrees a second at most: a snap would be a degree or more per frame
    for (let i = 1; i < rolls.length; i++) expect(Math.abs(rolls[i] - rolls[i - 1]), `frame ${i}`).toBeLessThan((0.5 * Math.PI) / 180)
    expect(Math.abs(rolls[0])).toBe(0)
    expect(Math.abs(rolls[rolls.length - 1])).toBe(0)
    const [held] = clock.stops
    const at = (timeS: number) => rolls[Math.round(timeS * 30)]
    expect(at((held.startS + held.endS) / 2)).toBeCloseTo(0, 9)
    expect(Math.abs(at(clock.cameraKeys[0].timeS))).toBeLessThan(1e-9)
  })

  it('the lead room eases to nothing at a stop and back, with no step, and the shots and keys take it away', () => {
    const clock = filmWith([stop], [key])
    const lead = (settings: typeof camera) => viewsOf(clock, settings).map(({ view }) => view.target)
    const [on, off] = [lead(camera), lead({ ...camera, leadRoomPct: 0 })]
    const moved = on.map((target, i) => target.distanceTo(off[i]))
    const [held] = clock.stops
    expect(moved[Math.round(((held.startS + held.endS) / 2) * 30)]).toBeLessThan(1e-6)
    expect(Math.max(...moved)).toBeGreaterThan(20)
    // it comes in over about two seconds: a frame changes it by a few percent at most (less than a tenth)
    const largest = Math.max(...moved)
    for (let i = 1; i < moved.length; i++) expect(Math.abs(moved[i] - moved[i - 1]), `frame ${i}`).toBeLessThan(0.1 * largest)
    // the view of a key is the key's, whatever the setting
    const k = Math.round(clock.cameraKeys[0].timeS * 30)
    expect(on[k].distanceTo(off[k])).toBeLessThan(1e-6)
  })

  it('a camera key is placed around the aim without the lead room, so it keeps its pose whatever the setting', () => {
    const clock = filmWith([], [key])
    const at = clock.cameraKeys[0].timeS
    const viewWith = (leadRoomPct: number) =>
      computeFilmView(bendy, clock, at, key.atM / bendy.lengthM, where, steepSampler, { exaggeration: 1, liftM: 3, camera: { ...camera, leadRoomPct }, durationS: 60, aspect: 16 / 9 })
    expectSameView(viewWith(0), viewWith(40))
  })

  it('applies the roll about the line of sight: lookAtView', () => {
    const view = viewsOf(filmWith([]))[Math.round(30 * 30)].view
    expect(Math.abs(view.rollRad ?? 0)).toBeGreaterThan(0)
    const cam = new PerspectiveCamera(50, 1)
    cam.position.copy(view.position)
    lookAtView(cam, view)
    cam.updateMatrixWorld()
    const forward = view.target.clone().sub(view.position).normalize()
    expect(cam.getWorldDirection(new Vector3()).distanceTo(forward)).toBeLessThan(1e-9)
  })
})
