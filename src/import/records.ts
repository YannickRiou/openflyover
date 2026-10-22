/**
 * « Records de la sortie »: the feats of an outing found in its points (steepest stretch, fastest descent, highest and
 * lowest points, fastest and slowest kilometre, longest climb, peak heart rate and power), each one a place along the
 * track with its value. Pure functions (no DOM, React or Three); the landmark list turns them into landmarks
 * (`recordLandmarks`, `osm/landmarks.ts`). See ARCHITECTURE.md "Records".
 *
 * Computed from the points only, never from the figures corrected by hand: elevations are the despiked, smoothed ones of
 * the climbs (`resampleElevation`), times count the time spent moving (a pause is not a slow kilometre), and a stretch
 * that implies more than `MAX_SPEED_KMH` is a GPS jump, never a record.
 */
import type { Track, TrackPoint } from '../core/types'
import { SMOOTHING_WINDOW_M, climbsOf, movingAverage, resampleElevation } from '../flyover/climbs'
import { samplePath, trackPathOf } from '../flyover/path'
import { formatNumber } from '../ui/format'
import { t } from '../i18n'

export const RECORD_KINDS = [
  'steepestClimb',
  'fastestDescent',
  'highest',
  'lowest',
  'fastestKm',
  'slowestKm',
  'longestClimb',
  'maxHeartRate',
  'maxPower',
] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

export interface TrackRecord {
  kind: RecordKind
  /** distance along the track (metres, the scale of `buildTrackPath`), the middle of a stretch */
  alongM: number
  lon: number
  lat: number
  /** gradient (%), speed (km/h), elevation (m), time of a kilometre (s), length of a climb (m), heart rate (bpm) or power (W) */
  value: number
  /** length of the stretch (metres): the steepest stretch and the longest climb */
  lengthM?: number
  /** average gradient (%) of the longest climb */
  gradientPct?: number
}

/** No record under this length (metres). */
export const MIN_RECORD_TRACK_M = 1000
/** Spacing of the grid the records are looked for on (metres), as the climbs. */
const STEP_M = 20
/** Lengths of the stretches tried for the steepest climb (metres), the longest one within `GRADIENT_TOLERANCE` of the best kept. */
const STEEP_LENGTHS_M = [300, 400, 500] as const
const GRADIENT_TOLERANCE = 0.005
/** Gradients below this are not a record (fraction of 1). */
const MIN_STEEP_GRADIENT = 0.03
/** Length of the fastest descent and of a kilometre (metres). */
const KM_M = 1000
/** A descent loses at least this much over its kilometre (metres). */
const MIN_DESCENT_DROP_M = 20
/** A descent slower than this is a walk, not a record (km/h). */
const MIN_DESCENT_KMH = 8
/** A stretch implying a higher speed is a GPS jump (km/h). */
export const MAX_SPEED_KMH = 150
/** Below this speed the time does not count as moving (m/s). */
const MOVING_MIN_MS = 0.3
/** The highest point is a record from this range of elevation, the lowest from the second (metres). */
const MIN_HIGH_RANGE_M = 30
const MIN_LOW_RANGE_M = 100
/** Neither the lowest point near an end of the track nor the highest near its start are records (metres). */
const END_MARGIN_M = 200
/** Window of the heart rate and power peaks: seconds with times, points without. */
const PEAK_SPAN_S = 30
const PEAK_POINTS = 10

/** Median of five samples around each one (spikes of up to two samples vanish), the ends unchanged. */
function despike(values: Float64Array): Float64Array {
  const out = Float64Array.from(values)
  for (let i = 2; i < values.length - 2; i++) out[i] = [values[i - 2], values[i - 1], values[i], values[i + 1], values[i + 2]].sort((a, b) => a - b)[2]
  return out
}

interface Grid {
  count: number
  /** smoothed elevation every `STEP_M`, absent without elevation */
  ele?: Float64Array
  /** the same without the smoothing, spikes removed */
  eleRaw?: Float64Array
  /** time spent moving since the start (seconds), absent without times */
  moving?: Float64Array
  /** prefix count of the cells that hold a GPS jump */
  jumps?: Int32Array
}

