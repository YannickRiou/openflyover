// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import type { TrackPoint } from '../core/types'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from '../flyover/path'
import { osmAttribution } from '../osm/overpass'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { openMeteoAttribution } from '../weather/openMeteo'
import type { WeatherSummary } from '../weather/series'
import type { Racer } from '../flyover/race'
import { DEFAULT_DAY_CARDS, DEFAULT_FILM, STAGE_CARD_FIELDS } from '../film/model'
import { withDefaultCard, withJunctionCard } from '../film/junctions'
import { buildSequence } from '../flyover/sequence'
import {
  cumulativeAscent,
  dayCardAt,
  leaderboardRows,
  miniMapOutline,
  overlayCredits,
  overlayFilmFrameAt,
  overlayFrameAt,
  prepareOverlayFilm,
  prepareOverlayTrack,
  STAGE_CARD_S,
  stageCardAt,
} from './data'

/** metres per degree of latitude on the haversine sphere */
const M_PER_DEG = (6371008.8 * Math.PI) / 180
const T0 = Date.UTC(2025, 6, 12, 7)

/** Points due north every 10 m, one every 5 s (7.2 km/h), elevation and extras from `extra`. */
function line(count: number, extra: (i: number) => Partial<TrackPoint>): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ lon: 6.8, lat: 45.9 + (i * 10) / M_PER_DEG, time: T0 + i * 5000, ...extra(i) }))
}

const sample = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]

describe('cumulativeAscent', () => {
  it('rises monotonically to the D+ of the track statistics', () => {
    const ascent = cumulativeAscent(sample)
    expect(ascent[0]).toBe(0)
    for (let i = 1; i < ascent.length; i++) expect(ascent[i]).toBeGreaterThanOrEqual(ascent[i - 1])
    expect(ascent[ascent.length - 1]).toBeCloseTo(sample.stats.ascentM, 6)
  })

  it('ignores GPS jitter on flat ground', () => {
    const track = buildTrack({ name: 'plat', source: 'gpx', segments: [{ points: line(200, (i) => ({ ele: 1000 + (i % 2 ? 1.5 : -1.5) })) }] })
    expect(cumulativeAscent(track)[199]).toBe(0)
  })

  it('carries the total across segments and over points without elevation', () => {
    const climb = line(50, (i) => ({ ele: 1000 + i * 2 }))
    const gap = line(5, () => ({}))
    const track = buildTrack({ name: 's', source: 'gpx', segments: [{ points: climb }, { points: [...gap, ...climb] }] })
    const ascent = cumulativeAscent(track)
    const first = ascent[49]
    expect(first).toBeGreaterThan(80)
    expect(ascent[50]).toBe(first)
    expect(ascent[54]).toBe(first)
    expect(ascent[ascent.length - 1]).toBeCloseTo(track.stats.ascentM, 6)
  })
})

describe('prepareOverlayTrack, figures corrected by hand', () => {
  it('the cards show the corrected figures, the others those of the points', () => {
    const plain = prepareOverlayTrack(sample).stats
    const fixed = prepareOverlayTrack({ ...sample, statsOverride: { maxEle: 2001, durationS: 3600 } }).stats
    expect(fixed).toEqual({ ...plain, maxEleM: 2001, durationS: 3600 })
  })
})

describe('overlayFrameAt, the sensors and the clock', () => {
  it('slope, power, temperature and the recorded time of day under the marker', () => {
    const track = buildTrack({ name: 's', source: 'fit', segments: [{ points: line(101, (i) => ({ ele: 1000 + i, power: 200, temp: 12 })) }] })
    const frame = overlayFrameAt(prepareOverlayTrack(track), 0.5)
    // 1 m up every 10 m
    expect(frame.slopePct).toBeCloseTo(10, 0)
    expect(frame.powerW).toBeCloseTo(200, 6)
    expect(frame.temperatureC).toBeCloseTo(12, 6)
    expect(frame.clockMs).toBeCloseTo(T0 + 50 * 5000, -2)
  })
})

