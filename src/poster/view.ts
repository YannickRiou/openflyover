/**
 * The poster's view: what it frames (every loaded track), and the « Carte à plat » map, drawn in 2D from the imagery
 * tiles of the source in use instead of the 3D overview: seen from straight above (Web Mercator, north up), no
 * perspective, no haze, each track in its colour over a casing of the poster's page colour, a flag at its start and finish.
 *
 * `framingPath` and `planFlatMap` are pure (tested); `renderFlatMap` fetches the tiles and draws.
 */
import { clamp } from '../core/math'
import type { LonLatBounds, TileFetcher, TileKey, TileSourceBase, Track } from '../core/types'
import { buildTrackPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { boundsIntersect, lonLatToTileFrac, tileBounds, tileXToLon, tileYToLat } from '../geo/mercator'
import { LABEL_KIND_ACCENTS, LABEL_PANEL_COLOR, endpointLabels } from '../scene/labelModel'
import { POI_ICON_PATHS } from '../scene/poiIcons'
import { buildTileUrl } from '../terrain/sources'
import { t } from '../i18n'

/** Share of the view's width and height left free around the tracks, on each side. */
export const FLAT_MAP_MARGIN = 0.08
/** Tiles of one map at most: the zoom goes down until they fit (a print, not a bulk download). */
export const FLAT_MAP_MAX_TILES = 300
/** Where a tile is missing: the grey of the 3D view without imagery (`IMAGERY_FALLBACK_COLOR`). */
const MISSING_TILE = '#8A8F94'

/** Every track as one path: the box the overview of the poster frames. */
export function framingPath(tracks: readonly Track[]): TrackPath {
  return buildTrackPath({ ...tracks[0], segments: tracks.flatMap((t) => t.segments) })
}

/** A tile and where it goes in the view (whole pixels: neighbours meet without a seam). */
export interface FlatMapTile {
  key: TileKey
  x: number
  y: number
  w: number
  h: number
}

export interface FlatMapPlan {
  zoom: number
  tiles: FlatMapTile[]
  /** pixel of the view at a lon/lat */
  project(lon: number, lat: number): { x: number; y: number }
  /** lon/lat at a pixel of the view (the inverse of `project`) */
  unproject(x: number, y: number): { lon: number; lat: number }
}

/**
 * Tiles of a `width` × `height` px map of `bounds` (the tracks), centred, inside FLAT_MAP_MARGIN, never more zoomed
 * than the source's deepest tiles. Tiles are drawn near their own size (zoom rounded: × 0.7 to × 1.4), at a lower
 * zoom when they would be more than `maxTiles`; those outside the source's coverage are left out. `margin` replaces
 * FLAT_MAP_MARGIN (0: `bounds` is the whole view, as for the map of the landmarks that is panned and zoomed).
 */
export function planFlatMap(
  bounds: LonLatBounds,
  width: number,
  height: number,
  source: Pick<TileSourceBase, 'tileSize' | 'minZoom' | 'maxZoom' | 'coverage'>,
  maxTiles = FLAT_MAP_MAX_TILES,
  margin = FLAT_MAP_MARGIN,
): FlatMapPlan {
  // Web Mercator at zoom 0: the world is the unit square, y down from the north edge
  const nw = lonLatToTileFrac(bounds.west, bounds.north, 0)
  const se = lonLatToTileFrac(bounds.east, bounds.south, 0)
  const room = 1 - 2 * margin
  // view pixels per world unit
  const k = Math.min((width * room) / (se.x - nw.x), (height * room) / (se.y - nw.y), source.tileSize * 2 ** source.maxZoom)
  const left = (nw.x + se.x) / 2 - width / (2 * k)
  const top = (nw.y + se.y) / 2 - height / (2 * k)

  const rangeAt = (z: number) => {
    const n = 2 ** z
    const index = (world: number) => clamp(Math.floor(world * n), 0, n - 1)
    return { n, x0: index(left), x1: index(left + width / k), y0: index(top), y1: index(top + height / k) }
  }
  const countAt = (z: number) => {
    const r = rangeAt(z)
    return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
  }
  let zoom = clamp(Math.round(Math.log2(k / source.tileSize)), source.minZoom, source.maxZoom)
  while (zoom > source.minZoom && countAt(zoom) > maxTiles) zoom--

  const { n, x0, x1, y0, y1 } = rangeAt(zoom)
  const pixelX = (world: number) => Math.round((world - left) * k)
  const pixelY = (world: number) => Math.round((world - top) * k)
  const tiles: FlatMapTile[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = { z: zoom, x, y }
      if (source.coverage && !boundsIntersect(tileBounds(key), source.coverage)) continue
      const px = pixelX(x / n)
      const py = pixelY(y / n)
      tiles.push({ key, x: px, y: py, w: pixelX((x + 1) / n) - px, h: pixelY((y + 1) / n) - py })
    }
  }
  return {
    zoom,
    tiles,
    project(lon, lat) {
      const f = lonLatToTileFrac(lon, lat, 0)
      return { x: (f.x - left) * k, y: (f.y - top) * k }
    },
    unproject(x, y) {
      return { lon: tileXToLon(left + x / k, 0), lat: tileYToLat(top + y / k, 0) }
    },
  }
}

