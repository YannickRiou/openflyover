import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS } from './cameraSettings'
import { MARKER_TRACKS, flyMarker, steepSampler } from './__fixtures__/markerVisible'
import { flyFilm } from './__fixtures__/smoothness'

/**
 * The lead marker stays visible whatever the camera: in the middle of the frame and not hidden behind the relief
 * (`lineOfSightClearance`, which fades the marker out). Twisty tracks (switchbacks, loops, right angles) over a steep
 * synthetic massif, every camera preset, 60 s flights.
 */
const LENGTH_S = 60
const edge = (f: { ndcX: number; ndcY: number }) => (Number.isNaN(f.ndcX) ? Infinity : Math.max(Math.abs(f.ndcX), Math.abs(f.ndcY)))

describe('marker visibility', { timeout: 120_000 }, () => {
  for (const [name, make] of Object.entries(MARKER_TRACKS)) {
    const track = make()

    it(`${name}: no camera preset hides the marker behind the relief`, () => {
      for (const { name: preset, camera } of CAMERA_PRESETS) {
        const frames = flyMarker(track, LENGTH_S, steepSampler, camera, 10)
        const hidden = frames.filter((f) => f.clearanceM < 0).length / frames.length
        expect(hidden, preset).toBeLessThan(0.1)
        expect(Math.min(...frames.map((f) => f.clearanceM)), preset).toBeGreaterThan(-10)
      }
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
      for (const { name: preset, camera } of CAMERA_PRESETS) {
        const frames = flyMarker(track, LENGTH_S, steepSampler, camera, 10, 16 / 9, 1, { ...film, stops: [...film.stops], speeds: [...film.speeds] })
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.4)
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
