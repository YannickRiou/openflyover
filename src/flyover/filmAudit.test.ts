import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { filmClockFor } from '../film/clock'
import { DEFAULT_FILM, type Film, type ShotStyle } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { centroid } from '../geo/lonLat'
import { CAMERA_PRESETS } from './cameraSettings'
import { AUDIT_JOLT_LIMIT, auditFilmCamera, auditPoses, type AuditPose } from './filmAudit'
import { DEFAULT_PACING } from './pacing'
import { trackPathOf } from './path'
import { hairpins, loops, steepSampler } from './__fixtures__/markerVisible'
import { curvyOuting, hillySampler } from './__fixtures__/smoothness'

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
