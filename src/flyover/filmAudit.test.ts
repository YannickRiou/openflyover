import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import exampleGpx from '../../public/samples/etang-ayguelongue-pic-de-l-homme.gpx?raw'
import { filmClockFor } from '../film/clock'
import { DEFAULT_FILM, type Film, type ShotStyle } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { centroid } from '../geo/lonLat'
import type { HeightSampler } from '../scene/trackLineSet'
import { CAMERA_PRESETS, DEFAULT_CAMERA, type CameraSettings } from './cameraSettings'
import { AUDIT_JOLT_LIMIT, auditFilmCamera, auditPoses, type AuditPose } from './filmAudit'
import { computeFilmView } from './filmCamera'
import { DEFAULT_PACING } from './pacing'
import { samplePath, trackPathOf } from './path'
import { hairpins, loops, steepSampler } from './__fixtures__/markerVisible'
import { curvyOuting, gpxTrack, hillySampler } from './__fixtures__/smoothness'

const frame = createLocalFrame(6.85, 45.9)
const FPS = 30

/** A camera 1 km from its aim, flying east at 10 m a frame, the marker at the aim; `jump` metres up from frame `at`. */
function poses(count: number, { at = -1, jump = 0, state = () => 'flight|' }: { at?: number; jump?: number; state?: (i: number) => string } = {}): AuditPose[] {
  return Array.from({ length: count }, (_, i) => {
    const lift = i >= at && at >= 0 ? jump : 0
    const target = new Vector3(i * 10, 0, 0)
    return { position: new Vector3(i * 10, 1000 + lift, 1000), target, marker: target.clone(), state: state(i) }
  })
}
const options = { exaggeration: 1, aspect: 16 / 9 }

describe('auditPoses', () => {
  it('a steady flight has no issue', () => {
    expect(auditPoses(poses(90), frame, null, options)).toEqual([])
  })

  it('a jump of the camera is a jolt, at its time, camera and aim alike', () => {
    const issues = auditPoses(poses(90, { at: 45, jump: 200 }), frame, null, options, { fromS: 10 })
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('jolt')
    expect(issues[0].startS).toBeCloseTo(10 + 44 / FPS, 1)
    expect(issues[0].worst).toBeGreaterThan(AUDIT_JOLT_LIMIT)
  })

  it('a start or a stop of the marker is not a jolt: the camera follows it at once', () => {
    const state = (i: number) => (i < 45 ? 'opening|' : 'flight|')
    expect(auditPoses(poses(90, { at: 45, jump: 200, state }), frame, null, options)).toEqual([])
  })

  it('a camera under its clearance above the terrain is low, a camera short by a metre is not', () => {
    const ground = (clearanceM: number) => () => poses(1)[0].position.y - clearanceM
    const flat = poses(30)
    // a flat world at the camera's height minus the clearance: the camera is `clearanceM` above the ground
    const at = frame.toLonLat(flat[0].position)
    const lowAt = at.height - 10
    expect(auditPoses(flat, frame, () => lowAt, options).map((i) => i.kind)).toEqual(['low'])
    expect(auditPoses(flat, frame, () => at.height - 39.5, options)).toEqual([])
    expect(ground(10)()).toBeLessThan(1000)
  })

  it('a marker outside the frame, or behind the camera, is out', () => {
    const away = poses(30).map((p) => ({ ...p, marker: p.target.clone().add(new Vector3(0, 0, -6000)) }))
    expect(auditPoses(away, frame, null, options).map((i) => i.kind)).toEqual(['marker-out'])
    const beside = poses(30).map((p) => ({ ...p, marker: p.target.clone().add(new Vector3(3000, 0, 0)) }))
    expect(auditPoses(beside, frame, null, options).map((i) => i.kind)).toEqual(['marker-out'])
  })

  it('flagged frames half a second apart make one issue, further apart two', () => {
    const near = poses(120).map((p, i) => (i === 40 || i === 50 ? { ...p, position: p.position.clone().setY(2500) } : p))
    expect(auditPoses(near, frame, null, options).filter((i) => i.kind === 'jolt')).toHaveLength(1)
    const far = poses(120).map((p, i) => (i === 30 || i === 90 ? { ...p, position: p.position.clone().setY(2500) } : p))
    expect(auditPoses(far, frame, null, options).filter((i) => i.kind === 'jolt')).toHaveLength(2)
  })
})

