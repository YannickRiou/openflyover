/**
 * The tiles a film asks for, found the way the terrain engine finds them (#401, audit lot 2): the camera of the film is
 * sampled without terrain every fraction of a second (and at every cut), and for each pose the tiles are selected with
 * the engine's own rules (`engineAreaFor`, `detailArea` and `OUTER_MAX_ZOOM`, the frustum of the real aspect and lens,
 * the screen-space error at the export's height, the finer imagery only at a tile's deepest zoom and only the levels the
 * screen shows at that pose, `imageryLevels`). The list is ordered by
 * the film time a tile is first needed, the coarser one first at equal time. Pure (tested): no network, no WebGL.
 *
 * What it does not model: the coarsening of the level of detail a phone applies to stay under its tile cap
 * (`maxResidentTiles`; the plan then holds a few more tiles than the engine draws, and the byte cap cuts it), the
 * camera raised above the relief (poses are placed without terrain), the culled siblings the engine loads at low
 * priority. Tiles not yet loaded have a conservative bounding sphere in the engine (-500 to 9000 m); here the sphere
 * spans the elevation of the track (a margin below, 1500 m above), tighter, so that the distance and the culling are
 * closer to what the engine does once the relief is there.
 */
import { PerspectiveCamera, Vector3 } from 'three'
import type { ImagerySource, LocalFrame, LonLatBounds, TerrainSource } from '../core/types'
import { offlinePolicy } from '../offline/policy'
import { DEFAULT_SEGMENTS, DEFAULT_TUNING, OUTER_MAX_ZOOM } from '../terrain/engine'
import { planImagerySubtiles } from '../terrain/imagery'
import type { TileNode } from '../terrain/quadtree'
import { HEIGHT_MARGIN_M, HEIGHT_MARGIN_SHARE, computeConservativeSphere, createCameraState, createRootNodes, imageryLevels, screenSpaceError, updateCameraState, zoomLimit } from '../terrain/quadtree'
import type { QuadtreeContext, SelectionParams } from '../terrain/quadtree'
import { buildTileUrl } from '../terrain/sources'
import { tileGroundSizeM } from '../geo/mercator'

/** film seconds between two sampled poses (a cut is sampled apart) */
export const POSE_STEP_S = 0.4
/** metres of the conservative height range below the lowest and above the highest point of the track */
export const RANGE_BELOW_M = 300
export const RANGE_ABOVE_M = 1500

export interface FilmPose {
  /** film time (s) */
  timeS: number
  /** local frame */
  position: Vector3
  target: Vector3
  rollRad?: number
}

export interface FilmView {
  position: Vector3
  target: Vector3
  rollRad?: number
}

/**
 * Poses of the film: one every `stepS` of film time, the first and the last frame, and the first frame of every shot
 * (`sameShot` false between two neighbouring frames: a cut), where the camera jumps.
 */
export function sampleFilmPoses(
  times: readonly number[],
  progresses: readonly number[],
  viewAt: (progress: number, timeS: number) => FilmView,
  sameShot: (aS: number, bS: number) => boolean,
  stepS = POSE_STEP_S,
): FilmPose[] {
  const poses: FilmPose[] = []
  let lastS = -Infinity
  for (let i = 0; i < times.length; i++) {
    const timeS = times[i]
    const last = i === times.length - 1
    const cut = i > 0 && !sameShot(times[i - 1], timeS)
    if (!last && !cut && timeS - lastS < stepS) continue
    const view = viewAt(progresses[i], timeS)
    poses.push({ timeS, position: view.position.clone(), target: view.target.clone(), ...(view.rollRad ? { rollRad: view.rollRad } : {}) })
    lastS = timeS
  }
  return poses
}

