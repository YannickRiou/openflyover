import { afterEach, describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import type { Climb } from '../flyover/climbs'
import { buildTrack } from '../import/stats'
import { MEDIA_DEFAULTS } from '../film/model'
import {
  LABEL_FADE_END_M,
  LABEL_FADE_START_M,
  WAYPOINT_PRIORITY,
  climbLabelText,
  distanceFade,
  KM_PRIORITY,
  kmLabels,
  endpointLabels,
  photoLabels,
  PHOTO_PRIORITY,
  ENDPOINT_PRIORITY,
  withLabelDefaults,
  isValidLabelSettings,
  lineOfSightClearance,
  occlusionFade,
  POI_PRIORITY,
  poiLabels,
  resolveOverlaps,
  spriteScaleForPixels,
  waypointLabels,
  type LandmarkLabel,
} from './labelModel'
import { externalLabels, setLabelSource, useLabelSources } from './labelSources'

function climb(category: Climb['category'], topEleM: number): Climb {
  return {
    startDistM: 0,
    endDistM: 7000,
    lengthM: 7000,
    startEleM: 1010,
    endEleM: 1650,
    gainM: 640,
    avgGradient: 0.091,
    maxGradient: 0.2,
    score: 64_000,
    category,
    topEleM,
    top: { lon: 6.782, lat: 45.863 },
  }
}

function track(id: string, waypoints?: Track['waypoints']): Track {
  const t = buildTrack({ name: id, source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }] }] })
  t.id = id
  if (waypoints) t.waypoints = waypoints
  return t
}