describe('overlayFrameAt', () => {
  const data = prepareOverlayTrack(sample)

  it('starts at zero', () => {
    const frame = overlayFrameAt(data, 0)
    expect(frame).toMatchObject({ progress: 0, distanceM: 0, ascentM: 0, elapsedS: 0 })
    expect(frame.ele).toBeCloseTo(sample.segments[0].points[0].ele!, 6)
    expect(frame.heartRate).toBeGreaterThan(40)
  })

  it('ends on the whole-track figures', () => {
    const frame = overlayFrameAt(data, 1)
    expect(frame.distanceM).toBeCloseTo(sample.stats.distanceM, 6)
    expect(frame.ascentM).toBeCloseTo(sample.stats.ascentM, 6)
    expect(frame.elapsedS).toBeCloseTo(sample.stats.durationS!, 6)
    expect(data.stats).toMatchObject({ maxEleM: sample.stats.maxEle, durationS: sample.stats.durationS })
    expect(data.stats.maxSpeedKmh).toBeGreaterThan(1)
    expect(data.stats.maxSpeedKmh).toBeLessThan(20)
  })

  it('clamps the progress and interpolates in between', () => {
    expect(overlayFrameAt(data, -1).distanceM).toBe(0)
    expect(overlayFrameAt(data, 2).progress).toBe(1)
    expect(overlayFrameAt(data, Number.NaN).progress).toBe(0)
    const mid = overlayFrameAt(data, 0.5)
    expect(mid.distanceM).toBeCloseTo(sample.stats.distanceM / 2, 6)
    expect(mid.ascentM).toBeGreaterThan(0)
    expect(mid.ascentM).toBeLessThan(sample.stats.ascentM)
    expect(mid.elapsedS).toBeGreaterThan(0)
    expect(mid.speedKmh).toBeGreaterThan(0)
  })

  it('leaves out what the track does not record', () => {
    const bare = buildTrack({ name: 'nu', source: 'gpx', segments: [{ points: line(20, () => ({ time: undefined })) }] })
    const frame = overlayFrameAt(prepareOverlayTrack(bare), 0.5)
    expect(frame.distanceM).toBeGreaterThan(0)
    expect(frame.ele).toBeUndefined()
    expect(frame.ascentM).toBeUndefined()
    expect(frame.elapsedS).toBeUndefined()
    expect(frame.speedKmh).toBeUndefined()
    expect(frame.heartRate).toBeUndefined()
    expect(frame.powerW).toBeUndefined()
    expect(frame.temperatureC).toBeUndefined()
    expect(frame.clockMs).toBeUndefined()
    expect(prepareOverlayTrack(bare).profile).toBeUndefined()
  })

  it('reads the steady speed of a regular track', () => {
    const track = buildTrack({ name: 'r', source: 'gpx', segments: [{ points: line(100, (i) => ({ ele: 1000 + i })) }] })
    expect(overlayFrameAt(prepareOverlayTrack(track), 0.4).speedKmh).toBeCloseTo(7.2, 3)
  })
})

describe('mini-map outline', () => {
  const lat0 = 45.9
  const mPerDegLon = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  // 2 km due east, then 1 km due north
  const east: TrackPoint[] = Array.from({ length: 101 }, (_, i) => ({ lon: 6.8 + (i * 20) / mPerDegLon, lat: lat0, ele: 1000 }))
  const north: TrackPoint[] = Array.from({ length: 100 }, (_, j) => ({ lon: east[100].lon, lat: lat0 + ((j + 1) * 10) / M_PER_DEG, ele: 1000 }))
  const ell = buildTrack({ name: 'L', source: 'gpx', segments: [{ points: [...east, ...north] }] })
  const data = prepareOverlayTrack(ell)

  it('keeps the aspect ratio of the ground, longer side 1, north up', () => {
    const outline = data.outline!
    expect(outline.width).toBeCloseTo(1, 9)
    expect(outline.height).toBeCloseTo(0.5, 3)
    // start in the south-west corner, end in the north-east one
    expect([outline.x[0], outline.y[0]]).toEqual([0, expect.closeTo(0.5, 3)])
    expect(outline.x[outline.x.length - 1]).toBeCloseTo(1, 9)
    expect(outline.y[outline.y.length - 1]).toBeCloseTo(0, 9)
  })

  it('places the marker at the progress', () => {
    expect(overlayFrameAt(data, 0).mapPoint).toEqual({ x: 0, y: expect.closeTo(0.5, 3) })
    const half = overlayFrameAt(data, 0.5).mapPoint!
    expect(half.x).toBeCloseTo(0.75, 2) // 1.5 km of 3 km: three quarters of the eastward leg
    expect(half.y).toBeCloseTo(0.5, 3)
    const end = overlayFrameAt(data, 1).mapPoint!
    expect(end.x).toBeCloseTo(1, 9)
    expect(end.y).toBeCloseTo(0, 9)
  })

  it('keeps at most the requested points, the first and the last', () => {
    const path = buildTrackPath(sample)
    const outline = miniMapOutline(path, 100)!
    expect(path.count).toBeGreaterThan(100)
    expect(outline.x.length).toBeLessThanOrEqual(100)
    expect(outline.dist[0]).toBe(0)
    expect(outline.dist[outline.dist.length - 1]).toBe(path.lengthM)
    for (let i = 1; i < outline.dist.length; i++) expect(outline.dist[i]).toBeGreaterThanOrEqual(outline.dist[i - 1])
    expect(Math.max(outline.width, outline.height)).toBeCloseTo(1, 9)
  })

  it('handles a track that does not move, and no track', () => {
    const still = buildTrack({ name: 'arrêt', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.8, lat: 45.9 }] }] })
    const frame = overlayFrameAt(prepareOverlayTrack(still), 0.5)
    expect(frame.track.outline).toMatchObject({ width: 0, height: 0 })
    expect(frame.mapPoint).toEqual({ x: 0, y: 0 })
    expect(miniMapOutline({ ...buildTrackPath(still), count: 0 })).toBeUndefined()
  })
})

