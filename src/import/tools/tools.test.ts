// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Track, TrackPoint, TrackSegment } from '../../core/types'
import { haversineM } from '../../geo/lonLat'
import { parseGpx } from '../gpx'
import { buildTrack } from '../stats'
import { withSegments } from './common'
import { cutSection } from './cutSection'
import { gpxFileName, trackToGpx } from './exportGpx'
import { findPauses, removePauses } from './removePauses'
import { findSpikes, removeSpikes } from './removeSpikes'
import { reverse } from './reverse'
import { clockOf, instantOf, shiftTime } from './shiftTime'
import { simplify } from './simplify'
import { trim } from './trim'

const T0 = Date.UTC(2026, 6, 12, 8, 0, 0)

/** `n` points 11 m apart going north, one every `dtS` seconds from `T0` (no time when `dtS` is 0). */
function line(n: number, dtS = 10, from = 0, lon = 6): TrackSegment {
  const points: TrackPoint[] = []
  for (let i = 0; i < n; i++) {
    const p: TrackPoint = { lon, lat: 45 + (from + i) * 0.0001, ele: 1000 + i }
    if (dtS > 0) p.time = T0 + (from + i) * dtS * 1000
    points.push(p)
  }
  return { points }
}

const flat = (segments: readonly TrackSegment[]): TrackPoint[] => segments.flatMap((s) => s.points)
const times = (segments: readonly TrackSegment[]): (number | undefined)[] => flat(segments).map((p) => p.time)

describe('trim', () => {
  it('keeps the points from first to last over several segments, times untouched', () => {
    const segments = [line(5, 10, 0), line(5, 10, 20)]
    const out = trim(segments, 3, 6)
    expect(out.map((s) => s.points.length)).toEqual([2, 2])
    expect(flat(out)[0]).toBe(segments[0].points[3])
    expect(flat(out)[3]).toBe(segments[1].points[1])
  })

  it('drops a segment that is cut away entirely', () => {
    expect(trim([line(3), line(3, 10, 10)], 3, 5)).toHaveLength(1)
  })

  it('returns the same array when nothing is cut, when the range is empty or too short, and on no point', () => {
    const segments = [line(6)]
    expect(trim(segments, 0, 5)).toBe(segments)
    expect(trim(segments, -3, 99)).toBe(segments)
    expect(trim(segments, 4, 2)).toBe(segments)
    expect(trim(segments, 3, 3)).toBe(segments)
    const none: TrackSegment[] = []
    expect(trim(none, 0, 3)).toBe(none)
    const one = [line(1)]
    expect(trim(one, 0, 0)).toBe(one)
  })
})

describe('cutSection', () => {
  it('joins the two sides in one segment, the time gap kept', () => {
    const out = cutSection([line(10)], 3, 5, 'join')
    expect(out).toHaveLength(1)
    expect(out[0].points).toHaveLength(7)
    expect(out[0].points[3].time! - out[0].points[2].time!).toBe(40_000)
  })

  it('splits the two sides in two segments of the track', () => {
    const out = cutSection([line(10)], 3, 5, 'split')
    expect(out.map((s) => s.points.length)).toEqual([3, 4])
  })

  it('cuts across segments: join merges the two ends, split keeps them apart, a segment inside goes', () => {
    const segments = [line(4, 10, 0), line(4, 10, 10), line(4, 10, 20)]
    expect(cutSection(segments, 2, 9, 'join').map((s) => s.points.length)).toEqual([4])
    expect(cutSection(segments, 2, 9, 'split').map((s) => s.points.length)).toEqual([2, 2])
  })

  it('keeps the segments of the file where nothing is cut', () => {
    const out = cutSection([line(4), line(4, 10, 10)], 1, 1, 'join')
    expect(out.map((s) => s.points.length)).toEqual([3, 4])
  })

  it('cutting from the start or to the end acts as a trim', () => {
    expect(cutSection([line(6)], 0, 1, 'split').map((s) => s.points.length)).toEqual([4])
    expect(cutSection([line(6)], 4, 5, 'join').map((s) => s.points.length)).toEqual([4])
  })

  it('changes nothing for an empty range, no point, or too few points left', () => {
    const segments = [line(6)]
    expect(cutSection(segments, 4, 2, 'join')).toBe(segments)
    expect(cutSection(segments, 0, 5, 'join')).toBe(segments)
    expect(cutSection(segments, 0, 4, 'join')).toBe(segments)
    const none: TrackSegment[] = []
    expect(cutSection(none, 0, 1, 'join')).toBe(none)
  })
})

