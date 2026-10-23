import { describe, expect, it } from 'vitest'
import { withLanguage } from '../i18n'
import { buildSequence, sequenceLandmarks } from '../flyover/sequence'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from '../flyover/path'
import {
  DEFAULT_LANDMARK_SETTINGS,
  buildLandmarks,
  landmarkLabels,
  landmarkPriority,
  landmarkText,
  PINNED_LABEL_BOOST,
  landmarkMode,
  movedInRank,
  newLandmarkIds,
  nextMode,
  parseEle,
  parsePopulation,
  pathBoxDistanceM,
  RECORD_SUMMIT_M,
  placeSizeOf,
  projectOnPath,
  recordLandmarks,
  splitHidden,
  withLandmarkDefaults,
  withMode,
  withPinnedOnly,
  withPlaceSize,
  withRank,
} from './landmarks'
import type { Landmark } from './landmarks'
import type { OsmFeature } from './overpass'

/** Straight track going south along 6.78° E from 45.90° N, 1 km per point (≈ 11 km). */
const TRACK = buildTrack({
  name: 't',
  source: 'gpx',
  segments: [{ points: Array.from({ length: 12 }, (_, i) => ({ lon: 6.78, lat: 45.9 - i * 0.009, ele: 1000 })) }],
})
const PATH = buildTrackPath(TRACK)

function feature(partial: Partial<OsmFeature> & Pick<OsmFeature, 'kind' | 'name'>): OsmFeature {
  return { id: `node/${partial.name}`, lon: 6.78, lat: 45.9, ...partial }
}

describe('parseEle', () => {
  it('reads the usual OSM spellings in metres', () => {
    expect(parseEle('1653')).toBe(1653)
    expect(parseEle('4808.73')).toBeCloseTo(4808.73)
    expect(parseEle('1 653 m')).toBe(1653)
    expect(parseEle('1653m')).toBe(1653)
    expect(parseEle('1653,5')).toBe(1653.5)
    expect(parseEle('1,653')).toBe(1653)
    expect(parseEle(' 2 120 ')).toBe(2120)
  })

  it('converts feet and rejects garbage or absurd values', () => {
    expect(parseEle('5400 ft')).toBeCloseTo(1645.9, 1)
    expect(parseEle(undefined)).toBeUndefined()
    expect(parseEle('')).toBeUndefined()
    expect(parseEle('environ 1600')).toBeUndefined()
    expect(parseEle('12000')).toBeUndefined()
    expect(parseEle('-800')).toBeUndefined()
  })
})

describe('projectOnPath', () => {
  it('gives the distance to the track and the position along it', () => {
    // 0.01° east of the 5th km, between two points: ≈ 775 m away at 45.86° N, 4.5 km along
    const p = projectOnPath(PATH, 6.79, 45.9 - 4.5 * 0.009)
    expect(p.distanceM).toBeCloseTo(775, -1)
    expect(p.alongM).toBeCloseTo(PATH.lengthM * (4.5 / 11), -2)
  })

  it('clamps to the ends', () => {
    expect(projectOnPath(PATH, 6.78, 45.95).alongM).toBe(0)
    expect(projectOnPath(PATH, 6.78, 45.7).alongM).toBe(PATH.lengthM)
    expect(projectOnPath({ ...PATH, count: 0 }, 6.78, 45.9).distanceM).toBe(Infinity)
  })
})

