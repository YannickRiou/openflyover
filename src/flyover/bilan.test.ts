import { describe, expect, it } from 'vitest'
import type { LonLatBounds, Track, TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import {
  BILAN_STAGE_MIN_S,
  addFigures,
  bilanPlanOf,
  bilanStageS,
  boxGapM,
  clusterBoxes,
  figuresBefore,
  outingFigures,
  planBilan,
} from './bilan'
import { trackPathOf } from './path'
import { DEFAULT_RACE, isValidRace } from './race'
import { filmFollowOf } from './follow'
import { filmSequenceOf, filmTrackOf, filmTracksOf, orderedTracks, playsBilan, playsInSequence, stageAt } from './sequence'

const DAY = 24 * 3600 * 1000
const MARCH = Date.UTC(2026, 2, 1, 8)

/** A short eastward line of `n` points at (`lon`, `lat`), timed from `startMs` (one point every 10 min) unless null. */
function outing(name: string, lon: number, lat: number, startMs: number | null, n = 3): Track {
  const points: TrackPoint[] = Array.from({ length: n }, (_, i) => ({
    lon: lon + i * 0.01,
    lat,
    ele: 1000 + i * 50,
    ...(startMs === null ? {} : { time: startMs + i * 10 * 60 * 1000 }),
  }))
  return buildTrack({ name, source: 'gpx', segments: [{ points }] })
}

const box = (west: number, south: number, east: number, north: number): LonLatBounds => ({ west, south, east, north })
const BILAN = { ...DEFAULT_RACE, sequence: true, bilan: true }

describe('clusterBoxes', () => {
  it('groups boxes closer than 50 km, through the ones in between', () => {
    // 0.3° of longitude at 45° is about 24 km: a chain of three is one region, the fourth (6° away) another
    const boxes = [box(6, 45, 6.1, 45.1), box(6.3, 45, 6.4, 45.1), box(6.7, 45, 6.8, 45.1), box(12, 45, 12.1, 45.1)]
    expect(clusterBoxes(boxes)).toEqual([[0, 1, 2], [3]])
  })

  it('keeps boxes 60 km apart in two regions and 40 km apart in one', () => {
    const a = box(6, 45, 6.1, 45.1)
    expect(boxGapM(a, box(6.1 + 0.55, 45, 6.8, 45.1))).toBeGreaterThan(30_000)
    expect(clusterBoxes([a, box(6.1 + 0.9, 45, 7.2, 45.1)])).toEqual([[0], [1]])
    expect(clusterBoxes([a, box(6.1 + 0.5, 45, 6.8, 45.1)])).toEqual([[0, 1]])
  })

  it('has nothing to group without boxes', () => {
    expect(clusterBoxes([])).toEqual([])
  })
})

describe('planBilan', () => {
  const june = outing('Juin', 6, 45, MARCH + 90 * DAY)
  const march = outing('Mars', 6.05, 45.02, MARCH)
  const may = outing('Mai', 6.1, 45.01, MARCH + 60 * DAY)
  const pyrenees = outing('Pyrénées', 0, 42.8, MARCH + 30 * DAY)
  const undated = outing('Sans date', 6.02, 45.03, null)

  it('puts the outings of a region in date order, regions by their first outing', () => {
    const plan = planBilan([june, pyrenees, may, march])
    expect(plan.tracks.map((t) => t.name)).toEqual(['Mars', 'Mai', 'Juin', 'Pyrénées'])
    expect(plan.regionOf).toEqual([0, 0, 0, 1])
    expect(plan.regions.map((r) => [r.firstStage, r.stageCount])).toEqual([[0, 3], [3, 1]])
  })

  it('opens with the region whose first outing is the earliest', () => {
    const plan = planBilan([pyrenees, june, march])
    expect(plan.tracks.map((t) => t.name)).toEqual(['Mars', 'Juin', 'Pyrénées'])
  })

  it('puts the outings without a date last in their region, in list order', () => {
    const plan = planBilan([undated, june, march])
    expect(plan.tracks.map((t) => t.name)).toEqual(['Mars', 'Juin', 'Sans date'])
    expect(plan.regions[0].fromMs).toBe(MARCH)
    expect(plan.regions[0].toMs).toBe(MARCH + 90 * DAY)
  })

  it('keeps a region of undated outings, last, in list order', () => {
    const lost = outing('Perdue', 0.02, 42.81, null)
    const plan = planBilan([lost, march])
    expect(plan.tracks.map((t) => t.name)).toEqual(['Mars', 'Perdue'])
    expect(plan.regions[1].fromMs).toBeUndefined()
  })

  it('adds up the figures of a region', () => {
    const plan = planBilan([june, march])
    expect(plan.regions[0].figures.distanceM).toBeCloseTo(outingFigures(june).distanceM + outingFigures(march).distanceM, 6)
    expect(plan.regions[0].figures.maxEleM).toBe(1100)
  })

  it('is kept while the tracks are, and made again when they change', () => {
    const first = bilanPlanOf([june, march])
    expect(bilanPlanOf([{ ...june, color: '#123456' }, march])).toBe(first)
    expect(bilanPlanOf([june, march, may])).not.toBe(first)
    expect(bilanPlanOf([june, { ...march, name: 'Autre' }])).not.toBe(first)
  })
})

describe('figures', () => {
  const a = outing('A', 6, 45, MARCH)
  const withOverride: Track = { ...outing('B', 6.2, 45, MARCH + DAY), statsOverride: { distanceM: 9000, ascentM: 700, maxEle: 3000, durationS: 7200 } }

  it('takes the corrected figures of an outing', () => {
    expect(outingFigures(withOverride)).toEqual({ distanceM: 9000, ascentM: 700, durationS: 7200, maxEleM: 3000 })
    expect(outingFigures(a).distanceM).toBeCloseTo(trackPathOf(a).lengthM, 6)
  })

  it('adds the outings up, the highest point being the highest', () => {
    const total = addFigures([outingFigures(a), outingFigures(withOverride)])
    expect(total.distanceM).toBeCloseTo(outingFigures(a).distanceM + 9000, 6)
    expect(total.ascentM).toBeCloseTo((outingFigures(a).ascentM ?? 0) + 700, 6)
    expect(total.maxEleM).toBe(3000)
    expect(total.durationS).toBe(7200 + (outingFigures(a).durationS ?? 0))
  })

  it('has no figure a track does not record, only for those that never do', () => {
    const flat = buildTrack({ name: 'Plat', source: 'gpx', segments: [{ points: [{ lon: 6, lat: 45 }, { lon: 6.01, lat: 45 }] }] })
    expect(addFigures([outingFigures(flat)])).toMatchObject({ ascentM: undefined, durationS: undefined, maxEleM: undefined })
    expect(addFigures([outingFigures(flat), outingFigures(a)]).maxEleM).toBe(1100)
  })

  it('gives the figures before each stage', () => {
    const before = figuresBefore([a, withOverride])
    expect(before[0].distanceM).toBe(0)
    expect(before[1].distanceM).toBeCloseTo(outingFigures(a).distanceM, 6)
  })
})

describe('bilanStageS', () => {
  it('shares the duration between the stages, none shorter than the minimum', () => {
    expect(bilanStageS(4, 60)).toBe(15)
    expect(bilanStageS(100, 60)).toBe(BILAN_STAGE_MIN_S)
    expect(bilanStageS(0, 60)).toBe(BILAN_STAGE_MIN_S)
  })
})

describe('a « Bilan » in the sequence', () => {
  const june = outing('Juin', 6, 45, MARCH + 90 * DAY)
  const march = outing('Mars', 6.05, 45.02, MARCH)
  const pyrenees = outing('Pyrénées', 0, 42.8, MARCH + 30 * DAY)
  const tracks = [june, pyrenees, march]

  it('plays in sequence, in the order of the dates and not of the list or `order`', () => {
    expect(playsInSequence(BILAN, 3)).toBe(true)
    expect(playsBilan(BILAN, 3)).toBe(true)
    expect(playsBilan(BILAN, 1)).toBe(false)
    expect(playsBilan({ ...BILAN, enabled: true }, 3)).toBe(false)
    expect(playsBilan({ ...DEFAULT_RACE, sequence: true }, 3)).toBe(false)
    expect(orderedTracks(tracks, { ...BILAN, order: [pyrenees.id, june.id, march.id] }).map((t) => t.name)).toEqual(['Mars', 'Juin', 'Pyrénées'])
  })

  it('gives the tracks as the store holds them, a colour change included', () => {
    const recoloured = [{ ...june, color: '#123456' }, pyrenees, march]
    expect(filmSequenceOf(tracks, BILAN)).toBe(filmSequenceOf(recoloured, BILAN))
    expect(orderedTracks(recoloured, BILAN).find((t) => t.id === june.id)?.color).toBe('#123456')
  })

  it('has the regions and a track to frame for each', () => {
    const sequence = filmSequenceOf(tracks, BILAN)!
    expect(sequence.stages.map((s) => s.track.name)).toEqual(['Mars', 'Juin', 'Pyrénées'])
    expect(sequence.bilan!.plan.regionOf).toEqual([0, 0, 1])
    expect(sequence.bilan!.views).toHaveLength(2)
    expect(sequence.bilan!.views[0].segments).toHaveLength(2)
    expect(filmSequenceOf(tracks, BILAN)).toBe(sequence)
    expect(filmSequenceOf(tracks, { ...BILAN, bilan: false })!.bilan).toBeUndefined()
    expect(filmTrackOf(tracks, BILAN)).toBe(sequence.track)
  })

  it('fetches the water and the forests of no track', () => {
    expect(filmTracksOf(tracks, BILAN)).toEqual([])
    expect(filmTracksOf(tracks, { ...BILAN, bilan: false })).toHaveLength(3)
  })

  it('makes the camera hold the high view of the region of the stage under the marker', () => {
    const sequence = filmSequenceOf(tracks, BILAN)!
    const follow = filmFollowOf(tracks, BILAN, 0)!
    const first = follow(0.1)!
    expect(first.overview).toBe(trackPathOf(sequence.bilan!.views[0]))
    expect(follow(0.5)!.overview).toBe(first.overview)
    const last = follow(0.99)!
    expect(last.overview).toBe(trackPathOf(sequence.bilan!.views[1]))
    expect(stageAt(sequence, 0.99).stage.track.name).toBe('Pyrénées')
    // the other modes follow the stage and hold no view
    expect(filmFollowOf(tracks, { ...BILAN, bilan: false }, 0)!(0.1)!.overview).toBeUndefined()
  })

  it('is a valid race, with or without the flag', () => {
    expect(isValidRace(BILAN)).toBe(true)
    expect(isValidRace({ ...BILAN, bilan: 'oui' as unknown as boolean })).toBe(false)
  })
})