describe('removeSpikes', () => {
  function withSpike(): TrackSegment[] {
    const segment = line(30, 1)
    segment.points[15] = { ...segment.points[15], lon: segment.points[15].lon + 0.01 }
    return [segment]
  }

  it('drops a point that jumps away and comes back', () => {
    const segments = withSpike()
    expect(findSpikes(segments)).toEqual([15])
    const out = removeSpikes(segments)
    expect(flat(out)).toHaveLength(29)
    expect(flat(out).some((p) => p.lon > 6.005)).toBe(false)
  })

  it('works without times, on the distance alone', () => {
    const segment = line(30, 0)
    segment.points[15] = { ...segment.points[15], lon: segment.points[15].lon + 0.01 }
    expect(findSpikes([segment])).toEqual([15])
  })

  it('leaves a real jump (the track goes on from there) and a wobble below the minimum', () => {
    const jump: TrackSegment = { points: [...line(15, 1).points, ...line(15, 1, 15, 6.01).points] }
    expect(findSpikes([jump])).toEqual([])
    const wobble = line(30, 1)
    wobble.points[15] = { ...wobble.points[15], lon: wobble.points[15].lon + 0.0005 }
    expect(findSpikes([wobble])).toEqual([])
  })

  it('does not call a fast leg a spike when the track is fast all along', () => {
    // 200 m every second for the whole track: the median speed is the speed of the track
    const fast: TrackSegment = { points: Array.from({ length: 20 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.002, time: T0 + i * 1000 })) }
    expect(findSpikes([fast])).toEqual([])
  })

  it('a higher factor spares what a lower one drops, and no spike gives the same array', () => {
    const segments = withSpike()
    expect(findSpikes(segments, { factor: 1_000_000, minJumpM: 100 })).toEqual([])
    const clean = [line(10, 1)]
    expect(removeSpikes(clean)).toBe(clean)
    const none: TrackSegment[] = []
    expect(removeSpikes(none)).toBe(none)
    const two = [line(2, 1)]
    expect(removeSpikes(two)).toBe(two)
  })

  it('numbers the spikes over several segments', () => {
    const [first] = withSpike()
    expect(findSpikes([line(5, 1), first])).toEqual([20])
  })
})