describe('the opening and closing shots of every preset', () => {
  // the fixtures of the other camera tests: switchbacks and loops on a steep massif, a raid over hills
  const scenes = [
    { name: 'hairpins on a steep massif', track: hairpins(), sample: steepSampler },
    { name: 'loops on a steep massif', track: loops(), sample: steepSampler },
    { name: 'raid over hills', track: curvyOuting(40, 2), sample: hillySampler },
  ]
  const styles: ShotStyle[] = ['descente', 'situation', 'balayage', 'saut']

  // « Saut » is a quick move on purpose (0.6 s): it is checked for everything but its pace
  it('never jolt, skim the terrain nor lose the marker, at 30 i/s', { timeout: 120_000 }, () => {
    for (const { name, track, sample } of scenes) {
      const path = trackPathOf(track)
      const c = centroid(track.bounds)
      const where = createLocalFrame(c.lon, c.lat)
      for (const preset of CAMERA_PRESETS) {
        for (const style of styles) {
          const film: Film = { ...DEFAULT_FILM, opening: { style, durationS: 8 }, closing: { style, durationS: 6 } }
          const clock = filmClockFor({ track, film, durationS: 60, pacing: DEFAULT_PACING, landmarks: [] })
          const opts = { exaggeration: 1, liftM: 3, camera: preset.camera, durationS: 60, aspect: 16 / 9 }
          const closingS = clock.openingS + clock.flightS
          for (const [fromS, toS] of [[0, clock.openingS], [closingS, clock.totalTime()]]) {
            const issues = auditFilmCamera(path, clock, where, sample, opts, { fromS, toS }).filter((i) => i.kind !== 'jolt' || style !== 'saut')
            expect(issues, `${name}, ${preset.id}, ${style}, ${fromS === 0 ? 'opening' : 'closing'}`).toEqual([])
          }
        }
      }
    }
  })
})