export interface FilmTilePlanInput {
  poses: readonly FilmPose[]
  frame: LocalFrame
  /** the area of the engine (`engineAreaFor`) */
  area: LonLatBounds
  detailArea?: LonLatBounds
  terrain: TerrainSource
  /** the source the engine draws (dated or not) */
  imagery: ImagerySource | null
  imageryZoomOffset: number
  exaggeration: number
  /** the lens of the film's camera: aspect, and the fov, near and far of the camera in use */
  camera: Pick<PerspectiveCamera, 'fov' | 'near' | 'far'>
  aspect: number
  /** height the engine measures its error against (`exportLodHeight`) */
  viewportHeightPx: number
  errorTargetPx: number
  /** height (m) of the relief already loaded at a point (`engine.sampleHeight`); none: the track's range below */
  heightAt?: (lon: number, lat: number) => number | undefined
  /** elevation range of the track (m), undefined where the track has none */
  trackMinM?: number
  trackMaxM?: number
  maxBytes: number
}

export interface FilmTiles {
  /** URLs to fetch, in the order the film needs them */
  urls: string[]
  /** film time (s) each URL is first needed, same order as `urls` */
  times: number[]
  /** the same tile of the latest photos for a dated tile (`ImagerySource.fallback`), by URL */
  fallbacks: Map<string, string>
  /** tiles of the whole plan (more than `urls` when it was cut at the size) */
  planned: number
  /** estimated size of `urls` (bytes) */
  estimatedBytes: number
  /** poses the plan was made from, tiles of the terrain tree it needs, and the time it took (ms) with the part spent walking the tree */
  poses: number
  nodes: number
  walkMs: number
  planMs: number
}

export { HEIGHT_MARGIN_M }
/** Points of a tile where the loaded relief is read (`heightRange`): its corners, the middle of its sides and its centre. */
const HEIGHT_SAMPLES = [0, 0.5, 1]
/** Margin of `heightRange` (metres): a fixed part and a share of the tile's width (the relief the coarse grid smooths out). */

/**
 * Height range (m) of a tile from the relief already loaded (`heightAt`, the engine's `sampleHeight`: the coarse tiles
 * of the preview cover the whole area), with a margin; null when a point has no height yet. Much tighter than the track's
 * range on a small tile: the engine itself selects a loaded tile with its real heights, so the plan matches it better.
 */
export function heightRange(node: TileNode, heightAt: (lon: number, lat: number) => number | undefined): [number, number] | null {
  const { west, east, south, north } = node.bounds
  let min = Infinity
  let max = -Infinity
  for (const fy of HEIGHT_SAMPLES) {
    for (const fx of HEIGHT_SAMPLES) {
      const h = heightAt(west + (east - west) * fx, north + (south - north) * fy)
      if (h === undefined || !Number.isFinite(h)) return null
      min = Math.min(min, h)
      max = Math.max(max, h)
    }
  }
  const margin = HEIGHT_MARGIN_M + HEIGHT_MARGIN_SHARE * tileGroundSizeM(node.key)
  return [min - margin, max + margin]
}

