/**
 * Composite imagery texture for one terrain tile: for a tile (z, x, y) and `zoomOffset = k`, the 2^k x 2^k imagery
 * sub-tiles at z + k are drawn into one canvas of `tileSize * 2^k` pixels (an sRGB `CanvasTexture` with mipmaps).
 * Past the source's maxZoom the deepest tiles are cropped / scaled up; sub-tiles outside the source coverage are
 * skipped and failed ones left grey (`userData.incomplete`); the promise rejects only when every sub-tile failed or the
 * signal was aborted.
 *
 * Once the GPU has the pixels (`texture.onUpdate`), the canvas is released (`releaseCanvas`: 0 x 0, reference dropped,
 * `userData.released`): a phone cannot afford ~1 MB of JS memory a resident tile. A new WebGL context has none of them, so
 * the engine redraws a released tile from the sources (`restoreEngineImagery`).
 *
 * `planImagerySubtiles` is pure (and tested); `loadImageryTexture` does the fetching and drawing.
 */
import { errorMessage } from '../core/errors'
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type { Texture } from 'three'
import type { ImagerySource, LoadImageryOptions, LoadImageryTexture, TileFetcher, TileKey } from '../core/types'
import { boundsIntersect, tileBounds, tileKeyString } from '../geo/mercator'
import { buildTileUrl } from './sources'
import { createCanvas } from './dem'
import { TileFetchError, createAbortError, isAbortError } from './fetch'

/** Neutral grey drawn where imagery is missing (failed, aborted or out of coverage). */
export const IMAGERY_FALLBACK_COLOR = '#8a8f94'

/** Blank-tile probe: the tile drawn at this size, every channel of every pixel at least this bright = a plain white tile. */
const BLANK_PROBE_PX = 8
const BLANK_MIN_LEVEL = 250
/** Coarser tiles tried at most, one level at a time, in place of a blank one (IGN's white tiles span z13 to z17: five levels up to z12). */
const BLANK_FALLBACK_LEVELS = 6

/** Largest zoom offset honoured (2^4 = 16 sub-tiles per side, a 4096 px canvas for 256 px tiles). */
export const MAX_IMAGERY_ZOOM_OFFSET = 4

export interface ImageryDrawOp {
  /** Source tile to fetch. */
  key: TileKey
  /** Destination rectangle in the composite canvas, pixels. */
  dx: number
  dy: number
  dw: number
  dh: number
  /** Source rectangle in the fetched tile, pixels (the whole tile unless cropping a coarser zoom). */
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface ImageryPlan {
  canvasSize: number
  tiles: ImageryDrawOp[]
}

/**
 * Plan which source tiles to draw where, for the terrain tile `key` at `zoomOffset` levels of extra detail.
 *   - z + k <= maxZoom : 2^k x 2^k whole tiles at z + k.
 *   - z + k >  maxZoom : the tiles at maxZoom intersecting the terrain tile, each cropped to the part that
 *     covers it and scaled up (when maxZoom < z a single ancestor tile is cropped).
 *   - effective zoom below minZoom, or sub-tile outside `coverage` : skipped (left grey).
 */
export function planImagerySubtiles(key: TileKey, source: ImagerySource, zoomOffset: number): ImageryPlan {
  const k = Math.min(MAX_IMAGERY_ZOOM_OFFSET, Math.max(0, Math.floor(zoomOffset)))
  const canvasSize = source.tileSize * 2 ** k
  const tiles: ImageryDrawOp[] = []

  const sourceZ = Math.min(key.z + k, source.maxZoom)
  if (sourceZ < source.minZoom) return { canvasSize, tiles }

  // Terrain tile extent in source-tile units at `sourceZ` (exact: powers of two).
  const scale = 2 ** (sourceZ - key.z)
  const left = key.x * scale
  const top = key.y * scale
  const right = left + scale
  const bottom = top + scale
  const pxPerSourceTile = canvasSize / scale

  const colStart = Math.floor(left)
  const colEnd = Math.ceil(right) - 1
  const rowStart = Math.floor(top)
  const rowEnd = Math.ceil(bottom) - 1

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const subKey: TileKey = { z: sourceZ, x: col, y: row }
      if (source.coverage && !boundsIntersect(tileBounds(subKey), source.coverage)) continue

      // Intersection of the source tile with the terrain tile, in source-tile units.
      const ix0 = Math.max(col, left)
      const ix1 = Math.min(col + 1, right)
      const iy0 = Math.max(row, top)
      const iy1 = Math.min(row + 1, bottom)

      tiles.push({
        key: subKey,
        sx: (ix0 - col) * source.tileSize,
        sy: (iy0 - row) * source.tileSize,
        sw: (ix1 - ix0) * source.tileSize,
        sh: (iy1 - iy0) * source.tileSize,
        dx: (ix0 - left) * pxPerSourceTile,
        dy: (iy0 - top) * pxPerSourceTile,
        dw: (ix1 - ix0) * pxPerSourceTile,
        dh: (iy1 - iy0) * pxPerSourceTile,
      })
    }
  }
  return { canvasSize, tiles }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type CompositeCanvas = OffscreenCanvas | HTMLCanvasElement
