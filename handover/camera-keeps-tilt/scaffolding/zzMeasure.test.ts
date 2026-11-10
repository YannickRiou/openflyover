// TEMPORARY measure on the markerVisible fixtures, old vs new rule. Not committed.
import { writeFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { describe, it } from 'vitest'
import { filmClockFor } from '../film/clock'
import { DEFAULT_FILM, type Film } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { centroid } from '../geo/lonLat'
import { lineOfSightClearance } from '../scene/labelModel'
import * as NewAudit from './filmAudit'
import * as NewFC from './filmCamera'
import * as OldAudit from '../flyoverOld/filmAudit'
import * as OldFC from '../flyoverOld/filmCamera'
import { CAMERA_PRESETS, DEFAULT_CAMERA } from './cameraSettings'
import { MARKER_TRACKS, steepSampler } from './__fixtures__/markerVisible'
import { DEFAULT_PACING } from './pacing'
import { trackPathOf } from './path'

const DEG = Math.PI / 180
;(globalThis as any).__rule = process.env.RULE ? JSON.parse(process.env.RULE) : {}
const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null
}
const CAMS = [
  { name: 'ground', camera: { ...DEFAULT_CAMERA, distance: 0.5, pitchDeg: 20 } },
  { name: 'close', camera: { ...DEFAULT_CAMERA, distance: 1, pitchDeg: 30 } },
  { name: 'd043', camera: { ...DEFAULT_CAMERA, distance: 0.43, pitchDeg: 15 } },
  ...CAMERA_PRESETS.filter((p) => ['helicopter', 'plane', 'high-drone'].includes(p.id)).map((p) => ({ name: p.id, camera: p.camera })),
]

function fly(mod: 'old' | 'new', trackName: string, name: string, camera: (typeof CAMS)[number]['camera']) {
  const FC = mod === 'old' ? OldFC : NewFC
  const AU = mod === 'old' ? OldAudit : NewAudit
  const track = MARKER_TRACKS[trackName]()
  const durationS = 60
  const noShot = { style: 'aucune', durationS: 0 } as const
  const film: Film = { ...DEFAULT_FILM, opening: noShot, closing: noShot }
  const clock = filmClockFor({ track, film, durationS, pacing: DEFAULT_PACING, landmarks: [] })
  const path = trackPathOf(track)
  const { lon, lat } = centroid(track.bounds)
  const frame = createLocalFrame(lon, lat)
  const options = { exaggeration: 1, liftM: 3, camera, durationS, aspect: 16 / 9 }
  const clearanceAt = (x: number, y: number, z: number) => {
    const p = frame.toLonLat(new Vector3(x, y, z))
    const g = steepSampler(p.lon, p.lat)
    return g === undefined ? undefined : p.height - g
  }
  const gaps: number[] = []
  let hidden = 0
  let frames = 0
  let camMin = Infinity
  let hiddenDense = 0
  for (let t = clock.openingS; t <= clock.openingS + clock.flightS; t += 1 / 10) {
    const v = FC.computeFilmView(path, clock, t, clock.progressAtTime(t), frame, steepSampler, options)
    const dir = new Vector3().subVectors(v.target, v.position)
    const pitch = Math.asin(-dir.y / dir.length()) / DEG
    gaps.push(pitch - camera.pitchDeg)
    frames++
    if (lineOfSightClearance(v.position, v.marker, clearanceAt) < 0) hidden++
    let dmin = Infinity
    for (let k = 0; k <= 300; k++) {
      const f = (k / 300) * 0.97
      const c = clearanceAt(v.position.x + (v.marker.x - v.position.x) * f, v.position.y + (v.marker.y - v.position.y) * f, v.position.z + (v.marker.z - v.position.z) * f)
      if (c !== undefined) dmin = Math.min(dmin, c)
    }
    if (dmin < 0) hiddenDense++
    const at = frame.toLonLat(v.position)
    camMin = Math.min(camMin, at.height - steepSampler(at.lon, at.lat))
  }
  const issues = ['ground', 'close', 'd043'].includes(name) ? AU.auditFilmCamera(path, clock, frame, steepSampler, options) : []
  const by: Record<string, number> = {}
  for (const i of issues) by[i.kind] = (by[i.kind] ?? 0) + 1
  return { gaps, hidden, hiddenDense, frames, camMin, audit: by }
}

describe('measure', { timeout: 3_600_000 }, () => {
  it('fixtures old vs new', () => {
    const out: Record<string, unknown> = {}
    for (const trackName of Object.keys(MARKER_TRACKS)) {
      for (const { name, camera } of CAMS) {
        for (const mod of ['old', 'new'] as const) {
          const r = fly(mod, trackName, name, camera)
          const abs = r.gaps.map(Math.abs)
          out[`${trackName}:${name}:${mod}`] = {
            asked: camera.pitchDeg,
            gapMedian: pct(r.gaps, 0.5), gapP90: pct(r.gaps, 0.9), gapMax: Math.max(...r.gaps),
            absMedian: pct(abs, 0.5), absP90: pct(abs, 0.9), absMax: Math.max(...abs),
            hidden: r.hidden, hiddenDense: r.hiddenDense, frames: r.frames, camMin: r.camMin, audit: r.audit,
          }
        }
      }
    }
    writeFileSync(process.env.MEASURE_OUT ?? '/tmp/measure.json', JSON.stringify(out, null, 1))
  })
})