describe('removePauses', () => {
  /** walks 11 m every 10 s, stands still 5 minutes (a point every 10 s), walks on */
  function walkStopWalk(): TrackSegment {
    const points: TrackPoint[] = []
    let t = T0
    let lat = 45
    for (let i = 0; i < 10; i++, t += 10_000, lat += 0.0001) points.push({ lon: 6, lat, time: t })
    for (let i = 0; i < 30; i++, t += 10_000) points.push({ lon: 6, lat, time: t })
    for (let i = 0; i < 10; i++, t += 10_000, lat += 0.0001) points.push({ lon: 6, lat, time: t })
    return { points }
  }

  it('finds the stop, where and how long', () => {
    const [pause, ...rest] = findPauses([walkStopWalk()])
    expect(rest).toEqual([])
    expect(pause.fromIndex).toBe(10)
    expect(pause.toIndex).toBe(40)
    expect(pause.durationS).toBe(300)
    expect(pause.lat).toBeCloseTo(45.001, 6)
  })

  it('drops the stop and moves the later times back by its duration', () => {
    const before = [walkStopWalk()]
    const out = removePauses(before)
    expect(flat(out)).toHaveLength(flat(before).length - 30)
    const last = flat(out).at(-1)!
    expect(last.time).toBe(flat(before).at(-1)!.time! - 300_000)
    const t = times(out) as number[]
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true)
  })

  it('keeps a stop shorter than the duration, honours the thresholds, keeps the gap between segments', () => {
    const segments = [walkStopWalk()]
    expect(removePauses(segments, { maxSpeedKmh: 1, minDurationS: 400 })).toBe(segments)
    expect(findPauses(segments, { maxSpeedKmh: 1, minDurationS: 100 })).toHaveLength(1)
    // walking at 4 km/h is not slow for 1 km/h, but is for 5 km/h
    expect(findPauses([line(30, 10)], { maxSpeedKmh: 1, minDurationS: 60 })).toEqual([])
    expect(findPauses([line(30, 10)], { maxSpeedKmh: 5, minDurationS: 60 })).toHaveLength(1)
  })

  it('shifts the segments after the stop and leaves a track without times as it is', () => {
    const night = walkStopWalk()
    const later: TrackSegment = { points: night.points.slice(0, 5).map((p) => ({ ...p, time: p.time! + 86_400_000 })) }
    const out = removePauses([walkStopWalk(), later])
    expect(out[1].points[0].time).toBe(later.points[0].time! - 300_000)
    const untimed = [line(10, 0)]
    expect(findPauses(untimed)).toEqual([])
    expect(removePauses(untimed)).toBe(untimed)
    const none: TrackSegment[] = []
    expect(removePauses(none)).toBe(none)
  })

  it('a stop at the end of the track goes, the earlier times stay', () => {
    const points = [...line(5, 10).points]
    const last = points[4]
    for (let i = 1; i <= 20; i++) points.push({ ...last, time: last.time! + i * 10_000 })
    const out = removePauses([{ points }])
    expect(flat(out)).toHaveLength(5)
    expect(flat(out)[4].time).toBe(last.time)
  })
})

describe('simplify', () => {
  it('drops the points of a straight line, keeps the ends and the data of the others', () => {
    const segments = [line(50, 10)]
    const out = simplify(segments, 2)
    expect(flat(out)).toHaveLength(2)
    expect(flat(out)[0]).toBe(segments[0].points[0])
    expect(flat(out)[1]).toBe(segments[0].points[49])
  })

  it('keeps a corner above the tolerance and drops it above', () => {
    const points: TrackPoint[] = [
      { lon: 6, lat: 45, ele: 1 },
      { lon: 6.0003, lat: 45.0005, ele: 2 },
      { lon: 6, lat: 45.001, ele: 3 },
    ]
    expect(flat(simplify([{ points }], 5))).toHaveLength(3)
    expect(flat(simplify([{ points }], 100))).toHaveLength(2)
  })

  it('works per segment, and gives the same array when no point can go', () => {
    const out = simplify([line(20), line(20, 10, 100)], 2)
    expect(out.map((s) => s.points.length)).toEqual([2, 2])
    const two = [line(2)]
    expect(simplify(two, 2)).toBe(two)
    const none: TrackSegment[] = []
    expect(simplify(none)).toBe(none)
  })
})

describe('reverse', () => {
  it('reverses the points and the segments, keeps the measures, mirrors the times', () => {
    const a = line(3, 10, 0)
    const b = line(3, 20, 100)
    a.points[0] = { ...a.points[0], hr: 90 }
    const out = reverse([a, b])
    expect(out).toHaveLength(2)
    expect(flat(out).map((p) => p.lat)).toEqual(flat([a, b]).map((p) => p.lat).reverse())
    expect(flat(out).at(-1)!.hr).toBe(90)
    const t = times(out) as number[]
    expect(t[0]).toBe(T0)
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true)
    // the gaps are mirrored: the last 20 s of the old track come first
    expect(t[1] - t[0]).toBe(20_000)
    expect(t.at(-1)).toBe(flat([a, b]).at(-1)!.time)
  })

  it('reversing twice gives the track back', () => {
    const segments = [line(5, 10), line(3, 30, 50)]
    expect(flat(reverse(reverse(segments)))).toEqual(flat(segments))
  })

  it('works without times, and leaves an empty or single-point track', () => {
    expect(flat(reverse([line(4, 0)])).map((p) => p.ele)).toEqual([1003, 1002, 1001, 1000])
    const one = [line(1)]
    expect(reverse(one)).toBe(one)
    const none: TrackSegment[] = []
    expect(reverse(none)).toBe(none)
  })
})