describe('overlayCredits', () => {
  it('credits relief and imagery always, the weather and the landmarks once loaded, as the status bar', () => {
    const sources = { terrainSourceId: 'mapterhorn', imagerySourceId: 'opentopomap', weather: false, landmarks: false }
    expect(overlayCredits(sources)).toEqual([
      `Relief : ${getTerrainSource('mapterhorn').attribution}`,
      `Imagerie : ${getImagerySource('opentopomap').attribution}`,
    ])
    expect(overlayCredits({ ...sources, weather: true, landmarks: true }).slice(2)).toEqual([openMeteoAttribution(), `Repères : ${osmAttribution()}`])
    // unknown ids fall back to the default sources, like the scene
    expect(overlayCredits({ ...sources, imagerySourceId: 'nope' })[1]).toBe(`Imagerie : ${getImagerySource('nope').attribution}`)
  })
})

describe('leaderboardRows', () => {
  const base = { lon: 0, lat: 0, distanceM: 0, finished: false }
  const tracks = ['Lead', 'Bob', 'Chloé', 'Dan'].map((name, i) => ({ name, color: `#00000${i}` }))

  it('ranks the racers with their colour and their time gap to the first, not to the lead track', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.4, gapMs: 90_000 },
      { ...base, index: 2, fraction: 0.6, gapMs: -60_000 },
    ]
    expect(leaderboardRows(racers, tracks)).toEqual([
      { rank: 1, name: 'Chloé', color: '#000002', gap: 'Tête' },
      { rank: 2, name: 'Lead', color: '#000000', gap: '+1 min 00' },
      { rank: 3, name: 'Bob', color: '#000001', gap: '+2 min 30' },
    ])
  })

  it('gives distance gaps when the race has no times', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.5, gapM: -300 },
      { ...base, index: 2, fraction: 0.5, gapM: 1200 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.name, r.gap])).toEqual([
      ['Chloé', 'Tête'],
      ['Lead', '−1,2 km'],
      ['Bob', '−1,5 km'],
    ])
  })

  it('shares the rank of racers at the same point with the same gap', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.5, gapMs: 0 },
      { ...base, index: 2, fraction: 0.3, gapMs: 30_000 },
      { ...base, index: 3, fraction: 0.3, gapMs: 30_000 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.rank, r.gap])).toEqual([
      [1, 'Tête'],
      [1, 'Tête'],
      [3, '+30 s'],
      [3, '+30 s'],
    ])
  })

  it('marks the first once it has finished and keeps the final gaps of the others', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 1, finished: true },
      { ...base, index: 1, fraction: 1, finished: true, gapMs: -45_000 },
      { ...base, index: 2, fraction: 0.8, gapMs: 120_000 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.name, r.gap])).toEqual([
      ['Bob', 'Arrivée'],
      ['Lead', '+45 s'],
      ['Chloé', '+2 min 45'],
    ])
  })

  it('is empty without racers', () => {
    expect(leaderboardRows([], tracks)).toEqual([])
  })
})