describe('landmarkPriority / landmarkText', () => {
  it('ranks crossed passes first, then peaks by elevation and closeness, huts, lakes, places last', () => {
    const crossed = landmarkPriority('pass', 1650, 20)
    const highPeak = landmarkPriority('peak', 4808, 500)
    const lowPeak = landmarkPriority('peak', 1200, 500)
    const farPeak = landmarkPriority('peak', 1200, 2500)
    const farPass = landmarkPriority('pass', 2000, 1200)
    const hut = landmarkPriority('hut', 1500, 100)
    const lake = landmarkPriority('lake', undefined, 100)
    const village = landmarkPriority('place', undefined, 100, 'village')
    const hamlet = landmarkPriority('place', undefined, 100, 'hamlet')
    expect(crossed).toBeGreaterThan(highPeak)
    expect(highPeak).toBeGreaterThan(lowPeak)
    expect(lowPeak).toBeGreaterThan(farPeak)
    expect(farPass).toBeGreaterThan(hut)
    expect(hut).toBeGreaterThan(lake)
    expect(lake).toBeGreaterThan(village)
    expect(village).toBeGreaterThan(hamlet)
    expect(crossed).toBeLessThan(50)
    expect(landmarkPriority('place', undefined, 3000, 'hamlet')).toBe(0)
  })

  it('ranks places by type, or by population when tagged', () => {
    const city = landmarkPriority('place', undefined, 100, 'city')
    const town = landmarkPriority('place', undefined, 100, 'town')
    const village = landmarkPriority('place', undefined, 100, 'village')
    expect(city).toBeGreaterThan(town)
    expect(town).toBeGreaterThan(village)
    expect(landmarkPriority('place', undefined, 100, 'village', 10_000)).toBeCloseTo(town)
    expect(landmarkPriority('place', undefined, 100, 'town', 300)).toBeLessThan(village)
    expect(landmarkPriority('place', undefined, 100, 'city', 5_000_000)).toBeLessThan(landmarkPriority('lake', undefined, 100))
  })

  it('reads the population', () => {
    expect(parsePopulation('1250')).toBe(1250)
    expect(parsePopulation('12 345')).toBe(12345)
    expect(parsePopulation('12,345')).toBe(12345)
    expect(parsePopulation('~500')).toBeUndefined()
    expect(parsePopulation('0')).toBeUndefined()
    expect(parsePopulation(undefined)).toBeUndefined()
  })

  it('adds the elevation to summits and passes only', () => {
    // narrow no-break space as thousands separator (formatNumber)
    expect(landmarkText('pass', 'Col de Voza', 1653)).toBe('Col de Voza · 1 653 m')
    expect(landmarkText('peak', 'Le Prarion', 1969.1)).toBe('Le Prarion · 1 969 m')
    expect(landmarkText('peak', 'Sans cote', undefined)).toBe('Sans cote')
    expect(landmarkText('hut', "Refuge du Nid d'Aigle", 2372)).toBe("Refuge du Nid d'Aigle")
    expect(landmarkText('lake', 'Lac Blanc', 2352)).toBe('Lac Blanc')
  })
})

describe('pathBoxDistanceM', () => {
  it('is 0 when the track goes through the box, else the gap to its nearest side or corner', () => {
    // the track runs along 6.78° E: a box across it, one 0.01° east of it (≈ 775 m), one beyond its southern end
    expect(pathBoxDistanceM(PATH, { west: 6.77, south: 45.85, east: 6.79, north: 45.86 })).toBe(0)
    expect(pathBoxDistanceM(PATH, { west: 6.79, south: 45.85, east: 6.8, north: 45.86 })).toBeCloseTo(775, -1)
    const south = 45.9 - 11 * 0.009
    expect(pathBoxDistanceM(PATH, { west: 6.79, south: south - 0.02, east: 6.8, north: south - 0.01 })).toBeCloseTo(
      Math.hypot(775, 1113),
      -1,
    )
  })

  it('is 0 when a segment crosses the box between two points', () => {
    // a 200 m wide box between the 3rd and 4th points (1 km apart)
    expect(pathBoxDistanceM(PATH, { west: 6.775, south: 45.9 - 2.6 * 0.009, east: 6.785, north: 45.9 - 2.4 * 0.009 })).toBe(0)
  })
})

