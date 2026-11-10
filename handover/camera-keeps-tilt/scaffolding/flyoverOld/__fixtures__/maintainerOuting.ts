import type { Track } from '../../core/types'
import { buildTrack } from '../../import/stats'

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/**
 * The outing of the report on the flyover duration and speed (4.2.0): 16.5 km walked at 2 km/h (8 h 15 moving), with a 1 h lunch and a 15 h 18 bivouac in the middle,
 * so the file says 24 h 33 elapsed. A point every minute while walking, every 3 minutes at the bivouac; the evening and the
 * morning of the bivouac are recorded, so the film has a night.
 */
export function maintainerOuting(): Track {
  const T0 = Date.UTC(2026, 6, 12, 7, 0, 0)
  const STEP_M = 2000 / 60
  const points: { lon: number; lat: number; ele: number; time: number }[] = []
  let timeMs = T0
  let northM = 0
  const at = () => points.push({ lon: 6.8, lat: 45.8 + northM / M_PER_DEG_LAT, ele: 1000, time: timeMs })
  const walk = (minutes: number) => {
    for (let i = 0; i < minutes; i++) {
      at()
      northM += STEP_M
      timeMs += 60_000
    }
  }
  const rest = (minutes: number, everyMin: number) => {
    for (let i = 0; i < minutes; i += everyMin) {
      at()
      timeMs += everyMin * 60_000
    }
  }
  walk(200)
  rest(60, 1)
  walk(100)
  rest(918, 3)
  walk(195)
  at()
  return buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })
}