describe('« À la suite »', () => {
  const a = buildTrack({ name: 'J1', source: 'gpx', segments: [{ points: line(11, (i) => ({ ele: 1000 + i * 10, time: T0 + i * 60_000 })) }] })
  // J2: ~8 km farther east, untimed
  const b = buildTrack({ name: 'J2', source: 'gpx', segments: [{ points: line(21, (i) => ({ lon: 6.9, ele: 1100 + i * 10, time: undefined })) }] })
  const sequence = buildSequence([a, b])
  const film = prepareOverlayFilm(sequence.track, sequence)
  const cut = sequence.stages[1].from

  it('the figures of the stage under the marker, the name and totals of the whole for the cards', () => {
    const first = overlayFilmFrameAt(film, cut / 2)
    expect(first.distanceM).toBeCloseTo(sequence.stages[0].endM / 2, 6)
    expect(first.elapsedS).toBeCloseTo(300, 6)
    expect(first.track.name).toBe('J1 → J2')
    expect(first.track.stats.distanceM).toBeCloseTo(sequence.stages[1].endM, 6)
    const second = overlayFilmFrameAt(film, cut)
    expect(second.distanceM).toBe(0)
    expect(second.ele).toBeCloseTo(1100, 6)
    expect(second.elapsedS).toBeUndefined()
    // one track: as before
    const alone = prepareOverlayFilm(a, null)
    expect(overlayFilmFrameAt(alone, 0.5)).toEqual(overlayFrameAt(alone.whole, 0.5))
  })

  it('the corrections of a stage move the totals of the whole, the highest point taken over the stages', () => {
    const fixedA = { ...a, statsOverride: { maxEle: 2001, distanceM: 1000, ascentM: 500, maxSpeedKmh: 30 } }
    const fixed = buildSequence([fixedA, b])
    const whole = prepareOverlayFilm(fixed.track, fixed).whole.stats
    const before = film.whole.stats
    expect(whole.maxEleM).toBe(2001)
    expect(whole.distanceM).toBeCloseTo(before.distanceM + 1000 - sequence.stages[0].endM, 6)
    expect(whole.ascentM).toBeCloseTo((before.ascentM ?? 0) + 500 - a.stats.ascentM, 6)
    expect(whole.durationS).toBe(before.durationS)
    expect(whole.maxSpeedKmh).toBe(30)
    // the stage shows its own correction
    expect(prepareOverlayFilm(fixed.track, fixed).stages?.[0].stats.maxEleM).toBe(2001)
  })

  it('each stage its own weather series, the first one that of the first track', () => {
    const first = { time: [T0], stations: [] }
    const second = { time: [T0 + 86_400_000], stations: [] }
    const withWeather = prepareOverlayFilm(sequence.track, sequence, first, { [b.id]: { series: second } })
    expect(withWeather.stages?.map((s) => s.weatherSeries)).toEqual([first, second])
    expect(prepareOverlayFilm(sequence.track, sequence, first).stages?.[1].weatherSeries).toBeUndefined()
  })

  it('the series of the first track of the list goes to its stage wherever it flies (stages reordered)', () => {
    const first = { time: [T0], stations: [] }
    const second = { time: [T0 + 86_400_000], stations: [] }
    const reordered = buildSequence([b, a])
    const out = prepareOverlayFilm(reordered.track, reordered, first, { [b.id]: { series: second } }, a.id)
    expect(out.stages?.map((s) => s.weatherSeries)).toEqual([second, first])
    // none loaded yet for the track the series is for
    expect(prepareOverlayFilm(reordered.track, reordered, first, {}, null).stages?.map((s) => s.weatherSeries)).toEqual([undefined, undefined])
  })

  it('a card for each stage as it starts: the first with the flight, the others at their cut', () => {
    const time = (timeS: number) => ({ timeS, openingS: 6, flightS: 60, totalS: 70, cutsS: [30] })
    expect(stageCardAt(sequence, time(5))).toBeNull()
    expect(stageCardAt(sequence, time(6))).toMatchObject({ name: 'J1', index: 0, count: 2, startS: 6, durationS: STAGE_CARD_S, startTime: T0 })
    expect(stageCardAt(sequence, time(6 + STAGE_CARD_S))).toBeNull()
    const second = stageCardAt(sequence, time(31))
    expect(second).toMatchObject({ name: 'J2', index: 1, startS: 30, ascentM: b.stats.ascentM })
    expect(second?.distanceM).toBeCloseTo(sequence.stages[1].endM - sequence.stages[1].startM, 6)
    expect(second?.startTime).toBeUndefined()
  })

  it('the figures of a stage card: the usual ones by default, else those chosen, with the weather of the stage when asked', () => {
    const time = (timeS: number) => ({ timeS, openingS: 6, flightS: 60, totalS: 70, cutsS: [30] })
    expect(stageCardAt(sequence, time(6))?.fields).toEqual(STAGE_CARD_FIELDS)
    expect(stageCardAt(sequence, time(6))?.outingS).toBeCloseTo(a.stats.durationS ?? 0, 6)
    const weather = { conditionCode: 0 } as unknown as WeatherSummary
    const fields = { ...STAGE_CARD_FIELDS, weather: true, duration: true }
    const film = { firstCard: { enabled: true, durationS: 5, anchor: 'center' as const, size: 1, fields } }
    const card = stageCardAt(sequence, time(6), film, () => weather)
    expect(card?.fields).toEqual(fields)
    expect(card?.weather).toBe(weather)
    // not asked for: the weather is not read
    expect(stageCardAt(sequence, time(6), {}, () => weather)?.weather).toBeUndefined()
  })

  it('the card of the film: its own duration, placement and text, off when switched off, not past the next junction', () => {
    const time = (timeS: number) => ({
      timeS,
      openingS: 6,
      flightS: 60,
      totalS: 70,
      cutsS: [30],
      junctions: [{ kind: 'fondu-noir' as const, startS: 12, holdStartS: 30, holdEndS: 32, endS: 33 }],
    })
    const own = withJunctionCard(withJunctionCard(DEFAULT_FILM, null, { durationS: 3, anchor: 'top-left', size: 1.4, text: '{name}' }), a.id, { enabled: false })
    expect(stageCardAt(sequence, time(8), own)).toMatchObject({ durationS: 3, anchor: 'top-left', size: 1.4, text: '{name}' })
    expect(stageCardAt(sequence, time(9), own)).toBeNull()
    // the junction after the first stage is the one keyed by its track; its card is the second stage's
    expect(stageCardAt(sequence, time(31), own)).toBeNull()
    expect(stageCardAt(sequence, time(31), withJunctionCard(DEFAULT_FILM, a.id, { durationS: 2 }))).toMatchObject({ name: 'J2', durationS: 2 })
    // the junction starts to fade at 12 s: the first card is gone by then
    expect(stageCardAt(sequence, time(11), withJunctionCard(DEFAULT_FILM, null, { durationS: 15 }))?.durationS).toBe(6)
    expect(stageCardAt(sequence, time(12), withJunctionCard(DEFAULT_FILM, null, { durationS: 15 }))).toBeNull()
    // the default junction hides every card, a card of its own brings its stage's back
    const hidden = withDefaultCard(DEFAULT_FILM, false)
    expect(stageCardAt(sequence, time(8), hidden)).toBeNull()
    expect(stageCardAt(sequence, time(31), withJunctionCard(hidden, a.id, { enabled: true }))).toMatchObject({ name: 'J2' })
  })
})