describe('buildLandmarks', () => {
  const settings = { kinds: DEFAULT_LANDMARK_SETTINGS.kinds, places: DEFAULT_LANDMARK_SETTINGS.places, maxDistanceM: 1500 }
  const noPlaces = { ...settings, kinds: { ...settings.kinds, place: false } }

  it('projects a feature on a path once: another setting only filters again, to the same places', () => {
    const features = [
      feature({ kind: 'peak', name: 'Mont Truc', ele: '1 811 m', lat: 45.9 - 8 * 0.009, lon: 6.785 }),
      feature({ kind: 'hut', name: 'Refuge', lat: 45.9 - 5 * 0.009, lon: 6.79 }),
    ]
    let reads = 0
    const path = new Proxy(buildTrackPath(TRACK), {
      get(target, key) {
        if (key === 'lon') reads++
        return Reflect.get(target, key)
      },
    })
    expect(buildLandmarks(features, path, noPlaces).map((l) => l.name)).toEqual(['Refuge', 'Mont Truc'])
    expect(reads).toBeGreaterThan(0)
    reads = 0
    const closer = buildLandmarks(features, path, { ...noPlaces, maxDistanceM: 500 })
    expect(reads).toBe(0)
    expect(closer).toEqual(buildLandmarks(features, buildTrackPath(TRACK), { ...noPlaces, maxDistanceM: 500 }))
    expect(closer.map((l) => l.name)).toEqual(['Mont Truc'])
  })

  it('filters by kind and distance, parses the elevation and orders along the track', () => {
    const features = [
      feature({ kind: 'peak', name: 'Mont Truc', ele: '1 811 m', lat: 45.9 - 8 * 0.009, lon: 6.785 }),
      feature({ kind: 'pass', name: 'Col de Voza', ele: '1650', lat: 45.9 - 3 * 0.009 }),
      feature({ kind: 'hut', name: 'Refuge', lat: 45.9 - 5 * 0.009, lon: 6.79 }),
      feature({ kind: 'place', name: 'Hameau', lat: 45.9 - 1 * 0.009, detail: 'hamlet' }),
      feature({ kind: 'peak', name: 'Trop loin', ele: '3000', lat: 45.9 - 6 * 0.009, lon: 6.81 }),
    ]
    const out = buildLandmarks(features, PATH, noPlaces)
    expect(out.map((l) => l.name)).toEqual(['Col de Voza', 'Refuge', 'Mont Truc'])
    expect(buildLandmarks(features, PATH, settings).map((l) => l.name)).toEqual(['Hameau', 'Col de Voza', 'Refuge', 'Mont Truc'])
    expect(out[0]).toMatchObject({ kind: 'pass', ele: 1650, text: 'Col de Voza · 1 650 m' })
    expect(out[0].distanceM).toBeLessThan(1)
    expect(out[2].ele).toBe(1811)
    expect(out[1].ele).toBeUndefined()
    expect(out[0].alongM).toBeLessThan(out[1].alongM)
    expect(out[1].alongM).toBeLessThan(out[2].alongM)
  })

  it('leaves out the dismissed ones, which free no slot for another under the cap', () => {
    const features = [
      feature({ id: 'node/1', kind: 'peak', name: 'Mont A', lat: 45.9 - 1 * 0.009, lon: 6.785 }),
      feature({ id: 'node/2', kind: 'peak', name: 'Mont B', lat: 45.9 - 3 * 0.009, lon: 6.785 }),
      feature({ id: 'node/3', kind: 'peak', name: 'Mont C', lat: 45.9 - 5 * 0.009, lon: 6.785 }),
    ]
    expect(buildLandmarks(features, PATH, { ...noPlaces, maxCount: 2 }).map((l) => l.id)).toEqual(['node/1', 'node/2'])
    expect(buildLandmarks(features, PATH, { ...noPlaces, maxCount: 2, dismissedIds: ['node/2'] }).map((l) => l.id)).toEqual(['node/1'])
    expect(buildLandmarks(features, PATH, { ...noPlaces, dismissedIds: ['node/2'] }).map((l) => l.id)).toEqual(['node/1', 'node/3'])
  })

  it('keeps the pinned ones whatever the cap and the name deduplication', () => {
    const features = [
      ...Array.from({ length: 5 }, (_, i) =>
        feature({ id: `node/${i}`, kind: 'peak', name: `Pic ${i}`, ele: String(2000 + i * 100), lat: 45.9 - i * 0.009 }),
      ),
      feature({ id: 'node/9', kind: 'hut', name: 'Pic 4', lat: 45.9 - 4 * 0.009, lon: 6.7805 }),
    ]
    // the cap leaves the less important peak out; the pinned one stays, the others share the rest
    expect(buildLandmarks(features, PATH, { ...noPlaces, maxCount: 2 }).map((l) => l.id)).toEqual(['node/3', 'node/4'])
    expect(buildLandmarks(features, PATH, { ...noPlaces, maxCount: 2, pinnedIds: ['node/0'] }).map((l) => l.id)).toEqual(['node/0', 'node/4'])
    // a pinned duplicate is not dropped, and wins over an unpinned one with the same name
    expect(buildLandmarks(features, PATH, { ...noPlaces, pinnedIds: ['node/9'] }).map((l) => l.id)).toContain('node/9')
    expect(buildLandmarks(features, PATH, { ...noPlaces, pinnedIds: ['node/9'] }).map((l) => l.id)).not.toContain('node/4')
    // pinned ones beyond the cap are all kept, an id absent from the answer is ignored
    expect(buildLandmarks(features, PATH, { ...noPlaces, maxCount: 1, pinnedIds: ['node/0', 'node/1', 'way/404'] }).map((l) => l.id)).toEqual(['node/0', 'node/1'])
    // a pinned one still follows the filters, and the dismissal
    expect(buildLandmarks(features, PATH, { ...noPlaces, kinds: { ...noPlaces.kinds, hut: false }, pinnedIds: ['node/9'] }).map((l) => l.id)).not.toContain('node/9')
    expect(buildLandmarks(features, PATH, { ...noPlaces, pinnedIds: ['node/0'], dismissedIds: ['node/0'] }).map((l) => l.id)).not.toContain('node/0')
  })

  it('keeps one landmark per name nearby, the most important one', () => {
    const features = [
      feature({ id: 'node/1', kind: 'pass', name: 'Col de Voza', lat: 45.9 - 3 * 0.009 }),
      feature({ id: 'node/2', kind: 'pass', name: 'Col de Voza', ele: '1650', lat: 45.9 - 3 * 0.009, lon: 6.781 }),
      feature({ id: 'node/3', kind: 'pass', name: 'COL DE VOZA', lat: 45.9 - 3 * 0.009, lon: 6.779 }),
      feature({ id: 'node/4', kind: 'pass', name: 'Col de Voza', lat: 45.9 - 10 * 0.009 }),
    ]
    const out = buildLandmarks(features, PATH, settings)
    expect(out.map((l) => l.id)).toEqual(['node/2', 'node/4'])
  })

  it('caps the count by priority, then orders along the track', () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      feature({ id: `node/${i}`, kind: 'peak', name: `Pic ${i}`, ele: String(1000 + i * 100), lat: 45.9 - i * 0.009 }),
    )
    const out = buildLandmarks(features, PATH, { ...settings, maxCount: 3 })
    expect(out.map((l) => l.name)).toEqual(['Pic 7', 'Pic 8', 'Pic 9'])
  })

  it('filters places by size', () => {
    const features = [
      feature({ kind: 'place', name: 'Ville', detail: 'city' }),
      feature({ kind: 'place', name: 'Bourg', detail: 'town', lat: 45.9 - 2 * 0.009 }),
      feature({ kind: 'place', name: 'Village', detail: 'village', lat: 45.9 - 4 * 0.009 }),
      feature({ kind: 'place', name: 'Hameau', detail: 'hamlet', lat: 45.9 - 6 * 0.009 }),
    ]
    const sizes = (places: typeof settings.places) => buildLandmarks(features, PATH, { ...settings, places }).map((l) => l.name)
    expect(sizes({ city: true, village: false, hamlet: false })).toEqual(['Ville', 'Bourg'])
    expect(sizes({ city: false, village: true, hamlet: true })).toEqual(['Village', 'Hameau'])
    expect(buildLandmarks(features, PATH, noPlaces)).toEqual([])
  })

  it('measures a place mapped as an area to its box, and merges it with its node', () => {
    // a town whose centre is 2 km east of the track, its area reaching over it
    const area = { west: 6.775, south: 45.86, east: 6.83, north: 45.88 }
    const features = [
      feature({ id: 'relation/1', kind: 'place', name: 'Bourg', detail: 'town', lon: 6.806, lat: 45.87, area }),
      feature({ id: 'node/2', kind: 'place', name: 'Bourg', detail: 'town', lon: 6.81, lat: 45.875 }),
      feature({ id: 'node/3', kind: 'place', name: 'Loin', detail: 'town', lon: 6.806, lat: 45.85 }),
    ]
    const out = buildLandmarks(features, PATH, { ...settings, maxDistanceM: 3000 })
    expect(out.map((l) => l.id)).toEqual(['relation/1', 'node/3'])
    expect(out[0].distanceM).toBe(0)
    expect(out[0].alongM).toBeCloseTo(PATH.lengthM * (3.33 / 11), -2)
    expect(buildLandmarks(features, PATH, settings).map((l) => l.id)).toEqual(['relation/1'])
  })

  it('keeps a share of the cap for places, which rank last', () => {
    const peaks = Array.from({ length: 10 }, (_, i) =>
      feature({ id: `node/p${i}`, kind: 'peak', name: `Pic ${i}`, ele: '2000', lat: 45.9 - i * 0.009 }),
    )
    const places = Array.from({ length: 4 }, (_, i) =>
      feature({ id: `node/v${i}`, kind: 'place', name: `Village ${i}`, detail: 'village', lat: 45.9 - i * 0.009 }),
    )
    const out = buildLandmarks([...peaks, ...places], PATH, { ...settings, maxCount: 8 })
    expect(out.filter((l) => l.kind === 'place')).toHaveLength(2)
    expect(out).toHaveLength(8)
    // fewer places than the share: the other kinds take the rest
    expect(buildLandmarks([...peaks, places[0]], PATH, { ...settings, maxCount: 8 }).filter((l) => l.kind === 'peak')).toHaveLength(7)
  })
})