/** Moving time and GPS jumps on the grid, from the timed points (bridged by distance over the points without time). */
function timeGrid(flat: readonly TrackPoint[], dist: Float64Array, count: number): Pick<Grid, 'moving' | 'jumps'> {
  const timed: number[] = []
  for (let i = 0; i < flat.length; i++) if (flat[i].time !== undefined && Number.isFinite(flat[i].time)) timed.push(i)
  if (timed.length < 2) return {}
  const moving = new Float64Array(timed.length)
  const cellJump = new Uint8Array(count)
  for (let k = 1; k < timed.length; k++) {
    const a = timed[k - 1]
    const b = timed[k]
    const dt = (flat[b].time! - flat[a].time!) / 1000
    const dd = dist[b] - dist[a]
    const jump = dt > 0 ? dd / dt > MAX_SPEED_KMH / 3.6 : dd > 0
    // a pause or a recording gap (the distance barely moves) is not moving time
    moving[k] = moving[k - 1] + (dt > 0 && !jump && dd / dt >= MOVING_MIN_MS ? dt : 0)
    if (jump) for (let c = Math.floor(dist[a] / STEP_M); c <= Math.min(count - 1, Math.floor(dist[b] / STEP_M)); c++) cellJump[c] = 1
  }
  const grid = new Float64Array(count)
  let k = 0
  for (let s = 0; s < count; s++) {
    const d = s * STEP_M
    while (k < timed.length - 2 && dist[timed[k + 1]] <= d) k++
    const span = dist[timed[k + 1]] - dist[timed[k]]
    const f = span > 0 ? Math.min(1, Math.max(0, (d - dist[timed[k]]) / span)) : 0
    grid[s] = moving[k] + (moving[k + 1] - moving[k]) * f
  }
  const jumps = new Int32Array(count + 1)
  for (let s = 0; s < count; s++) jumps[s + 1] = jumps[s] + cellJump[s]
  return { moving: grid, jumps }
}

/** Seconds of moving time between grid cells `from` and `to` (cells), undefined across a GPS jump. */
function movingS(grid: Grid, from: number, to: number): number | undefined {
  if (!grid.moving || !grid.jumps || grid.jumps[to + 1] - grid.jumps[from] > 0) return undefined
  const s = grid.moving[to] - grid.moving[from]
  return s > 0 ? s : undefined
}

/** Best mean of `values` over `PEAK_SPAN_S` seconds (or `PEAK_POINTS` points without times): the point at its middle and the mean. */
function peak(flat: readonly TrackPoint[], key: 'hr' | 'power', lo: number, hi: number): { index: number; value: number } | undefined {
  const times = flat.map((p) => (p.time !== undefined && Number.isFinite(p.time) ? p.time / 1000 : Number.NaN))
  const timed = times.filter((x) => !Number.isNaN(x)).length > flat.length / 2
  let best: { index: number; value: number } | undefined
  let valid = 0
  for (let i = 0; i < flat.length; i++) {
    const v = flat[i][key]
    if (v === undefined || !(v >= lo && v <= hi)) continue
    valid++
    let sum = 0
    let n = 0
    for (let j = i; j >= 0 && (timed ? times[i] - times[j] <= PEAK_SPAN_S / 2 : i - j <= PEAK_POINTS / 2); j--) {
      const w = flat[j][key]
      if (w !== undefined && w >= lo && w <= hi) {
        sum += w
        n++
      }
    }
    for (let j = i + 1; j < flat.length && (timed ? times[j] - times[i] <= PEAK_SPAN_S / 2 : j - i <= PEAK_POINTS / 2); j++) {
      const w = flat[j][key]
      if (w !== undefined && w >= lo && w <= hi) {
        sum += w
        n++
      }
    }
    if (n > 0 && (!best || sum / n > best.value)) best = { index: i, value: sum / n }
  }
  return valid >= 10 ? best : undefined
}