describe('label texts and sources', () => {
  it('puts a kilometre marker every step along the track, none at the start, below the named labels', () => {
    // about 7.7 km due east
    const east = buildTrack({ name: 'est', source: 'gpx', segments: [{ points: [6.8, 6.85, 6.9].map((lon) => ({ lon, lat: 45.9, ele: 1000 })) }] })
    const labels = kmLabels(east, 2)
    expect(labels.map((l) => l.text)).toEqual(['2 km', '4 km', '6 km'])
    expect(labels[0]).toMatchObject({ kind: 'km', priority: KM_PRIORITY, ele: 1000 })
    expect(labels[1].lon).toBeGreaterThan(labels[0].lon)
    expect(KM_PRIORITY).toBeLessThan(WAYPOINT_PRIORITY)
    expect(kmLabels(east, 0)).toEqual([])
  })

  it('pins the start and the finish of the track with a flag, or one pin for a loop, named or not', () => {
    const east = buildTrack({ name: 'est', source: 'gpx', segments: [{ points: [6.8, 6.85, 6.9].map((lon) => ({ lon, lat: 45.9 })) }] })
    const ends = endpointLabels(east)
    expect(ends.map((l) => [l.text, l.icon, l.lon])).toEqual([
      ['Départ', 'drapeau', 6.8],
      ['Arrivée', 'drapeau', 6.9],
    ])
    expect(ends[0]).toMatchObject({ kind: 'endpoint', priority: ENDPOINT_PRIORITY })
    expect(endpointLabels(east, false).map((l) => [l.text, l.icon, l.lon])).toEqual([
      ['', 'drapeau', 6.8],
      ['', 'drapeau', 6.9],
    ])
    const loop = buildTrack({ name: 'boucle', source: 'gpx', segments: [{ points: [6.8, 6.85, 6.8].map((lon) => ({ lon, lat: 45.9 })) }] })
    expect(endpointLabels(loop).map((l) => l.text)).toEqual(['Départ et arrivée'])
    expect(endpointLabels(loop, false).map((l) => l.text)).toEqual([''])
    expect(ENDPOINT_PRIORITY).toBeLessThan(POI_PRIORITY)
  })

  it('pins the photos of the film whose file gives a position, with their caption', () => {
    const photo = (id: string, src: string, caption?: string) => ({ ...MEDIA_DEFAULTS, id, kind: 'image' as const, src, startS: 0, durationS: 4, caption })
    const table = {
      'photo-1': { data: 'data:image/jpeg;base64,', thumb: 'data:image/jpeg;base64,', width: 10, height: 10, lon: 6.86, lat: 45.83 },
      'photo-2': { data: 'data:image/jpeg;base64,', thumb: 'data:image/jpeg;base64,', width: 10, height: 10 },
    }
    const labels = photoLabels([photo('media-1', 'photo-1', ' Lac Blanc '), photo('media-2', 'photo-2'), photo('media-3', 'photo-1')], table)
    expect(labels.map((l) => [l.text, l.icon, l.lon])).toEqual([
      ['Lac Blanc', 'photo', 6.86],
      ['Photo', 'photo', 6.86],
    ])
    expect(labels[0].priority).toBe(PHOTO_PRIORITY)
    expect(PHOTO_PRIORITY).toBeLessThan(POI_PRIORITY)
  })

  it('older projects get no kilometre markers; size and range stay within their bounds', () => {
    expect(isValidLabelSettings({ kmStep: 5, size: 1.2, rangeKm: 30 })).toBe(true)
    expect(isValidLabelSettings({ kmStep: 3, size: 1, rangeKm: 70 })).toBe(false)
    expect(isValidLabelSettings({ kmStep: 0, size: 3, rangeKm: 70 })).toBe(false)
    expect(isValidLabelSettings({ kmStep: 0, size: 1, rangeKm: 500 })).toBe(false)
    expect(withLabelDefaults({ climbs: false, waypoints: true })).toEqual({ climbs: false, waypoints: true, kmStep: 0, endpoints: false, photos: false, size: 1, rangeKm: 70 })
    expect(withLabelDefaults({ climbs: true, waypoints: true, kmStep: 5 })).toMatchObject({ kmStep: 5 })
  })

  it('formats climb labels in French', () => {
    expect(climbLabelText(climb('3', 1653.4), 1)).toBe('Montée 2 · cat. 3 · 1\u202f653 m')
    expect(climbLabelText(climb('HC', 2642), 0)).toBe('Montée 1 · HC · 2\u202f642 m')
    expect(climbLabelText(climb(null, 980), 2)).toBe('Montée 3 · 980 m')
  })

  it('lists the waypoints of every track', () => {
    const labels = waypointLabels([
      track('a', [{ lon: 6.78, lat: 45.86, ele: 1653, name: 'Col de Voza' }]),
      track('b'),
      track('c', [{ lon: 6.7, lat: 45.8, name: 'Tresse' }]),
    ])
    expect(labels.map((l) => [l.id, l.text, l.ele])).toEqual([
      ['wpt:a:0', 'Col de Voza', 1653],
      ['wpt:c:0', 'Tresse', undefined],
    ])
    expect(labels[1]).not.toHaveProperty('ele')
  })

  it('shows the points of interest placed by hand above every other label, not the blank ones', () => {
    const labels = poiLabels([
      { id: 'poi-1', lon: 6.8, lat: 45.9, name: ' Pique-nique ', icon: 'repas' },
      { id: 'poi-2', lon: 6.9, lat: 45.9, name: '  ' },
    ])
    expect(labels).toEqual([{ id: 'poi:poi-1', lon: 6.8, lat: 45.9, text: 'Pique-nique', kind: 'poi', priority: POI_PRIORITY, icon: 'repas' }])
  })
})

describe('labelSources', () => {
  afterEach(() => useLabelSources.setState({ sources: {} }))

  it('replaces or removes the labels of a source', () => {
    const peak: LandmarkLabel = { id: 'osm:1', lon: 6.86, lat: 45.83, ele: 4806, text: 'Mont Blanc', kind: 'peak', priority: 200 }
    setLabelSource('osm', [peak])
    setLabelSource('other', [{ ...peak, id: 'other:1' }])
    expect(externalLabels(useLabelSources.getState().sources).map((l) => l.id)).toEqual(['osm:1', 'other:1'])
    setLabelSource('osm', [])
    expect(useLabelSources.getState().sources).not.toHaveProperty('osm')
  })
})