describe('landmarkLabels', () => {
  it('maps kinds to the label model, merges tracks on the OSM id and caps the count', () => {
    const base = { lon: 6.78, lat: 45.9, distanceM: 10, alongM: 0 }
    const a = [
      { ...base, id: 'node/1', kind: 'pass' as const, name: 'Col', ele: 1650, priority: 40, text: 'Col · 1 650 m' },
      { ...base, id: 'way/2', kind: 'lake' as const, name: 'Lac', priority: 18, text: 'Lac' },
    ]
    const b = [
      { ...base, id: 'node/1', kind: 'pass' as const, name: 'Col', ele: 1650, priority: 30, text: 'Col · 1 650 m' },
      { ...base, id: 'node/3', kind: 'glacier' as const, name: 'Glacier', priority: 14, text: 'Glacier' },
    ]
    const labels = landmarkLabels([a, b])
    expect(labels).toEqual([
      { id: 'osm:node/1', lon: 6.78, lat: 45.9, ele: 1650, text: 'Col · 1 650 m', kind: 'pass', priority: 40 },
      { id: 'osm:way/2', lon: 6.78, lat: 45.9, text: 'Lac', kind: 'water', priority: 18 },
      { id: 'osm:node/3', lon: 6.78, lat: 45.9, text: 'Glacier', kind: 'other', priority: 14 },
    ])
    expect(landmarkLabels([a, b], 1)).toHaveLength(1)
    const place = { ...base, id: 'node/4', kind: 'place' as const, name: 'Village', priority: 8, text: 'Village' }
    expect(landmarkLabels([a, b, [place]], 4).map((l) => l.id)).toEqual(['osm:node/1', 'osm:way/2', 'osm:node/3', 'osm:node/4'])
    expect(landmarkLabels([a, b, [place]], 3).map((l) => l.id)).toEqual(['osm:node/1', 'osm:way/2', 'osm:node/4'])
    // the cap is global over the tracks; the pinned ones count in it and are always kept
    expect(landmarkLabels([a, b], 2).map((l) => l.id)).toEqual(['osm:node/1', 'osm:way/2'])
    expect(landmarkLabels([a, b], 2, ['node/3']).map((l) => l.id)).toEqual(['osm:node/1', 'osm:node/3'])
    expect(landmarkLabels([a, b], 1, ['node/3', 'way/2']).map((l) => l.id)).toEqual(['osm:way/2', 'osm:node/3'])
    expect(landmarkLabels([a, b], 1, ['way/404']).map((l) => l.id)).toEqual(['osm:node/1'])
  })

  it('a « Toujours » landmark wins the overlaps: its label priority is raised above the other landmarks', () => {
    const base = { lon: 6.78, lat: 45.9, distanceM: 10, alongM: 0 }
    const col = { ...base, id: 'node/1', kind: 'pass' as const, name: 'Col', priority: 40, text: 'Col' }
    const lake = { ...base, id: 'way/2', kind: 'lake' as const, name: 'Lac', priority: 18, text: 'Lac' }
    const [first, second] = landmarkLabels([[col, lake]], 5, ['way/2'])
    expect(first).toMatchObject({ id: 'osm:node/1', priority: 40 })
    expect(second).toMatchObject({ id: 'osm:way/2', priority: 18 + PINNED_LABEL_BOOST })
    expect(second.priority).toBeGreaterThan(first.priority)
  })
})

