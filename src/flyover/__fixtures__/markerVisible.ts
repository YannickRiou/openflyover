/**
 * Test helpers of the marker-visibility measures (markerVisible.test.ts): twisty synthetic tracks on steep terrain and,
 * frame by frame, where the lead marker falls in the film camera's frame (screen position, distance, line of sight
 * above the relief, `lineOfSightClearance`).
 */
import { PerspectiveCamera, Vector3 } from 'three'
import type { Track, TrackPoint } from '../../core/types'
import { filmClockFor } from '../../film/clock'
import { DEFAULT_FILM, type Film } from '../../film/model'
import { createLocalFrame } from '../../geo/ellipsoid'
import { centroid } from '../../geo/lonLat'
import { buildTrack } from '../../import/stats'
import { lineOfSightClearance } from '../../scene/labelModel'
import type { HeightSampler } from '../../scene/trackLineSet'
import type { CameraSettings } from '../cameraSettings'
import { CAMERA_FOV_DEG, computeFilmView, lookAtView, type FilmView } from '../filmCamera'
import { DEFAULT_PACING } from '../pacing'
import { trackPathOf } from '../path'

const M_PER_DEG = 111_320
const DEG = Math.PI / 180
const ORIGIN = { lon: 6.85, lat: 45.9 }
const cosLat = Math.cos(ORIGIN.lat * DEG)
const toXY = (lon: number, lat: number) => ({ x: (lon - ORIGIN.lon) * M_PER_DEG * cosLat, y: (lat - ORIGIN.lat) * M_PER_DEG })

/** A massif: a 2,000 m rounded cone (slope up to 0.8, ~39°) with a ridge and ±120 m rocky bumps, metres. */
export function steepHeight(lon: number, lat: number): number {
  const { x, y } = toXY(lon, lat)
  const cone = Math.max(0, 2_000 - 0.8 * (Math.hypot(x, y, 250) - 250))
  return 300 + cone + 120 * Math.sin(x / 260) * Math.cos(y / 310) + 250 * Math.exp(-(((x - 600) / 500) ** 2))
}
export const steepSampler: HeightSampler = (lon, lat) => steepHeight(lon, lat)

/** Track from east / north offsets in metres around the origin, one point every `stepM`. */
function trackOf(corners: [number, number][], stepM = 10): Track {
  const points: TrackPoint[] = []
  const at = (x: number, y: number): TrackPoint => ({ lon: ORIGIN.lon + x / (M_PER_DEG * cosLat), lat: ORIGIN.lat + y / M_PER_DEG })
  for (let c = 0; c + 1 < corners.length; c++) {
    const [x0, y0] = corners[c]
    const [x1, y1] = corners[c + 1]
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / stepM))
    for (let i = 0; i < steps; i++) points.push(at(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps))
  }
  points.push(at(...corners[corners.length - 1]))
  return buildTrack({ name: 'twisty', source: 'gpx', segments: [{ points }] })
}

/** Corners of a circle arc (radius `r`, centre (cx, cy)) from angle a0 to a1, 5° apart. */
function arcCorners(cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (5 * DEG)))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

/** Switchbacks up the flank of the massif: legs of 2.6 km across the slope, 180° turns at radius 45 m. */
export function hairpins(): Track {
  const corners: [number, number][] = [[-1500, -400]]
  for (let k = 0, y = -400; k < 9; k++, y += 90) {
    const east = k % 2 === 0
    const end = east ? 1100 : -1500
    corners.push([end, y], ...arcCorners(end, y + 45, 45, -Math.PI / 2, east ? Math.PI / 2 : (-3 * Math.PI) / 2).slice(1))
  }
  return trackOf(corners)
}

/** A road that loops twice around a hill (radius 900 m, then 450 m), then goes straight back out. */
export function loops(): Track {
  const corners: [number, number][] = [[-2500, 0], ...arcCorners(0, 0, 900, Math.PI, -3 * Math.PI)]
  return trackOf([...corners, ...arcCorners(0, 0, 450, Math.PI, 4 * Math.PI), [2500, 300]])
}

/** Right angles, an out-and-back and a U-turn over ridges. */
export function sharpTurns(): Track {
  const corners: [number, number][] = [[-2000, -1000], [-400, -1000], [-400, 0], [-900, 0], [-900, 700], [300, 700], [300, 100]]
  return trackOf([...corners, [1500, 100], [1500, 900], [200, 900], [200, 1500], [2200, 1500], [200, 1500], [200, 400], [-1800, 400]])
}

export const MARKER_TRACKS: Record<string, () => Track> = { hairpins, loops, sharpTurns }

export interface MarkerFrame {
  /** normalised device coordinates of the marker (|x|, |y| ≤ 1 inside the frame), NaN when behind the camera */
  ndcX: number
  ndcY: number
  /** smallest clearance of the line of sight above the relief (metres, `lineOfSightClearance`): < 0 = hidden behind it, not drawn */
  clearanceM: number
}

/** The scene camera (`CAMERA_FOV_DEG`) of `view`: at its position looking at its target, rolled by its bank. */
function sceneCamera(view: FilmView, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, aspect, 1, 5e6)
  camera.position.copy(view.position)
  lookAtView(camera, view)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

/**
 * The flight of the film of `track` (default film, no opening / closing shot, no stops) flown at `fps` with `camera`
 * over `durationS` seconds: where the marker falls in the camera's frame and how clear its line of sight is, frame by
 * frame. `filmOptions` overrides the film (stops, speed portions).
 */
export function flyMarker(
  track: Track,
  durationS: number,
  sample: HeightSampler,
  camera: CameraSettings,
  fps = 30,
  aspect = 16 / 9,
  exaggeration = 1,
  filmOptions: Partial<Film> = {},
): MarkerFrame[] {
  const noShot = { style: 'aucune', durationS: 0 } as const
  const film: Film = { ...DEFAULT_FILM, opening: noShot, closing: noShot, ...filmOptions }
  const clock = filmClockFor({ track, film, durationS, pacing: DEFAULT_PACING, landmarks: [] })
  const path = trackPathOf(track)
  const { lon, lat } = centroid(track.bounds)
  const frame = createLocalFrame(lon, lat)
  const options = { exaggeration, liftM: 3, camera, durationS, aspect }
  const clearanceAt = (x: number, y: number, z: number) => {
    const p = frame.toLonLat(new Vector3(x, y, z))
    const ground = sample(p.lon, p.lat)
    return ground === undefined ? undefined : p.height - ground * exaggeration
  }
  const frames: MarkerFrame[] = []
  const view = new Vector3()
  for (let t = clock.openingS; t <= clock.openingS + clock.flightS; t += 1 / fps) {
    const progress = clock.progressAtTime(t)
    const v = computeFilmView(path, clock, t, progress, frame, sample, options)
    const cam = sceneCamera(v, aspect)
    const behind = view.copy(v.marker).applyMatrix4(cam.matrixWorldInverse).z > 0
    const ndc = view.copy(v.marker).project(cam)
    frames.push({
      ndcX: behind ? Number.NaN : ndc.x,
      ndcY: behind ? Number.NaN : ndc.y,
      clearanceM: lineOfSightClearance(v.position, v.marker, clearanceAt),
    })
  }
  return frames
}