describe('screen-space rules', () => {
  it('fades with distance and behind the relief', () => {
    expect(distanceFade(LABEL_FADE_START_M)).toBe(1)
    expect(distanceFade(LABEL_FADE_END_M)).toBe(0)
    expect(distanceFade((LABEL_FADE_START_M + LABEL_FADE_END_M) / 2)).toBeCloseTo(0.5, 6)
    // a shorter range: opaque up to its half
    expect(distanceFade(10_000, 20_000)).toBe(1)
    expect(distanceFade(20_000, 20_000)).toBe(0)
    // behind the relief: not drawn at all, never half-transparent
    expect(occlusionFade(Infinity)).toBe(1)
    expect(occlusionFade(0)).toBe(1)
    expect(occlusionFade(-0.1)).toBe(0)
    expect(occlusionFade(-100)).toBe(0)
  })

  it('sizes sprites in CSS pixels', () => {
    // fov 50°: projection[5] = 1 / tan(25°); a 24 px label in a 1000 px viewport
    const p11 = 1 / Math.tan((25 * Math.PI) / 180)
    expect(spriteScaleForPixels(24, 1000, p11) * p11 * 500).toBeCloseTo(24, 9)
  })

  it('measures the line-of-sight clearance above a ridge, ignoring the end near the label', () => {
    // flat ground at y = 0 with a 100 m ridge at x in [400, 600]
    const ground = (x: number) => (x >= 400 && x <= 600 ? 100 : 0)
    const clearance = (x: number, y: number) => y - ground(x)
    expect(lineOfSightClearance({ x: 0, y: 50, z: 0 }, { x: 1000, y: 50, z: 0 }, clearance)).toBeLessThan(-40)
    expect(lineOfSightClearance({ x: 0, y: 300, z: 0 }, { x: 1000, y: 300, z: 0 }, clearance)).toBeGreaterThan(190)
    // the slope right under the label (last 150 m) never hides it
    expect(lineOfSightClearance({ x: 0, y: 50, z: 0 }, { x: 500, y: 50, z: 0 }, clearance, 48)).toBeGreaterThan(0)
    expect(lineOfSightClearance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, () => undefined)).toBe(Infinity)
  })

  it('finds the crest between the samples, so a moving camera does not flicker at the cut', () => {
    // a rounded ridge 100 m high at x = 1000 (σ 120 m), the label 3 km away; the camera slides toward the ridge
    const ground = (x: number) => 100 * Math.exp(-(((x - 1000) / 120) ** 2) / 2)
    const clearance = (x: number, y: number) => y - ground(x)
    const to = { x: 3000, y: 10, z: 0 }
    let toggles = 0
    let wasHidden: boolean | null = null
    for (let x = -500; x <= 500; x += 2) {
      const from = { x, y: 160, z: 0 }
      let exact = Infinity
      const tMax = 1 - 150 / Math.hypot(to.x - x, to.y - from.y)
      for (let i = 1; i <= 20_000; i++) {
        const t = (i / 20_000) * tMax
        exact = Math.min(exact, clearance(x + (to.x - x) * t, from.y + (to.y - from.y) * t))
      }
      const measured = lineOfSightClearance(from, to, clearance)
      expect(Math.abs(measured - exact), `x = ${x}`).toBeLessThan(1)
      const hidden = occlusionFade(measured) === 0
      if (wasHidden !== null && hidden !== wasHidden) toggles++
      wasHidden = hidden
    }
    // hidden at first, then shown for good
    expect(toggles).toBe(1)
  })

  it('keeps the highest priority among overlapping labels', () => {
    const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 30 })
    expect(
      resolveOverlaps([
        { rect: rect(0, 0), priority: 50 },
        { rect: rect(50, 10), priority: 120 },
        { rect: rect(300, 0), priority: 10 },
        { rect: rect(160, 0), priority: 50 },
      ]),
    ).toEqual([false, true, true, true])
  })
})