describe('withLandmarkDefaults', () => {
  it('gives an older project the kinds added since, off, and every place size', () => {
    const { waterPoint: _added, ...olderKinds } = DEFAULT_LANDMARK_SETTINGS.kinds
    const older = { enabled: true, kinds: { ...olderKinds, place: false }, maxDistanceM: 800 }
    expect(withLandmarkDefaults(older)).toEqual({
      ...older,
      kinds: { ...older.kinds, waterPoint: false },
      places: { city: true, village: true, hamlet: true },
      hiddenIds: [],
      seenIds: [],
      rank: [],
      dismissedIds: [],
      pinnedIds: [],
      density: 'normal',
    })
    expect(withLandmarkDefaults({ ...older, hiddenIds: ['node/1'] })).toMatchObject({ hiddenIds: ['node/1'] })
    // the cap of an older project becomes the nearest density; hidden wins over pinned
    for (const [maxCount, density] of [[10, 'few'], [25, 'few'], [40, 'normal'], [50, 'normal'], [70, 'many'], [80, 'many']] as const) {
      expect(withLandmarkDefaults({ ...older, maxCount })).toMatchObject({ density })
      expect(withLandmarkDefaults({ ...older, maxCount })).not.toHaveProperty('maxCount')
    }
    expect(withLandmarkDefaults({ ...older, maxCount: 80, density: 'few' })).toMatchObject({ density: 'few' })
    expect(withLandmarkDefaults({ ...older, hiddenIds: ['node/1'], pinnedIds: ['node/1', 'node/2'] })).toMatchObject({ hiddenIds: ['node/1'], pinnedIds: ['node/2'] })
    expect(withLandmarkDefaults({ ...older, seenIds: ['node/1', 2] })).toMatchObject({ seenIds: ['node/1'] })
    expect(withLandmarkDefaults({ ...older, seenIds: 'x' })).toMatchObject({ seenIds: [] })
    expect(withLandmarkDefaults({ ...older, places: { hamlet: false } })).toMatchObject({ places: { city: true, village: true, hamlet: false } })
    expect(withLandmarkDefaults({ ...older, places: 'x' })).toMatchObject({ places: 'x' })
    expect(withLandmarkDefaults('x')).toBe('x')
  })
})

