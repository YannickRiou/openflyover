/**
 * Tiles of the film fetched before its first frame (#401): the terrain and imagery tiles the flyover needs are asked
 * for at full speed, in the order the film needs them, so that the render waits for the graphics card rather than for
 * the network. They only go into the browser's HTTP cache (every source sends `Cache-Control`; Esri may not go into an
 * offline pack, `offline/policy.ts`): nothing is stored apart, and the render still asks the engine for each tile, so a
 * tile the cache dropped is simply fetched again. The list is the offline planner's (`planOfflineTiles`) along a
 * corridor of the track, cut at a size the device's cache can hold.
 */
import type { DeviceKind } from '../core/deviceBudget'
import type { LonLat, TileKey } from '../core/types'
import { tileCenter, tileGroundSizeM } from '../geo/mercator'
import { offlinePolicy } from '../offline/policy'
import { planOfflineTiles } from '../offline/plan'
import type { OfflinePlanInput } from '../offline/plan'
import type { StoredTileReader } from '../terrain/fetch'

/** width of the corridor of the track whose fine tiles are fetched (metres, as the narrowest offline pack) */
export const PRELOAD_CORRIDOR_M = 2_000
/** requests at once */
export const PRELOAD_CONCURRENCY = 8
/** most bytes fetched ahead (estimated): about what the HTTP cache of the device keeps without dropping the first ones */
export const PRELOAD_MAX_BYTES: Record<DeviceKind, number> = { phone: 250e6, tablet: 400e6, desktop: 1e9 }
/** points of the track the order is taken from (the nearest one gives a tile its place in the film) */
const ORDER_POINTS = 500

export interface FilmTiles {
  /** URLs to fetch, in the order the film needs them */
  urls: string[]
  /** tiles of the whole plan (more than `urls` when it was cut at the size) */
  planned: number
  /** estimated size of `urls` (bytes) */
  estimatedBytes: number
}

/** Index of the point of `points` nearest to `p` (flat distance, metres per degree of longitude scaled at `p`). */
function nearestIndex(points: readonly LonLat[], p: LonLat): number {
  const kx = Math.cos((p.lat * Math.PI) / 180)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const dx = (points[i].lon - p.lon) * kx
    const dy = points[i].lat - p.lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The tiles to fetch before the film: the coarse ones first (wider than the corridor: the landscape, the opening and
 * closing shots, coarsest first), then the fine ones in the order the track passes them, cut once `maxBytes` (estimated
 * with the typical tile size of each source) is reached.
 */
export function filmTilesToPreload(input: Omit<OfflinePlanInput, 'corridorM'> & { maxBytes: number }): FilmTiles {
  const plan = planOfflineTiles({ ...input, corridorM: PRELOAD_CORRIDOR_M })
  const step = Math.max(1, Math.ceil(input.points.length / ORDER_POINTS))
  const along = input.points.filter((_, i) => i % step === 0)
  const rank = (key: TileKey | undefined) => {
    if (!key) return Infinity
    if (tileGroundSizeM(key) > PRELOAD_CORRIDOR_M) return key.z - 100
    return along.length > 0 ? nearestIndex(along, tileCenter(key)) : 0
  }
  const ranked = plan.tiles.map((tile) => ({ tile, rank: rank(tile.key) })).sort((a, b) => a.rank - b.rank)
  const urls: string[] = []
  let estimatedBytes = 0
  for (const { tile } of ranked) {
    const bytes = offlinePolicy(tile.sourceId).typicalTileBytes
    if (estimatedBytes + bytes > input.maxBytes) break
    estimatedBytes += bytes
    urls.push(tile.url)
  }
  return { urls, planned: plan.tiles.length, estimatedBytes }
}

export interface PreloadDeps {
  /** fetch a tile (into the HTTP cache); a failure is only counted, the render will ask again */
  download(url: string): Promise<unknown>
  /** offline packs: a tile they hold is not fetched */
  stored?: StoredTileReader | null
  isCanceled(): boolean
  onProgress?(done: number, total: number): void
  concurrency?: number
}

/** Fetch `urls`, `concurrency` at a time, until the end or a cancel. */
export async function preloadTiles(urls: readonly string[], deps: PreloadDeps): Promise<{ done: number; failed: number }> {
  let next = 0
  let done = 0
  let failed = 0
  const worker = async () => {
    while (next < urls.length && !deps.isCanceled()) {
      const url = urls[next++]
      try {
        const held = deps.stored?.covers(url) ? await deps.stored.get(url) : null
        if (!held) await deps.download(url)
      } catch {
        failed++
      }
      done++
      deps.onProgress?.(done, urls.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? PRELOAD_CONCURRENCY) }, worker))
  return { done, failed }
}
