import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { LonLatBounds, TileKey } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { boundsIntersect, tileBounds } from '../geo/mercator'
import { engineAreaFor } from '../scene/terrainLayerSetup'
import { createRootNodes } from '../terrain/quadtree'
import { DEFAULT_SEGMENTS, DEFAULT_TUNING, OUTER_MAX_ZOOM } from '../terrain/engine'
import { datedImagerySource } from '../terrain/imageryDates'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { HEIGHT_MARGIN_M, heightRange, planFilmTiles, sampleFilmPoses } from './filmTilePlan'
import type { FilmPose, FilmTilePlanInput } from './filmTilePlan'

/** A track of 10 km going south from Chamonix. */
const bounds: LonLatBounds = { west: 6.87, east: 6.87, south: 45.92 - 100 * 0.0009, north: 45.92 }
const frame = createLocalFrame(6.87, 45.92 - 50 * 0.0009)
const terrain = getTerrainSource('mapterhorn')
const imagery = getImagerySource('arcgis-world-imagery')
const lens = { fov: 50, near: 1, far: 5e6 }

/** Camera `behindM` north of the track point at `lat`, `heightM` above 1500 m, looking south at the track. */
function followPose(timeS: number, lat: number, heightM = 500, behindM = 700): FilmPose {
  return {
    timeS,
    position: frame.toLocal(6.87, lat + behindM / 111_320, 1500 + heightM),
    target: frame.toLocal(6.87, lat, 1500),
  }
}

const base: FilmTilePlanInput = {
  poses: [followPose(0, 45.92 - 50 * 0.0009)],
  frame,
  ...engineAreaFor(bounds, false),
  terrain,
  imagery,
  imageryZoomOffset: 0,
  exaggeration: 1,
  camera: lens,
  aspect: 16 / 9,
  viewportHeightPx: 1080,
  errorTargetPx: 3,
  trackMinM: 1000,
  trackMaxM: 2000,
  maxBytes: Infinity,
}

/** z/x/y of a Mapterhorn or Esri URL (Esri puts the row before the column) */
function keyOf(url: string): TileKey {
  const m = /\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/.exec(url)!
  return url.includes('arcgis') ? { z: +m[1], y: +m[2], x: +m[3] } : { z: +m[1], x: +m[2], y: +m[3] }
}
/** the root tiles of the area of `base` */
const planFilmTilesRoots = () => createRootNodes(base.area, terrain.minZoom, terrain.maxZoom, { frame, segments: DEFAULT_SEGMENTS, exaggeration: 1 }, DEFAULT_TUNING.rootTileBudget)
const terrainKeys = (urls: string[]) => urls.filter((u) => u.includes('mapterhorn')).map(keyOf)