describe('withPlaceSize / placeSizeOf', () => {
  it('groups cities and towns', () => {
    expect(['city', 'town', 'village', 'hamlet', undefined].map(placeSizeOf)).toEqual(['city', 'city', 'village', 'hamlet', 'hamlet'])
  })

  it('turns places on with the first size shown and off with the last one hidden', () => {
    const off = { kinds: { ...DEFAULT_LANDMARK_SETTINGS.kinds, place: false }, places: DEFAULT_LANDMARK_SETTINGS.places }
    const villages = withPlaceSize(off, 'village', true)
    expect(villages).toMatchObject({ kinds: { place: true }, places: { city: false, village: true, hamlet: false } })
    const withCities = withPlaceSize(villages, 'city', true)
    expect(withCities.places).toEqual({ city: true, village: true, hamlet: false })
    expect(withPlaceSize(withPlaceSize(withCities, 'city', false), 'village', false)).toMatchObject({
      kinds: { place: false },
      places: { city: false, village: false, hamlet: false },
    })
  })
})

describe('splitHidden', () => {
  const base = { kind: 'peak' as const, name: 'x', lon: 6.78, lat: 45.9, distanceM: 10, priority: 28, text: 'x' }
  const list = [
    { ...base, id: 'node/1', alongM: 100 },
    { ...base, id: 'node/2', alongM: 200 },
    { ...base, id: 'way/3', alongM: 300 },
  ]

  it('splits the landmarks by hidden id, keeping the order', () => {
    expect(splitHidden(list, [])).toEqual({ shown: list, hidden: [] })
    const { shown, hidden } = splitHidden(list, ['way/3', 'node/1', 'node/99'])
    expect(shown.map((l) => l.id)).toEqual(['node/2'])
    expect(hidden.map((l) => l.id)).toEqual(['node/1', 'way/3'])
  })
})

