import { describe, expect, it } from 'vitest'
import sampleGpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { CAMERA_PRESETS, CAMERA_STYLES, DEFAULT_CAMERA } from './cameraSettings'
import { MARKER_TRACKS, steepSampler } from './__fixtures__/markerVisible'
import { curvyOuting, flyFilm, gpxTrack, hillySampler, quantile, zigzagOuting } from './__fixtures__/smoothness'

/**
 * Smoothness of the film camera over whole flights (default settings, hilly terrain, 30 frames per second of film): a
 * 540 km raid recorded every ~90 s flown in 4 min 30 s (2 km of track per second, sparse corners, out-and-backs, GPS
 * stars at the rests), the Tour du Mont-Blanc sample in 60 s, and a 6 km walk with GPS noise and tight zigzags in 60 s.
 * Turn rate (deg/s) and angular acceleration (deg/s²) of the look direction, vertical and sideways jerk of the camera
 * (m/s³).
 */
const FPS = 30
const raid = curvyOuting()
const sample = gpxTrack(sampleGpx)
const zigzag = zigzagOuting()
const { hairpins } = MARKER_TRACKS
const max = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0)

describe('camera smoothness', () => {
  it('a 540 km raid in 4 min 30 s, chase: no swing around, no jolt', () => {
    const film = flyFilm(raid, 270, hillySampler, DEFAULT_CAMERA, FPS)
    expect(quantile(film.turn, 0.95)).toBeLessThan(60)
    expect(max(film.turn)).toBeLessThan(120)
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(150)
    expect(max(film.turnAccel)).toBeLessThan(600)
    expect(quantile(film.climbJerk, 0.99)).toBeLessThan(50_000)
  })

  // one test per style: the six together outran the time limit under the coverage of the CI on master
  it.each(CAMERA_STYLES)('%s keeps the raid calm', { timeout: 20_000 }, (style) => {
    const film = flyFilm(raid, 270, hillySampler, { ...DEFAULT_CAMERA, style }, FPS)
    expect(max(film.turn)).toBeLessThan(150)
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(250)
  })

  it('the short sample stays close behind the marker', () => {
    const film = flyFilm(sample, 60, hillySampler, DEFAULT_CAMERA, FPS)
    expect(max(film.turn)).toBeLessThan(40)
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(150)
    // not sluggish: the view keeps to the direction of travel
    expect(quantile(film.lag, 0.5)).toBeLessThan(10)
    expect(quantile(film.lag, 0.95)).toBeLessThan(25)
  })

  it('a walk with GPS noise and tight zigzags, chase: the camera does not follow the small movements', () => {
    const film = flyFilm(zigzag, 60, hillySampler, DEFAULT_CAMERA, FPS)
    // standing on the zigzags, the camera shook sideways at 4,800 m/s³ (median) and 22,000 (p99)
    expect(quantile(film.lateralJerk, 0.5)).toBeLessThan(20)
    expect(quantile(film.lateralJerk, 0.99)).toBeLessThan(200)
    // the aim, smoothed less, does not swing the view instead; the marker stays near the middle of the frame
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(30)
    expect(quantile(film.lag, 0.95)).toBeLessThan(10)
  })

  it('every chase preset keeps still on the zigzags', { timeout: 20_000 }, () => {
    for (const { name, camera } of CAMERA_PRESETS.filter((p) => p.camera.style === 'chase')) {
      const film = flyFilm(zigzag, 60, hillySampler, camera, FPS)
      expect(quantile(film.lateralJerk, 0.99), name).toBeLessThan(1_000)
    }
  })

  it('steep hairpins: the far presets climb ahead of the relief instead of jumping (#211)', { timeout: 30_000 }, () => {
    // each frame's own sight-line raise gave 2.8–6.7 million m/s³ here; the anticipated raise 0.24–0.65 million
    for (const { id, camera } of CAMERA_PRESETS.filter((p) => ['cinema', 'glider', 'balloon'].includes(p.id))) {
      const film = flyFilm(hairpins(), 60, steepSampler, camera, FPS)
      expect(max(film.climbJerk.map(Math.abs)), id).toBeLessThan(1_000_000)
    }
  })
})