export interface FlatMapInput {
  width: number
  height: number
  /** box of every track */
  bounds: LonLatBounds
  source: TileSourceBase
  tracks: readonly Track[]
  /** width of a track line (px), over a casing twice as wide */
  lineWidth: number
  casing: string
  fetcher: TileFetcher
  signal: AbortSignal
  /** tiles settled (drawn or failed) out of the map's, after each one */
  onProgress?: (done: number, total: number) => void
}

/** A flat map and the tiles that never came (grey there). */
export interface FlatMap {
  view: OffscreenCanvas
  missingTiles: number
}

/** Each segment of each track: casings first, so a line crossing another stays whole. */
function drawTracks(ctx: OffscreenCanvasRenderingContext2D, plan: FlatMapPlan, input: FlatMapInput): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const stroke = (colorOf: (track: Track) => string, width: number) => {
    for (const track of input.tracks) {
      for (const segment of track.segments) {
        ctx.beginPath()
        segment.points.forEach((p, i) => {
          const { x, y } = plan.project(p.lon, p.lat)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = colorOf(track)
        ctx.lineWidth = width
        ctx.stroke()
      }
    }
  }
  stroke(() => input.casing, input.lineWidth * 2)
  stroke((track) => track.color, input.lineWidth)
}

/** The start / finish pin of the 3D labels without text (`Labels.tsx`), px on a 1080 px view: flag, panel, stem, dot. */
const PIN = { flag: 14, panel: 26, panelH: 24, radius: 5, stem: 10, dot: 4 }

/**
 * A pin on the start and the finish of each track, one for a loop (`endpointLabels`), on top of the lines; a pin
 * nearer than its own width to one already drawn is left out (the racers of a ghost race start together).
 */
function drawEndpoints(ctx: OffscreenCanvasRenderingContext2D, plan: FlatMapPlan, input: FlatMapInput): void {
  // sized like the line: on a 1080 px view, the 3D pin's own size
  const u = Math.min(input.width, input.height) / 1080
  const accent = LABEL_KIND_ACCENTS.endpoint
  const flag = new Path2D(POI_ICON_PATHS.drapeau)
  const drawn: { x: number; y: number }[] = []
  for (const label of input.tracks.flatMap((track) => endpointLabels(track, false))) {
    const { x, y } = plan.project(label.lon, label.lat)
    if (drawn.some((p) => Math.hypot(p.x - x, p.y - y) < PIN.panel * u)) continue
    drawn.push({ x, y })
    const bottom = y - (PIN.dot + 1 + PIN.stem) * u
    const top = bottom - PIN.panelH * u
    const left = x - (PIN.panel * u) / 2
    ctx.globalAlpha = 0.9
    ctx.fillStyle = LABEL_PANEL_COLOR
    ctx.beginPath()
    ctx.roundRect(left, top, PIN.panel * u, PIN.panelH * u, PIN.radius * u)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.save()
    ctx.translate(left + ((PIN.panel - PIN.flag) / 2) * u, top + ((PIN.panelH - PIN.flag) / 2) * u)
    ctx.scale((PIN.flag / 24) * u, (PIN.flag / 24) * u)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2.5
    ctx.stroke(flag)
    ctx.restore()
    ctx.strokeStyle = LABEL_PANEL_COLOR
    ctx.lineWidth = 2 * u
    ctx.beginPath()
    ctx.moveTo(x, bottom)
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, PIN.dot * u, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()
    ctx.lineWidth = 1.5 * u
    ctx.stroke()
  }
}

/**
 * The flat map, tiles drawn as they come (grey where one fails), with the count of those that failed. Rejects when not
 * a single tile came.
 */
export async function renderFlatMap(input: FlatMapInput): Promise<FlatMap> {
  const { width, height, source, fetcher, signal, onProgress } = input
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error(t('poster.error.mapImage'))
  ctx.fillStyle = MISSING_TILE
  ctx.fillRect(0, 0, width, height)
  const plan = planFlatMap(input.bounds, width, height, source)
  let done = 0
  onProgress?.(0, plan.tiles.length)
  const loaded = await Promise.allSettled(
    plan.tiles.map(async (tile) => {
      try {
        const bitmap = await fetcher.fetchBitmap(buildTileUrl(source, tile.key), { signal })
        ctx.drawImage(bitmap, tile.x, tile.y, tile.w, tile.h)
      } finally {
        onProgress?.(++done, plan.tiles.length)
      }
    }),
  )
  signal.throwIfAborted()
  const missingTiles = loaded.filter((r) => r.status === 'rejected').length
  if (plan.tiles.length > 0 && missingTiles === plan.tiles.length) {
    throw new Error(t('poster.error.noTile', { name: source.name }))
  }
  drawTracks(ctx, plan, input)
  drawEndpoints(ctx, plan, input)
  return { view: canvas, missingTiles }
}
