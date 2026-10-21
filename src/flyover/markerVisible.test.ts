import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS } from './cameraSettings'
import { MARKER_TRACKS, flyMarker, steepSampler } from './__fixtures__/markerVisible'
import { flyFilm } from './__fixtures__/smoothness'

/**
 * The lead marker stays visible whatever the camera: in the middle of the frame and not hidden behind the relief
 * (`lineOfSightClearance`: below 0 the marker is not drawn at all). Twisty tracks (switchbacks, loops, right angles)
 * over a steep synthetic massif, every camera preset, 60 s flights. Measured at 10 fps: 2 frames hidden out of 21,600
 * over the 36 flights, both in one (« Montgolfière » on the switchbacks, 4 m behind the crest at most); it was 0.3%,
 * up to 8% for one flight with 22 switches between shown and hidden. The marker stays within 0.15 of the half-frame
 * from its centre (0.14 at most), 0.2 through stops (0.16: the aim stands on a smoothed line, `cameraLine`).
 */
const LENGTH_S = 60
/** the presets that follow the marker ('free' follows nothing but the keyframes, by design) */
const FOLLOWING = CAMERA_PRESETS.filter((p) => p.camera.style !== 'free')
const edge = (f: { ndcX: number; ndcY: number }) => (Number.isNaN(f.ndcX) ? Infinity : Math.max(Math.abs(f.ndcX), Math.abs(f.ndcY)))

describe('marker visibility', { timeout: 120_000 }, () => {
  for (const [name, make] of Object.entries(MARKER_TRACKS)) {
    const track = make()

    it(`${name}: no camera preset hides the marker behind the relief`, () => {
      let hiddenFrames = 0
      let allFrames = 0
      for (const { name: preset, camera } of FOLLOWING) {
        const frames = flyMarker(track, LENGTH_S, steepSampler, camera, 10)
        const hidden = frames.map((f) => f.clearanceM < 0)
        hiddenFrames += hidden.filter(Boolean).length
        allFrames += frames.length
        expect(hidden.filter(Boolean).length / frames.length, preset).toBeLessThan(0.005)
        expect(Math.min(...frames.map((f) => f.clearanceM)), preset).toBeGreaterThan(-8)
        // no blinking: shown and hidden swap a few times at most over the flight
        expect(hidden.filter((h, i) => i > 0 && h !== hidden[i - 1]).length, preset).toBeLessThanOrEqual(4)
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.15)
      }
      expect(hiddenFrames / allFrames).toBeLessThan(0.001)
    })

    it(`${name}: the marker stays in the middle of the frame through stops and speed changes`, () => {
      const length = track.stats.distanceM
      const film = {
        autoStops: false,
        stops: [
          { id: 's1', atM: 0.3 * length, durationS: 4, camera: 'film' },
          { id: 's2', atM: 0.6 * length, durationS: 6, camera: 'orbite' },
          { id: 's3', atM: 0.8 * length, durationS: 5, camera: 'large' },
        ],
        speeds: [
          { id: 'v1', fromM: 0.1 * length, toM: 0.2 * length, factor: 4 },
          { id: 'v2', fromM: 0.4 * length, toM: 0.5 * length, factor: 0.25 },
        ],
      } as const
      for (const { name: preset, camera } of FOLLOWING) {
        const frames = flyMarker(track, LENGTH_S, steepSampler, camera, 10, 16 / 9, 1, { ...film, stops: [...film.stops], speeds: [...film.speeds] })
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.2)
      }
    })
  }

  it('clearing the relief keeps the camera calm (turn rate of the view)', () => {
    for (const preset of ['Cinéma', 'Montgolfière']) {
      const camera = CAMERA_PRESETS.find((p) => p.name === preset)!.camera
      const film = flyFilm(MARKER_TRACKS.loops(), LENGTH_S, steepSampler, camera, 30)
      expect(Math.max(...film.turn), preset).toBeLessThan(90)
    }
  })
})