describe('dayCardAt', () => {
  const figures = [1, 2, 3].map((n) => ({ n, count: 3, date: `2026-06-0${n}`, distanceM: n * 1000 }))
  const cards = { enabled: true, durationS: 5, anchor: 'center' as const, size: 1, fields: DEFAULT_DAY_CARDS.fields }
  const time = (timeS: number) => ({ timeS, openingS: 6, flightS: 60, totalS: 70, dayCardsS: [6, 30, 34] })

  it('the card of the latest day started, for its duration, never past the next day', () => {
    expect(dayCardAt(figures, time(5), cards)).toBeNull()
    expect(dayCardAt(figures, time(6), cards)).toMatchObject({ startS: 6, durationS: 5, anchor: 'center' })
    expect(dayCardAt(figures, time(6), cards)?.figures.n).toBe(1)
    expect(dayCardAt(figures, time(11), cards)).toBeNull()
    expect(dayCardAt(figures, time(31), cards)?.figures.n).toBe(2)
    // the next day starts 4 s later: the card gives way to it
    expect(dayCardAt(figures, time(34), cards)?.figures.n).toBe(3)
    expect(dayCardAt(figures, time(33.9), cards)?.durationS).toBe(4)
  })

  it('nothing while off, without day starts, or when they do not match the days', () => {
    expect(dayCardAt(figures, time(7), { ...cards, enabled: false })).toBeNull()
    expect(dayCardAt(figures, time(7), undefined)).toBeNull()
    expect(dayCardAt(figures, { timeS: 7, openingS: 6, flightS: 60, totalS: 70 }, cards)).toBeNull()
    expect(dayCardAt(figures.slice(0, 2), time(7), cards)).toBeNull()
  })

  it('carries the title only when it is worded', () => {
    expect(dayCardAt(figures, time(7), cards)).not.toHaveProperty('title')
    expect(dayCardAt(figures, time(7), { ...cards, title: '  ' })).not.toHaveProperty('title')
    expect(dayCardAt(figures, time(7), { ...cards, title: 'Jour {n}/{count}' })?.title).toBe('Jour {n}/{count}')
  })
})