describe('withRank / movedInRank', () => {
  const at = (id: string, priority: number) => ({ id, priority }) as Landmark
  const list = [at('a', 30), at('b', 20), at('c', 25), at('d', 10)]

  it('gives the importances of the ranked ones back in the order of the rank, the others keep theirs', () => {
    const out = withRank(list, ['b', 'a', 'x'])
    const byId = Object.fromEntries(out.map((l) => [l.id, l.priority]))
    expect(out.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(byId.b).toBe(30)
    expect(byId.a).toBeCloseTo(20, 2)
    expect(byId.b).toBeGreaterThan(byId.a)
    expect(byId.c).toBe(25)
    expect(byId.d).toBe(10)
    expect(withRank(list, [])).toEqual(list)
  })

  it('keeps the order strictly even between landmarks of the same importance', () => {
    const out = withRank([at('a', 10), at('b', 10)], ['b', 'a'])
    expect(out[1].priority).toBeGreaterThan(out[0].priority)
  })

  it('moves an id one place, not beyond the ends', () => {
    expect(movedInRank(['a', 'b', 'c'], 'b', true)).toEqual(['b', 'a', 'c'])
    expect(movedInRank(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c', 'b'])
    expect(movedInRank(['a', 'b', 'c'], 'a', true)).toEqual(['a', 'b', 'c'])
    expect(movedInRank(['a', 'b', 'c'], 'c', false)).toEqual(['a', 'b', 'c'])
    expect(movedInRank(['a', 'b'], 'z', true)).toEqual(['a', 'b'])
  })
})

describe('withPinnedOnly', () => {
  it('dismisses every listed landmark but the pinned ones, dropping them from the hidden and ranked ids', () => {
    const settings = {
      ...DEFAULT_LANDMARK_SETTINGS,
      pinnedIds: ['node/1', 'node/9'],
      hiddenIds: ['node/2', 'node/1', 'poi-1'],
      rank: ['node/3', 'node/1', 'node/2'],
      dismissedIds: ['node/7'],
    }
    const out = withPinnedOnly(settings, ['node/1', 'node/2', 'node/3', 'node/7'])
    expect(out).toMatchObject({ pinnedIds: ['node/1', 'node/9'], hiddenIds: ['node/1', 'poi-1'], rank: ['node/1'] })
    expect(out.dismissedIds).toEqual(['node/7', 'node/2', 'node/3'])
  })
})

describe('withMode / landmarkMode / newLandmarkIds', () => {
  const settings = { ...DEFAULT_LANDMARK_SETTINGS, hiddenIds: ['node/1', 'poi-2'] }

  it('sets labels to Jamais or back to Auto by id, every landmark listed now seen', () => {
    const hidden = withMode(settings, ['node/3', 'node/1'], 'never', ['node/1', 'node/3', 'node/4'])
    expect(hidden.hiddenIds).toEqual(['poi-2', 'node/3', 'node/1'])
    expect(hidden.seenIds).toEqual(['node/1', 'node/3', 'node/4'])
    const shown = withMode(hidden, hidden.hiddenIds, 'auto', ['node/5'])
    expect(shown.hiddenIds).toEqual([])
    expect(shown.seenIds).toEqual(['node/1', 'node/3', 'node/4', 'node/5'])
  })

  it('a landmark has one mode: Toujours leaves the hidden ids, Jamais the pinned ones; the button cycles through them', () => {
    const always = withMode(settings, ['node/1'], 'always', [])
    expect(always).toMatchObject({ hiddenIds: ['poi-2'], pinnedIds: ['node/1'] })
    const never = withMode(always, ['node/1'], 'never', [])
    expect(never).toMatchObject({ hiddenIds: ['poi-2', 'node/1'], pinnedIds: [] })
    expect(['node/1', 'node/2'].map((id) => landmarkMode(always, id))).toEqual(['always', 'auto'])
    expect(landmarkMode(never, 'node/1')).toBe('never')
    expect(nextMode('auto')).toBe('always')
    expect(nextMode('always')).toBe('never')
    expect(nextMode('never')).toBe('auto')
  })

  it('the landmarks listed and not seen are new, none before the first choice', () => {
    expect(newLandmarkIds(settings, ['node/1', 'node/2'])).toEqual(new Set())
    expect(newLandmarkIds({ seenIds: ['node/1'] }, ['node/1', 'node/2'])).toEqual(new Set(['node/2']))
  })
})

describe('recordLandmarks', () => {
  const M = (6371008.8 * Math.PI) / 180
  /** 3 km north, climbing 100 m between 1 km and 2 km (10 %): a steepest climb and a highest point. */
  const hilly = buildTrack({
    name: 'h',
    source: 'gpx',
    segments: [
      { points: Array.from({ length: 301 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 10) / M, ele: 1000 + Math.min(100, Math.max(0, i * 10 - 1000) / 10) })) },
    ],
  })

  it('lists the records of the track as landmarks at the track, ordered along it, with a language-following text', () => {
    const list = recordLandmarks(hilly, [])
    expect(list.map((l) => l.id)).toEqual([`record:${hilly.id}:steepestClimb`, `record:${hilly.id}:highest`])
    expect(list.every((l) => l.kind === 'record' && l.distanceM === 0)).toBe(true)
    expect(list[0].alongM).toBeLessThan(list[1].alongM)
    expect(list[0].text).toMatch(/^Montée la plus raide · /)
    expect(list[1]).toMatchObject({ name: expect.stringMatching(/^Point le plus haut · 1\D100 m$/), ele: expect.any(Number) })
    // nothing for a flat track
    expect(recordLandmarks(TRACK, [])).toEqual([])
  })

  it('leaves the highest point out when a summit of the landmarks is there', () => {
    const top = recordLandmarks(hilly, []).find((l) => l.id.endsWith(':highest'))!
    const summit = (dLat: number): Landmark => ({ id: 'node/9', kind: 'peak', name: 'Cime', lon: top.lon, lat: top.lat + dLat, distanceM: 0, alongM: top.alongM, priority: 30, text: 'Cime' })
    const near = recordLandmarks(hilly, [summit((RECORD_SUMMIT_M - 20) / M)])
    expect(near.map((l) => l.id)).toEqual([`record:${hilly.id}:steepestClimb`])
    expect(recordLandmarks(hilly, [summit((RECORD_SUMMIT_M + 50) / M)])).toHaveLength(2)
  })

  it('draws the label of a record with the trophy, and pinned ones win like any landmark', () => {
    const [steep] = recordLandmarks(hilly, [])
    const [label] = landmarkLabels([[steep]], 40, [steep.id])
    expect(label).toMatchObject({ id: `osm:${steep.id}`, kind: 'poi', icon: 'trophee', priority: steep.priority + PINNED_LABEL_BOOST })
  })

  it('keeps the text following the language when ranked or placed along a sequence (no frozen copy)', () => {
    const [steep] = recordLandmarks(hilly, [])
    const [ranked] = withRank([steep], [steep.id])
    expect(withLanguage('en', () => ranked.text)).toMatch(/^Steepest climb · /)
    const other = buildTrack({ name: 'o', source: 'gpx', segments: hilly.segments })
    const sequence = buildSequence([hilly, { ...other, id: 'other' }])
    const placed = sequenceLandmarks(sequence, { [hilly.id]: [steep] })![0]
    expect(placed.alongM).toBe(steep.alongM)
    expect(withLanguage('en', () => placed.name)).toMatch(/^Steepest climb · /)
  })
})
