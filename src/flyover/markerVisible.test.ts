import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, CAMERA_RANGES } from './cameraSettings'
import { SIGHT_HOLD_S } from './filmCamera'
import { MARKER_TRACKS, flyMarker, steepSampler } from './__fixtures__/markerVisible'
import { flyFilm } from './__fixtures__/smoothness'

/**
 * The lead marker stays in sight whatever the camera: in the middle of the frame, and never hidden behind the relief for
 * long (`lineOfSightClearance`: below 0 the marker is not drawn at all). The flight camera glides over the relief and
 * climbs only where the marker would stay hidden SIGHT_HOLD_S or more (`filmCamera.ts`): a moment behind a ridge stays,
 * as in a drone shot. Twisty tracks (switchbacks, loops, right angles) over a steep synthetic massif, every camera
 * preset, 60 s flights, measured at 10 fps: at most 1.3 s hidden in a row, 7 % of a flight at most (« Oiseau » on the
 * switchbacks), 2 % of the switchback flights and under 0.1 % of the others, 10 switches between shown and hidden at most.
 * The marker stays within 0.15 of the half-frame from its centre, 0.2 through stops (the aim stands on a smoothed line,
 * `cameraLine`), plus the share « Espace devant » moves it back by on purpose (`leadRoomPct`), and in every case within
 * 0.65 of the half-frame with that setting and « Inclinaison dans les virages » at their maximum.
 */
const LENGTH_S = 60
/** the presets that follow the marker ('free' follows nothing but the keyframes, by design) */
const FOLLOWING = CAMERA_PRESETS.filter((p) => p.camera.style !== 'free')
const edge = (f: { ndcX: number; ndcY: number }) => (Number.isNaN(f.ndcX) ? Infinity : Math.max(Math.abs(f.ndcX), Math.abs(f.ndcY)))

describe('marker visibility', { timeout: 120_000 }, () => {
  for (const [name, make] of Object.entries(MARKER_TRACKS)) {
    const track = make()

    it(`${name}: no camera preset hides the marker behind the relief for long`, () => {
      let hiddenFrames = 0
      let allFrames = 0
      for (const { name: preset, camera } of FOLLOWING) {
        const frames = flyMarker(track, LENGTH_S, steepSampler, camera, 10)
        const hidden = frames.map((f) => f.clearanceM < 0)
        hiddenFrames += hidden.filter(Boolean).length
        allFrames += frames.length
        expect(hidden.filter(Boolean).length / frames.length, preset).toBeLessThan(0.08)
        // never hidden for SIGHT_HOLD_S in a row (10 frames a second)
        let run = 0
        let longest = 0
        for (const h of hidden) {
          run = h ? run + 1 : 0
          longest = Math.max(longest, run)
        }
        expect(longest / 10, preset).toBeLessThan(SIGHT_HOLD_S)
        // little blinking: shown and hidden swap a few times at most over the flight
        expect(hidden.filter((h, i) => i > 0 && h !== hidden[i - 1]).length, preset).toBeLessThanOrEqual(12)
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.15 + camera.leadRoomPct / 100)
      }
      expect(hiddenFrames / allFrames).toBeLessThan(0.025)
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
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.2 + camera.leadRoomPct / 100)
      }
    })

    it(`${name}: the marker stays comfortably in the frame with the lead room and the bank at their maximum`, () => {
      for (const { name: preset, camera } of FOLLOWING) {
        const { max: leadRoomPct } = CAMERA_RANGES.leadRoomPct
        const frames = flyMarker(track, LENGTH_S, steepSampler, { ...camera, leadRoomPct, bankDeg: CAMERA_RANGES.bankDeg.max }, 10)
        expect(Math.max(...frames.map(edge)), preset).toBeLessThan(0.65)
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