export function planFilmTiles(input: FilmTilePlanInput): FilmTiles {
  const startedAt = performance.now()
  const { frame, terrain, imagery } = input
  const scale = input.exaggeration
  const minM = (input.trackMinM ?? -200) - RANGE_BELOW_M
  const maxM = (input.trackMaxM ?? 3000) + RANGE_ABOVE_M
  const ctx: QuadtreeContext = { frame, segments: DEFAULT_SEGMENTS, exaggeration: scale }
  const roots = createRootNodes(input.area, terrain.minZoom, terrain.maxZoom, ctx, DEFAULT_TUNING.rootTileBudget)
  const params: SelectionParams = {
    errorTargetPx: input.errorTargetPx,
    maxZoom: Math.max(terrain.minZoom, terrain.maxZoom),
    frame: 0,
    detailArea: input.detailArea,
    outerMaxZoom: OUTER_MAX_ZOOM,
  }
  const prepared = new WeakSet<TileNode>()
  const prepare = (node: TileNode) => {
    if (prepared.has(node)) return
    prepared.add(node)
    const range = input.heightAt ? heightRange(node, input.heightAt) : null
    if (range) computeConservativeSphere(node.bounds, frame, node.boundingSphere, range[0] * scale, range[1] * scale)
    else computeConservativeSphere(node.bounds, frame, node.boundingSphere, minM * scale, maxM * scale)
  }
  roots.forEach(prepare)

  const camera = new PerspectiveCamera(input.camera.fov, input.aspect, input.camera.near, input.camera.far)
  const state = createCameraState()
  /** film time (s) a node is first needed, in the order it was met */
  const wanted = new Map<TileNode, number>()
  /** film time (s) each finer imagery level of a tile at the deepest zoom is first shown: [level 1, level 2, …] */
  const finer = new Map<TileNode, number[]>()
  let timeS = 0
  const visit = (node: TileNode) => {
    if (!state.frustum.intersectsSphere(node.boundingSphere)) return
    if (!wanted.has(node)) wanted.set(node, timeS)
    const sse = screenSpaceError(node.geometricError, node.boundingSphere, state)
    if (node.key.z >= params.maxZoom) {
      const levels = imageryLevels(sse, params.errorTargetPx, input.imageryZoomOffset)
      let times = finer.get(node)
      for (let level = times?.length ?? 0; level < levels; level++) {
        if (!times) finer.set(node, (times = []))
        times.push(timeS)
      }
    }
    if (node.key.z >= zoomLimit(node, params)) return
    if (sse <= params.errorTargetPx) return
    const children = node.ensureChildren()
    for (let i = 0; i < 4; i++) {
      prepare(children[i])
      visit(children[i])
    }
  }
  for (const pose of input.poses) {
    timeS = pose.timeS
    camera.position.copy(pose.position)
    camera.up.set(0, 1, 0)
    if (pose.rollRad) camera.up.applyAxisAngle(pose.target.clone().sub(pose.position).normalize(), pose.rollRad)
    camera.lookAt(pose.target)
    camera.updateProjectionMatrix()
    updateCameraState(state, camera, input.viewportHeightPx)
    for (const root of roots) visit(root)
  }

  const walkedAt = performance.now()
  // a tile and its own imagery when it is first needed, each finer imagery level when the camera is close enough to show it
  const needs: { node: TileNode; timeS: number; level: number }[] = []
  for (const [node, firstS] of wanted) needs.push({ node, timeS: firstS, level: 0 })
  for (const [node, times] of finer) times.forEach((at, i) => needs.push({ node, timeS: at, level: i + 1 }))
  needs.sort((a, b) => a.timeS - b.timeS || a.node.key.z - b.node.key.z || a.level - b.level)
  const urls: string[] = []
  const times: number[] = []
  const fallbacks = new Map<string, string>()
  const seen = new Set<string>()
  const imageryBytes = imagery ? offlinePolicy(imagery.id.split('@')[0]).typicalTileBytes : 0
  const terrainBytes = offlinePolicy(terrain.id).typicalTileBytes
  let planned = 0
  let estimatedBytes = 0
  let full = false
  const add = (url: string, bytes: number, timeS: number, fallback?: string) => {
    if (seen.has(url)) return
    seen.add(url)
    planned++
    if (full || estimatedBytes + bytes > input.maxBytes) {
      full = true
      return
    }
    estimatedBytes += bytes
    urls.push(url)
    times.push(timeS)
    if (fallback) fallbacks.set(url, fallback)
  }
  for (const { node, timeS: firstS, level } of needs) {
    if (level === 0) add(buildTileUrl(terrain, node.key), terrainBytes, firstS)
    if (!imagery) continue
    for (const op of planImagerySubtiles(node.key, imagery, level).tiles) {
      add(buildTileUrl(imagery, op.key), imageryBytes, firstS, imagery.fallback ? buildTileUrl(imagery.fallback, op.key) : undefined)
    }
  }
  return { urls, times, fallbacks, planned, estimatedBytes, poses: input.poses.length, nodes: wanted.size, walkMs: walkedAt - startedAt, planMs: performance.now() - startedAt }
}