describe('shiftTime', () => {
  it('moves every time by the signed offset', () => {
    const segments = [line(3, 10)]
    expect(times(shiftTime(segments, 3_600_000))).toEqual(times(segments).map((t) => t! + 3_600_000))
    expect(times(shiftTime(segments, -60_000))).toEqual(times(segments).map((t) => t! - 60_000))
  })

  it('leaves the same array for no offset or without times', () => {
    const segments = [line(3, 10)]
    expect(shiftTime(segments, 0)).toBe(segments)
    const untimed = [line(3, 0)]
    expect(shiftTime(untimed, 3_600_000)).toBe(untimed)
    const none: TrackSegment[] = []
    expect(shiftTime(none, 1000)).toBe(none)
  })

  it('reads and writes a start on the clock of the track', () => {
    expect(clockOf(Date.UTC(2026, 6, 12, 8, 30), 120)).toEqual({ day: '2026-07-12', time: '10:30' })
    expect(instantOf('2026-07-12', '10:30', 120)).toBe(Date.UTC(2026, 6, 12, 8, 30))
    expect(instantOf('', '10:30', 0)).toBeUndefined()
  })
})

describe('withSegments', () => {
  it('rebuilds the figures, drops the indexed data and keeps what was corrected by hand', () => {
    const track: Track = {
      ...buildTrack({ name: 'Tracé', source: 'gpx', segments: [line(50, 10)] }),
      flights: [{ startM: 0, endM: 10, offsetM: 0 }],
      statsOverride: { distanceM: 1234 },
    }
    const next = withSegments(track, trim(track.segments, 10, 29))
    expect(next.stats.pointCount).toBe(20)
    expect(next.stats.distanceM).toBeCloseTo(19 * haversineM(track.segments[0].points[0], track.segments[0].points[1]), 3)
    expect(next.stats.durationS).toBe(190)
    expect(next.bounds.south).toBeCloseTo(45.001, 6)
    expect(next).not.toHaveProperty('flights')
    expect(next.statsOverride).toEqual({ distanceM: 1234 })
    expect(next.id).toBe(track.id)
    expect(withSegments(track, track.segments)).toBe(track)
  })
})

describe('trackToGpx', () => {
  it('writes a GPX 1.1 that opens again with its segments, times, measures and waypoints', () => {
    const a = line(3, 10)
    a.points[1] = { ...a.points[1], hr: 120, cad: 80, power: 200, temp: 12 }
    const track: Track = {
      ...buildTrack({ name: 'Tour <du> "Lac" & co', source: 'gpx', segments: [a, line(2, 10, 50)], activityType: 'running' }),
      waypoints: [{ lon: 6, lat: 45, ele: 1200, name: 'Col & croix' }],
    }
    const xml = trackToGpx(track)
    expect(xml).toContain('<gpx version="1.1"')
    const [back] = parseGpx(xml, 'x.gpx')
    expect(back.name).toBe(track.name)
    expect(back.activityType).toBe('running')
    expect(back.segments.map((s) => s.points.length)).toEqual([3, 2])
    expect(back.segments[0].points[1]).toEqual(a.points[1])
    expect(back.segments[1].points[0]).toEqual(track.segments[1].points[0])
    expect(back.waypoints).toEqual([{ lon: 6, lat: 45, ele: 1200, name: 'Col & croix' }])
  })

  it('writes a track without times or elevation, and a safe file name', () => {
    const track = buildTrack({ name: 'a/b: c', source: 'gpx', segments: [{ points: [{ lon: 6, lat: 45 }, { lon: 6.1, lat: 45.1 }] }] })
    const xml = trackToGpx(track)
    expect(xml).not.toContain('<time>')
    expect(xml).not.toContain('<ele>')
    expect(parseGpx(xml, 'x.gpx')[0].segments[0].points).toHaveLength(2)
    expect(gpxFileName(track)).toBe('a b c.gpx')
    expect(gpxFileName({ ...track, name: '  ' })).toBe('trace.gpx')
  })
})