/**
 * The records of a track, in no particular order, each kind at most once; none under 1 km, and only those the points
 * allow (no elevation: no climb, descent or altitude; no time: no speed or kilometre; no sensor: no heart rate or power).
 */
export function detectRecords(track: Track): TrackRecord[] {
  const path = trackPathOf(track)
  if (!(path.lengthM >= MIN_RECORD_TRACK_M)) return []
  const flat = track.segments.flatMap((s) => s.points)
  const count = Math.ceil(path.lengthM / STEP_M) + 1
  const raw = resampleElevation(path, STEP_M)
  const eleRaw = raw && despike(raw)
  const grid: Grid = {
    count,
    eleRaw,
    ele: eleRaw && movingAverage(eleRaw, Math.round(SMOOTHING_WINDOW_M / STEP_M / 2)),
    ...timeGrid(flat, path.dist, count),
  }
  const out: TrackRecord[] = []
  const at = (alongM: number, record: Omit<TrackRecord, 'alongM' | 'lon' | 'lat'>) => {
    const p = samplePath(path, alongM)
    out.push({ ...record, alongM, lon: p.lon, lat: p.lat })
  }
  const { ele } = grid
  let descent: { from: number; to: number } | undefined

  if (ele) {
    // steepest climb: the steepest of the tried lengths, the longest one that is almost as steep
    const tried = STEEP_LENGTHS_M.map((lengthM) => {
      const w = lengthM / STEP_M
      let best = { gradient: -Infinity, from: 0 }
      for (let i = 0; i + w < count; i++) {
        const gradient = (ele[i + w] - ele[i]) / lengthM
        if (gradient > best.gradient) best = { gradient, from: i }
      }
      return { lengthM, ...best }
    })
    const top = Math.max(...tried.map((x) => x.gradient))
    const steep = tried.filter((x) => x.gradient >= top - GRADIENT_TOLERANCE).at(-1)
    if (steep && steep.gradient >= MIN_STEEP_GRADIENT) {
      at((steep.from * STEP_M + steep.lengthM / 2), { kind: 'steepestClimb', value: steep.gradient * 100, lengthM: steep.lengthM })
    }

    // fastest descent: the kilometre going down at the highest mean speed
    const w = KM_M / STEP_M
    let fastest = { kmh: 0, from: -1 }
    for (let i = 0; i + w < count; i++) {
      if (ele[i] - ele[i + w] < MIN_DESCENT_DROP_M) continue
      const s = movingS(grid, i, i + w)
      if (s !== undefined && KM_M / s > fastest.kmh / 3.6) fastest = { kmh: (KM_M / s) * 3.6, from: i }
    }
    if (fastest.from >= 0 && fastest.kmh >= MIN_DESCENT_KMH) {
      descent = { from: fastest.from, to: fastest.from + w }
      at(fastest.from * STEP_M + KM_M / 2, { kind: 'fastestDescent', value: fastest.kmh, lengthM: KM_M })
    }

    // highest and lowest points
    let hi = 0
    let lo = 0
    for (let i = 1; i < count; i++) {
      if (ele[i] > ele[hi]) hi = i
      if (ele[i] < ele[lo]) lo = i
    }
    const range = ele[hi] - ele[lo]
    if (range >= MIN_HIGH_RANGE_M && hi * STEP_M >= END_MARGIN_M) {
      // the recorded height around the top, not its smoothed value
      const near = Array.from(eleRaw!.slice(Math.max(0, hi - 3), hi + 4))
      at(hi * STEP_M, { kind: 'highest', value: Math.max(...near) })
    }
    if (range >= MIN_LOW_RANGE_M && lo * STEP_M >= END_MARGIN_M && path.lengthM - lo * STEP_M >= END_MARGIN_M) {
      at(lo * STEP_M, { kind: 'lowest', value: Math.min(...Array.from(eleRaw!.slice(Math.max(0, lo - 3), lo + 4))) })
    }
  }

  // fastest and slowest whole kilometre, as the kilometre markers count them
  if (grid.moving) {
    const w = KM_M / STEP_M
    const times: { km: number; s: number }[] = []
    for (let k = 0; (k + 1) * w < count && (k + 1) * KM_M <= path.lengthM; k++) {
      const s = movingS(grid, k * w, (k + 1) * w)
      if (s !== undefined) times.push({ km: k, s })
    }
    if (times.length >= 2) {
      const fast = times.reduce((a, b) => (b.s < a.s ? b : a))
      const slow = times.reduce((a, b) => (b.s > a.s ? b : a))
      const middleCell = (fast.km + 0.5) * w
      // the same stretch as the fastest descent is one record
      const insideDescent = descent !== undefined && middleCell >= descent.from && middleCell <= descent.to
      if (slow.s - fast.s >= 1) {
        if (!insideDescent) at((fast.km + 0.5) * KM_M, { kind: 'fastestKm', value: fast.s, lengthM: KM_M })
        at((slow.km + 0.5) * KM_M, { kind: 'slowestKm', value: slow.s, lengthM: KM_M })
      }
    }
  }

  // the longest climb, when the track has several
  const climbs = climbsOf(track)
  if (climbs.length >= 2) {
    const longest = climbs.reduce((a, b) => (b.lengthM > a.lengthM ? b : a))
    at(longest.endDistM, { kind: 'longestClimb', value: longest.lengthM, lengthM: longest.lengthM, gradientPct: longest.avgGradient * 100 })
  }

  // peak heart rate and power
  const heart = peak(flat, 'hr', 30, 250)
  if (heart) at(path.dist[heart.index], { kind: 'maxHeartRate', value: heart.value })
  const power = peak(flat, 'power', 1, 3000)
  if (power) at(path.dist[power.index], { kind: 'maxPower', value: power.value })
  return out
}