describe('planFilmTiles', () => {
  it('lists the terrain and the imagery, Esri included, down to the deepest zoom under the camera', () => {
    const { urls, planned } = planFilmTiles(base)
    expect(urls).toHaveLength(planned)
    expect(urls.some((u) => u.includes('mapterhorn'))).toBe(true)
    expect(urls.some((u) => u.includes('arcgis'))).toBe(true)
    expect(Math.max(...terrainKeys(urls).map((k) => k.z))).toBeGreaterThan(OUTER_MAX_ZOOM)
  })

  it('a region view takes the larger area, and stops at the outer zoom outside the detail area', () => {
    const region = engineAreaFor(bounds, true)
    expect(region.detailArea).toBeDefined()
    // a view from far above, looking down: the outer tiles, then the camera low on the track: the detail
    const high: FilmPose = { timeS: 0, position: frame.toLocal(6.87, 45.92, 400_000), target: frame.toLocal(6.87, 45.92 - 0.045, 1500) }
    const plan = planFilmTiles({ ...base, ...region, poses: [high, followPose(5, 45.92 - 50 * 0.0009)], camera: { ...lens, far: 2e6 } })
    const keys = terrainKeys(plan.urls)
    const outside = keys.filter((k) => !boundsIntersect(tileBounds(k), region.detailArea!))
    const inside = keys.filter((k) => boundsIntersect(tileBounds(k), region.detailArea!))
    expect(outside.length).toBeGreaterThan(0)
    expect(Math.max(...outside.map((k) => k.z))).toBeLessThanOrEqual(OUTER_MAX_ZOOM)
    expect(Math.max(...inside.map((k) => k.z))).toBeGreaterThan(OUTER_MAX_ZOOM)
    // the plain area, as the offline planner takes it, has none of the outer tiles
    const plain = planFilmTiles({ ...base, poses: [followPose(5, 45.92 - 50 * 0.0009)] })
    expect(terrainKeys(plain.urls).every((k) => boundsIntersect(tileBounds(k), base.area))).toBe(true)
  })

  it('the corridor follows the aspect: a landscape frame is wider than a portrait one', () => {
    const wide = planFilmTiles({ ...base, aspect: 16 / 9 })
    const tall = planFilmTiles({ ...base, aspect: 9 / 16 })
    const columns = (urls: string[]) => {
      const keys = terrainKeys(urls)
      const deepest = Math.max(...keys.map((k) => k.z))
      return new Set(keys.filter((k) => k.z === deepest).map((k) => k.x)).size
    }
    expect(columns(wide.urls)).toBeGreaterThan(columns(tall.urls))
  })

  it('orders the tiles by the film time they are needed at, the coarse ones first at equal time', () => {
    const north = followPose(0, 45.92 - 5 * 0.0009)
    const south = followPose(90, 45.92 - 95 * 0.0009)
    const { urls } = planFilmTiles({ ...base, poses: [north, south] })
    const keys = terrainKeys(urls)
    const lat = (k: TileKey) => (tileBounds(k).north + tileBounds(k).south) / 2
    const deepest = Math.max(...keys.map((k) => k.z))
    const fine = keys.filter((k) => k.z === deepest)
    // the deepest tiles of the north come before those of the south
    expect(lat(fine[0])).toBeGreaterThan(lat(fine[fine.length - 1]))
    // at the same time (one pose), no fine tile before a coarser one
    const first = planFilmTiles({ ...base, poses: [north] })
    const zooms = terrainKeys(first.urls).map((k) => k.z)
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b))
  })

  it('stops at the size the device keeps, the start of the film first', () => {
    const poses = [followPose(0, 45.92 - 5 * 0.0009), followPose(90, 45.92 - 95 * 0.0009)]
    const all = planFilmTiles({ ...base, poses })
    const cut = planFilmTiles({ ...base, poses, maxBytes: all.estimatedBytes / 4 })
    expect(cut.planned).toBe(all.planned)
    expect(cut.urls.length).toBeLessThan(all.urls.length)
    expect(cut.estimatedBytes).toBeLessThanOrEqual(all.estimatedBytes / 4)
    expect(all.urls.slice(0, cut.urls.length)).toEqual(cut.urls)
  })

  it('the finer imagery levels are asked for only under the tiles at their deepest zoom', () => {
    const none = planFilmTiles(base)
    const finer = planFilmTiles({ ...base, imageryZoomOffset: 1 })
    const deepest = Math.max(...terrainKeys(none.urls).map((k) => k.z))
    const imageryZooms = (urls: string[]) => new Set(urls.filter((u) => u.includes('arcgis')).map((u) => keyOf(u).z))
    expect(Math.max(...imageryZooms(none.urls))).toBe(deepest)
    expect(Math.max(...imageryZooms(finer.urls))).toBe(deepest + 1)
    // the coarser levels stay what they were: the offset is not applied to them
    expect(Math.min(...imageryZooms(finer.urls))).toBe(Math.min(...imageryZooms(none.urls)))
    // fewer finer tiles than if every tile had the offset: the tiles one level above the deepest stay at their own level
    const above = [...imageryZooms(finer.urls)].filter((z) => z <= deepest - 1)
    expect(above.length).toBeGreaterThan(0)
  })

  it('gives a dated tile the same tile of the latest photos as its fallback', () => {
    const dated = datedImagerySource(getImagerySource('ign-ortho'), 'ign:2012')
    const { urls, fallbacks } = planFilmTiles({ ...base, imagery: dated })
    const imageryUrls = urls.filter((u) => u.includes('ORTHOIMAGERY') || u.includes('geopf'))
    expect(imageryUrls.length).toBeGreaterThan(0)
    expect(fallbacks.size).toBe(imageryUrls.length)
    for (const url of imageryUrls) {
      const fallback = fallbacks.get(url)!
      expect(fallback).not.toBe(url)
      expect(fallback).toContain('ORTHOIMAGERY.ORTHOPHOTOS&')
      expect(url).toContain('ORTHOIMAGERY.ORTHOPHOTOS')
    }
    expect(planFilmTiles(base).fallbacks.size).toBe(0)
  })
})