describe('the whole film over the home page example, beyond the opening and the closing', () => {
  // the real hike of « Essayer avec l'exemple »: switchbacks, 12.6 km flown in 60 s; hills under it
  const track = gpxTrack(exampleGpx)
  const path = trackPathOf(track)
  const where = createLocalFrame(centroid(track.bounds).lon, centroid(track.bounds).lat)
  const lengthM = path.lengthM
  const clockOf = (film: Partial<Film>) => filmClockFor({ track, film: { ...DEFAULT_FILM, autoStops: false, ...film }, durationS: 60, pacing: DEFAULT_PACING, landmarks: [] })
  const audit = (film: Partial<Film>, camera: CameraSettings, extra: Record<string, unknown> = {}) =>
    auditFilmCamera(path, clockOf(film), where, hillySampler, { exaggeration: 1, liftM: 3, camera, durationS: 60, aspect: 16 / 9, ...extra })
  const preset = (id: string) => CAMERA_PRESETS.find((p) => p.id === id)!.camera

  it('« Lissage de la caméra » at 0 or 0.5 s: the heading no longer whips round the switchbacks', { timeout: 60_000 }, () => {
    for (const cameraSmoothingS of [0, 0.5]) {
      const issues = audit({}, { ...DEFAULT_CAMERA, distance: 0.5, pitchDeg: 25, cameraSmoothingS })
      expect(issues.filter((i) => i.kind === 'jolt'), `smoothing ${cameraSmoothingS}`).toEqual([])
    }
  })

  it('speed portions at ×4 and ×0.25: the sway of the bird follows the bends at the pace of the film, not 4 times as fast', { timeout: 60_000 }, () => {
    const speeds = [
      { id: 'a', fromM: lengthM * 0.2, toM: lengthM * 0.35, factor: 4 },
      { id: 'b', fromM: lengthM * 0.55, toM: lengthM * 0.7, factor: 0.25 },
    ]
    // the camera itself: 0.054 before, 0.027 now. What is left (0.037) is the aim, which stays on the marker as it takes a
    // switchback at ×4 (the aim of « Drone rapide » reaches 0.07): averaging it over more took the marker out of the frame
    const issues = audit({ speeds }, preset('bird'))
    expect(issues.filter((i) => i.kind !== 'jolt')).toEqual([])
    for (const issue of issues) expect(issue.worst).toBeLessThan(0.045)
  })

  it('camera keys over the steep massif: the camera never goes through the ridges between them', { timeout: 60_000 }, () => {
    // the blend of two views knows nothing of the relief between them: 65 to 101 m under the ground before the fix
    const switchbacks = hairpins()
    const steepPath = trackPathOf(switchbacks)
    const c = centroid(switchbacks.bounds)
    const steep = createLocalFrame(c.lon, c.lat)
    const cameraKeys = [
      { id: 'k1', atM: steepPath.lengthM * 0.25, distance: 1, pitchDeg: 20, headingOffsetDeg: 45 },
      { id: 'k2', atM: steepPath.lengthM * 0.5, distance: 1.6, pitchDeg: 25, headingOffsetDeg: -120, aimAheadM: 400 },
      { id: 'k3', atM: steepPath.lengthM * 0.7, distance: 0.8, pitchDeg: 80, headingOffsetDeg: 0 },
    ]
    const clock = filmClockFor({ track: switchbacks, film: { ...DEFAULT_FILM, autoStops: false, cameraKeys }, durationS: 60, pacing: DEFAULT_PACING, landmarks: [] })
    for (const camera of [DEFAULT_CAMERA, preset('free')]) {
      const issues = auditFilmCamera(steepPath, clock, steep, steepSampler, { exaggeration: 1, liftM: 3, camera, durationS: 60, aspect: 16 / 9 })
      expect(issues.filter((i) => i.kind !== 'marker-out'), camera.style).toEqual([])
    }
  })

  it('sharper tiles arriving while the film plays: the camera climbs to its new height over a few frames, no step of a hundred metres', { timeout: 60_000 }, () => {
    // the terrain of the hills at 0.9–1.3 km cells, then sharpened a little each frame for 3 s (the engine's version rises each time)
    // the hills three times as high: ridges between the camera and the marker
    const rugged = (lon: number, lat: number) => 3 * (hillySampler(lon, lat) as number)
    const ruggedSampler: HeightSampler = rugged
    const cellLon = 0.012
    const cellLat = 0.009
    const coarse: HeightSampler = (lon, lat) => {
      const [i, j] = [Math.floor(lon / cellLon), Math.floor(lat / cellLat)]
      const [fx, fy] = [lon / cellLon - i, lat / cellLat - j]
      const h = (a: number, b: number) => rugged(a * cellLon, b * cellLat)
      return h(i, j) * (1 - fx) * (1 - fy) + h(i + 1, j) * fx * (1 - fy) + h(i, j + 1) * (1 - fx) * fy + h(i + 1, j + 1) * fx * fy
    }
    for (const [id, startS] of [['chase', 20], ['chase', 40], ['cinema', 30], ['cinema', 50]] as const) {
      const camera = preset(id)
      const clock = clockOf({})
      let share = 0
      let version = 0
      const sample: HeightSampler = (lon, lat) => (coarse(lon, lat) as number) * (1 - share) + rugged(lon, lat) * share
      const frames: Vector3[][] = []
      for (let i = 0; i < 60 + 90 + 90; i++) {
        if (i >= 60 && i < 150) {
          share = (i - 59) / 90
          version++
        }
        const t = startS + i / 30
        const view = computeFilmView(path, clock, t, clock.progressAtTime(t), where, sample, { exaggeration: 1, liftM: 3, camera, durationS: 60, aspect: 16 / 9, terrainVersion: version })
        frames.push([view.position, view.target])
      }
      let worst = 0
      for (let i = 56; i + 1 < frames.length; i++) {
        const distance = frames[i][0].distanceTo(frames[i][1])
        for (const k of [0, 1]) worst = Math.max(worst, frames[i + 1][k].clone().add(frames[i - 1][k]).addScaledVector(frames[i][k], -2).length() / distance)
      }
      expect(worst, `${id} from ${startS} s`).toBeLessThan(AUDIT_JOLT_LIMIT)
      // and it gets there: the camera over the final terrain, placed from scratch, is the one 3 s after the last tile
      const final = computeFilmView(path, clock, startS + 239 / 30, clock.progressAtTime(startS + 239 / 30), where, ruggedSampler, { exaggeration: 1, liftM: 3, camera, durationS: 60, aspect: 16 / 9 })
      expect(frames[239][0].distanceTo(final.position), `${id} from ${startS} s`).toBeLessThan(1)
    }
  })

  it('photo pins on the track: the turn to them keeps the marker in the frame, with the default camera and the close ones', { timeout: 60_000 }, () => {
    const clock = clockOf({})
    // a pin on the track ahead of the marker, on it, behind it, as photos taken 400 m away are
    for (const shiftM of [400, 0, -400]) {
      const pins = [14, 30, 45, 58].map((startS) => {
        const at = samplePath(path, clock.progressAtTime(startS) * lengthM + shiftM)
        return { startS, endS: startS + 3, lon: at.lon, lat: at.lat, ele: at.ele }
      })
      for (const id of ['chase', 'fast-drone', 'bird']) {
        const issues = audit({}, preset(id), { pins })
        expect(issues.filter((i) => i.kind === 'marker-out'), `${id}, pins ${shiftM} m from the marker`).toEqual([])
        // and the turn is no jolt of its own: « Drone rapide » reached 0.08 where the room left to the marker dipped
        // as the aim crossed the marker's direction (its own swing is 0.025 at most there)
        for (const issue of issues) expect(issue.worst, `${id}, pins ${shiftM} m from the marker`).toBeLessThan(0.04)
      }
    }
  })

  it('stays a function of the film time: a frame is the same alone as after others (the export renders any frame alone)', { timeout: 60_000 }, () => {
    const cameraKeys = [{ id: 'k1', atM: lengthM * 0.4, distance: 1.4, pitchDeg: 30, headingOffsetDeg: 60 }]
    const speeds = [{ id: 'a', fromM: lengthM * 0.2, toM: lengthM * 0.35, factor: 4 }]
    const clock = clockOf({ cameraKeys, speeds })
    const pins = [20, 40].map((startS) => {
      const at = samplePath(path, clock.progressAtTime(startS) * lengthM)
      return { startS, endS: startS + 3, lon: at.lon, lat: at.lat, ele: at.ele }
    })
    const view = (t: number, sample: HeightSampler) =>
      computeFilmView(path, clock, t, clock.progressAtTime(t), where, sample, { exaggeration: 1, liftM: 3, camera: preset('bird'), durationS: 60, aspect: 16 / 9, pins, terrainVersion: 1 })
    const shared: HeightSampler = (lon, lat) => hillySampler(lon, lat)
    // the instants in a scrambled order: the ones before warm what the next ones read
    for (const t of [47.3, 12.1, 30.4, 18.8, 33.3, 8.2, 52.9, 19.5, 40.1]) {
      const after = view(t, shared)
      const alone = view(t, (lon, lat) => hillySampler(lon, lat))
      expect(after.position.distanceTo(alone.position), `${t} s`).toBeLessThan(1e-6)
      expect(after.target.distanceTo(alone.target), `${t} s`).toBeLessThan(1e-6)
    }
  })
})