/** keyed by the points, like `climbsOf` */
const cache = new WeakMap<Track['segments'], TrackRecord[]>()

/** `detectRecords`, cached per list of points (tracks are immutable in the store; a track only recoloured keeps its records). */
export function recordsOf(track: Track): TrackRecord[] {
  let records = cache.get(track.segments)
  if (!records) {
    records = detectRecords(track)
    cache.set(track.segments, records)
  }
  return records
}

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

/** 161 s -> « 2 min 41 », 45 s -> « 45 s ». */
function formatKmTime(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return t('format.seconds', { value: total })
  return t('format.minutesSeconds', { minutes: Math.floor(total / 60), seconds: String(total % 60).padStart(2, '0') })
}

/** « 18 % sur 400 m »: the value of a record with its unit, in the language of the interface. */
export function recordValueText(record: TrackRecord): string {
  const { value, lengthM = 0 } = record
  switch (record.kind) {
    case 'steepestClimb':
      return t('landmarks.record.over', { value: t('format.percent', { value: formatNumber(value, value < 10 ? 1 : 0) }), length: `${formatNumber(lengthM)} m` })
    case 'fastestDescent':
      return t('landmarks.record.over', { value: t('camera.speed.kmh', { value: formatNumber(value) }), length: '1 km' })
    case 'highest':
    case 'lowest':
      return `${formatNumber(value)} m`
    case 'fastestKm':
    case 'slowestKm':
      return formatKmTime(value)
    case 'longestClimb':
      return t('landmarks.record.climb', { length: `${formatNumber(value / 1000, 1)} km`, gradient: t('format.percent', { value: formatNumber(record.gradientPct ?? 0, 1) }) })
    case 'maxHeartRate':
      return `${formatNumber(value)} bpm`
    case 'maxPower':
      return `${formatNumber(value)} W`
  }
}

/** « Montée la plus raide · 18 % sur 400 m » */
export function recordText(record: TrackRecord): string {
  return `${t(`landmarks.record.${record.kind}`)} · ${recordValueText(record)}`
}