describe('planFilmTiles with the relief already loaded', () => {
  it('gives each URL the film time it is first needed at', () => {
    const poses = [followPose(0, 45.92 - 10 * 0.0009), followPose(5, 45.92 - 90 * 0.0009)]
    const { urls, times } = planFilmTiles({ ...base, poses })
    expect(times).toHaveLength(urls.length)
    expect(times[0]).toBe(0)
    expect(times.at(-1)).toBe(5)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('a tile spans the heights read under it, with a margin, so that fewer far tiles are taken than with the track range', () => {
    const flat = () => 1500
    const loose = planFilmTiles({ ...base, trackMinM: 1000, trackMaxM: 3000 })
    const tight = planFilmTiles({ ...base, heightAt: flat })
    expect(tight.planned).toBeLessThan(loose.planned)
    expect(tight.planned).toBeGreaterThan(0)
  })

  it('falls back on the track range where the relief has no height yet', () => {
    const none = planFilmTiles({ ...base, heightAt: () => undefined })
    expect(none.planned).toBe(planFilmTiles(base).planned)
  })

  it('heightRange: the lowest and highest of the points read, widened by the margin', () => {
    const [node] = planFilmTilesRoots()
    const [min, max] = heightRange(node, (lon) => (lon < node.bounds.west + 1e-9 ? 1000 : 1200))!
    expect(min).toBeLessThan(1000 - HEIGHT_MARGIN_M)
    expect(max).toBeGreaterThan(1200 + HEIGHT_MARGIN_M)
    expect(heightRange(node, () => undefined)).toBeNull()
  })
})

describe('sampleFilmPoses', () => {
  const times = Array.from({ length: 301 }, (_, i) => i / 10)
  const view = (_progress: number, timeS: number) => ({ position: new Vector3(timeS, 0, 0), target: new Vector3(0, 0, 0) })

  it('takes a pose every step of film time, with the first and the last frame', () => {
    const poses = sampleFilmPoses(times, times, view, () => true, 0.5)
    expect(poses[0].timeS).toBe(0)
    expect(poses.at(-1)!.timeS).toBe(30)
    expect(poses).toHaveLength(61)
  })

  it('takes the first frame of every shot, where the camera jumps', () => {
    const poses = sampleFilmPoses(times, times, view, (a, b) => !(a < 10.05 && b > 10.05) && !(a < 10.15 && b > 10.15), 5)
    expect(poses.map((p) => p.timeS)).toContain(10.1)
  })

  it('copies the placement: a view reused by the caller does not change a pose already taken', () => {
    const shared = { position: new Vector3(), target: new Vector3() }
    const poses = sampleFilmPoses([0, 1], [0, 1], (_p, t) => (shared.position.set(t, 0, 0), shared), () => true, 0.5)
    expect(poses.map((p) => p.position.x)).toEqual([0, 1])
  })
})