type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** The GPU has the pixels: free the canvas (WebKit keeps a canvas's backing store until the next GC otherwise). */
function releaseCanvas(texture: Texture): void {
  const canvas = texture.image as CompositeCanvas | null
  if (!canvas) return
  canvas.width = canvas.height = 0
  texture.image = null
  texture.userData.released = true
}

function createTexture(canvas: CompositeCanvas, key: TileKey): Texture {
  const texture = new CanvasTexture<CompositeCanvas>(canvas)
  texture.name = `imagery ${tileKeyString(key)}`
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.anisotropy = 16 // the engine clamps it to the renderer's maximum
  texture.flipY = true // canvas row 0 is the north edge; the mesh builder uses uv.y = 1 - v
  texture.onUpdate = releaseCanvas
  texture.needsUpdate = true
  return texture
}

let probe: Canvas2D | undefined

/**
 * True for a plain white tile. A regional source that does not cover a place may answer one (HTTP 200) instead of a 404:
 * IGN does outside France from z13 on (docs/sources.md), where the terrain would turn white next to the coarser tiles'
 * colours. Eight by eight nearest-neighbour samples: a real tile hardly has all 64 that bright, and a mistake only costs a blurrier tile.
 */
export function isBlank(bitmap: ImageBitmap): boolean {
  try {
    probe ??= createCanvas(BLANK_PROBE_PX, BLANK_PROBE_PX).getContext('2d', { willReadFrequently: true }) as Canvas2D
    probe.imageSmoothingEnabled = false
    probe.drawImage(bitmap, 0, 0, BLANK_PROBE_PX, BLANK_PROBE_PX)
    return probe.getImageData(0, 0, BLANK_PROBE_PX, BLANK_PROBE_PX).data.every((v) => v >= BLANK_MIN_LEVEL)
  } catch {
    return false
  }
}

export const loadImageryTexture: LoadImageryTexture = async (
  key: TileKey,
  source: ImagerySource,
  fetcher: TileFetcher,
  options: LoadImageryOptions,
): Promise<Texture> => {
  const { signal, priority } = options
  if (signal?.aborted) throw createAbortError()

  const plan = planImagerySubtiles(key, source, options.zoomOffset)
  // created when the first sub-tile arrives (a canvas is megabytes: none for a tile that is cancelled or fails)
  let canvas: CompositeCanvas | undefined
  let ctx: Canvas2D | undefined
  const surface = (): Canvas2D => {
    if (ctx) return ctx
    canvas = createCanvas(plan.canvasSize, plan.canvasSize)
    const context = canvas.getContext('2d') as Canvas2D | null
    if (!context) throw new Error('2D canvas context unavailable: cannot composite imagery.')
    context.fillStyle = IMAGERY_FALLBACK_COLOR
    context.fillRect(0, 0, plan.canvasSize, plan.canvasSize)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    return (ctx = context)
  }

  let drawn = 0
  let failure: unknown
  // Each sub-tile is drawn as soon as it arrives: held until its siblings are in, the fetcher's LRU may evict and close it
  // (a busy export, 16 sub-tiles a tile) and its area would stay grey, from the cache as from the network.
  await Promise.all(
    plan.tiles.map(async (op) => {
      for (let attempt = 0; ; attempt++) {
        let bitmap: ImageBitmap
        let { sx, sy, sw, sh } = op
        try {
          let key = op.key
          let from = source
          // dated photos where the year did not fly (a blank tile, or a 404 for some): the latest photos instead
          const dated = await fetcher.fetchBitmap(buildTileUrl(from, key), { priority, signal }).catch((error: unknown) => {
            if (from.fallback && error instanceof TileFetchError && error.status === 404) return null
            throw error
          })
          if (dated && !(from.fallback && isBlank(dated))) bitmap = dated
          else {
            from = from.fallback ?? from
            bitmap = await fetcher.fetchBitmap(buildTileUrl(from, key), { priority, signal })
          }
          // a blank tile (regional sources only): the same ground from the nearest coarser tile that is not, like a source's own overview
          for (let up = 0; up < BLANK_FALLBACK_LEVELS && key.z > from.minZoom && from.coverage && isBlank(bitmap); up++) {
            const half = from.tileSize / 2
            ;[sx, sy, sw, sh] = [(key.x & 1) * half + sx / 2, (key.y & 1) * half + sy / 2, sw / 2, sh / 2]
            key = { z: key.z - 1, x: key.x >> 1, y: key.y >> 1 }
            bitmap = await fetcher.fetchBitmap(buildTileUrl(from, key), { priority, signal })
          }
        } catch (error) {
          if (!isAbortError(error)) failure = error
          return
        }
        // The plan is expressed in catalogue pixels; scale the source rectangle to the bitmap really received.
        const kx = bitmap.width / source.tileSize
        const ky = bitmap.height / source.tileSize
        const target = surface()
        try {
          target.drawImage(bitmap, sx * kx, sy * ky, sw * kx, sh * ky, op.dx, op.dy, op.dw, op.dh)
          drawn++
          return
        } catch (error) {
          // A bitmap closed by the cache meanwhile: ask for it once more, then leave the area grey.
          if (attempt > 0) {
            failure = error
            return
          }
        }
      }
    }),
  )
  if (signal?.aborted) throw createAbortError()

  if (plan.tiles.length > 0 && drawn === 0) {
    // Every sub-tile was cancelled by the fetcher itself (clear() on dispose): report it as an abort, not a failure.
    if (failure === undefined) throw createAbortError()
    const cause = errorMessage(failure)
    throw new Error(`No imagery could be loaded for tile ${tileKeyString(key)} (${source.id}): ${cause}`, {
      cause: failure,
    })
  }
  surface()
  const texture = createTexture(canvas as CompositeCanvas, key)
  // grey patches where a sub-tile failed: the engine tries the tile again before it keeps them
  if (failure !== undefined) texture.userData.incomplete = true
  return texture
}
