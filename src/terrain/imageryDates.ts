/**
 * « Date des photos »: older photos of IGN BD ORTHO and of Esri World Imagery, to pick a season with or without snow.
 *
 * - IGN: one Géoplateforme layer per year of flight (`ORTHOIMAGERY.ORTHOPHOTOS<year>`), each covering only the
 *   departments flown that year (a plain white tile or a 404 elsewhere): where the year has nothing, the latest photos fill
 *   in (`fallback`, imagery.ts). The years flown at a place and the day of each flight come from the mosaic graphs (WFS
 *   `ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE.<period>`, `date_vol`): one small request per period.
 * - Esri: the World Imagery Wayback archive, one release per update of the mosaic. The tilemap of a release names the
 *   release a tile last changed in (`select`), so walking back from the newest one costs one small request per version
 *   that really differs here, and the metadata layer of that release gives the date the photo was taken.
 *
 * `settings.imageryDate`: '' = the latest photos, 'ign:<year>' or 'esri:<release>'; ignored by the other sources.
 * The dates found are probed once per place and source (kept for the session, small JSON and tiles the HTTP cache keeps).
 */
import type { ImagerySource, LonLat } from '../core/types'

export type ImageryDateKind = 'ign' | 'esri'

/** Years of the IGN layers `ORTHOIMAGERY.ORTHOPHOTOS<year>` (GetCapabilities, October 2026). */
export const IGN_YEARS: readonly number[] = Array.from({ length: 25 }, (_, i) => 2024 - i)

const WAYBACK_CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'
const WAYBACK_TILEMAP_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap'
const WAYBACK_TILE_TEMPLATE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}'
const IGN_WFS_URL = 'https://data.geopf.fr/wfs/ows'
/** Mosaic graphs of BD ORTHO: the latest photos, then one per period of the yearly layers. */
const IGN_LATEST_GRAPH = 'ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE-MOSAIQUAGE:graphe_bdortho'
const IGN_PERIOD_GRAPHS = ['2000-2005', '2006-2010', '2011-2015', '2016-2020', '2021-2023'].map((p) => `ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE.${p}:graphe_bdortho`)
/** Half side of the box the graphs are read in (degrees, about 10 m): the place itself. */
const IGN_POINT_DEG = 0.0001
/** Zoom of the Wayback tile probed at the place (about 1.2 km). */
const WAYBACK_PROBE_ZOOM = 15
/** Metadata layer « 1.2m Resolution Metadata » of a Wayback release (the date of the photo seen near the probe zoom). */
const WAYBACK_METADATA_LAYER = 6
/** Most Wayback versions read at one place (about 20 in the Alps). */
const MAX_WAYBACK_VERSIONS = 40

/** Which kind of dated photos a source has, null for the others. */
export function imageryDateKind(sourceId: string): ImageryDateKind | null {
  return sourceId === 'ign-ortho' ? 'ign' : sourceId === 'arcgis-world-imagery' ? 'esri' : null
}

/** The year or the release of `date` when it is of `kind`, else null (the latest photos). */
export function imageryDateValue(date: string, kind: ImageryDateKind | null): number | null {
  if (!kind || !date.startsWith(`${kind}:`)) return null
  const value = Number(date.slice(kind.length + 1))
  return Number.isInteger(value) && value > 0 ? value : null
}

/** A setting value: '' or 'ign:<4 digits>' or 'esri:<release>'. */
export function isImageryDate(date: unknown): date is string {
  return typeof date === 'string' && /^(ign:\d{4}|esri:\d{1,6})?$/.test(date)
}

/** The source showing the photos of `date` (the source itself for the latest ones or another kind). */
export function datedImagerySource(source: ImagerySource, date: string): ImagerySource {
  const kind = imageryDateKind(source.id)
  const value = imageryDateValue(date, kind)
  if (value === null) return source
  const urlTemplate =
    kind === 'ign'
      ? source.urlTemplate.replace('LAYER=ORTHOIMAGERY.ORTHOPHOTOS&', `LAYER=ORTHOIMAGERY.ORTHOPHOTOS${value}&`)
      : WAYBACK_TILE_TEMPLATE.replace('{release}', String(value))
  // an id of its own: the engine reloads the imagery when the date changes
  return { ...source, id: `${source.id}@${date}`, urlTemplate, fallback: kind === 'ign' ? source : undefined }
}

/** A date offered at a place: the setting value and when the photos were taken (or published, `taken` false). */
export interface ImageryDate {
  value: string
  timeMs: number
  /** false: only the year (IGN) or the release date (Esri, no metadata there) is known */
  taken: boolean
  kind: ImageryDateKind
}

/** The dates of the photos at a place, newest first, and the date of the latest photos when known (`value` ''). */
export interface ImageryDates {
  latest: ImageryDate | null
  dates: ImageryDate[]
}

/** Tile of zoom `z` containing (lon, lat), Web Mercator. */
export function tileAt({ lon, lat }: LonLat, z: number): { z: number; x: number; y: number } {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) }
}

const found = new Map<string, Promise<ImageryDates>>()

/**
 * The dates of `source`'s photos at `at`, newest first: the IGN years flown there with the day of the flight, the Esri
 * versions that differ there with the day the photo was taken. Kept for the session per source and place (about 10 m
 * for IGN, a z15 tile for Esri); a failed search is forgotten (tried again next time).
 */
export function findImageryDates(source: ImagerySource, at: LonLat): Promise<ImageryDates> {
  const kind = imageryDateKind(source.id)
  if (!kind) return Promise.resolve({ latest: null, dates: [] })
  const tile = tileAt(at, WAYBACK_PROBE_ZOOM)
  const key = kind === 'ign' ? `ign:${at.lon.toFixed(4)},${at.lat.toFixed(4)}` : `esri:${tile.z}/${tile.x}/${tile.y}`
  let dates = found.get(key)
  if (!dates) {
    dates = (kind === 'ign' ? ignFlights(at) : waybackVersions(tile, at)).catch((error: unknown) => {
      found.delete(key)
      throw error
    })
    found.set(key, dates)
  }
  return dates
}

interface GraphFeature {
  properties?: { pva?: number; date_vol?: string }
}

/** The flights of a mosaic graph at `at`: year and day (null when the graph only knows the year: « 2002-01-01 »). */
async function graphFlights(layer: string, { lon, lat }: LonLat): Promise<{ year: number; timeMs: number; taken: boolean }[]> {
  const d = IGN_POINT_DEG
  const url =
    `${IGN_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${layer}&OUTPUTFORMAT=application/json&COUNT=20` +
    `&BBOX=${lon - d},${lat - d},${lon + d},${lat + d},EPSG:4326`
  const answer = await fetchJson<{ features?: GraphFeature[] }>(url)
  return (answer.features ?? []).flatMap((f) => {
    const year = f.properties?.pva
    const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(f.properties?.date_vol ?? '')
    if (typeof year !== 'number' || !day) return []
    const taken = !(day[2] === '01' && day[3] === '01')
    return [{ year, timeMs: Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])), taken }]
  })
}

/** The IGN years flown at `at` that have a layer, the day of each flight, and the day of the latest photos. */
async function ignFlights(at: LonLat): Promise<ImageryDates> {
  const [latestFlights, ...periods] = await Promise.all([IGN_LATEST_GRAPH, ...IGN_PERIOD_GRAPHS].map((layer) => graphFlights(layer, at)))
  const byYear = new Map<number, { timeMs: number; taken: boolean }>()
  // the latest photos' year is a yearly layer too, unless it is newer than the last one
  for (const flight of [...periods.flat(), ...latestFlights]) {
    if (IGN_YEARS.includes(flight.year) && !byYear.has(flight.year)) byYear.set(flight.year, flight)
  }
  const dates = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, f]): ImageryDate => ({ value: `ign:${year}`, timeMs: f.timeMs, taken: f.taken, kind: 'ign' }))
  const newest = latestFlights.sort((a, b) => b.timeMs - a.timeMs)[0]
  return { latest: newest ? { value: '', timeMs: newest.timeMs, taken: newest.taken, kind: 'ign' } : null, dates }
}

interface WaybackRelease {
  release: number
  timeMs: number
  metadataUrl: string
}

let releases: Promise<WaybackRelease[]> | undefined

/** The Wayback releases, newest first (the config lists them by release number, not by date). */
function waybackReleases(): Promise<WaybackRelease[]> {
  releases ??= fetchJson<Record<string, { itemTitle: string; metadataLayerUrl: string }>>(WAYBACK_CONFIG_URL)
    .then((config) =>
      Object.entries(config)
        .map(([release, item]) => ({
          release: Number(release),
          // « World Imagery (Wayback 2023-08-10) »
          timeMs: Date.parse(/(\d{4}-\d{2}-\d{2})/.exec(item.itemTitle)?.[1] ?? ''),
          metadataUrl: item.metadataLayerUrl,
        }))
        .filter((r) => Number.isFinite(r.timeMs))
        .sort((a, b) => b.timeMs - a.timeMs),
    )
    .catch((error: unknown) => {
      releases = undefined
      throw error
    })
  return releases
}

async function waybackVersions(tile: { z: number; x: number; y: number }, at: LonLat): Promise<ImageryDates> {
  const all = await waybackReleases()
  const index = new Map(all.map((r, i) => [r.release, i]))
  const versions: WaybackRelease[] = []
  for (let i = 0; i < all.length && versions.length < MAX_WAYBACK_VERSIONS; ) {
    const map = await fetchJson<{ data?: number[]; select?: number[] }>(`${WAYBACK_TILEMAP_URL}/${all[i].release}/${tile.z}/${tile.y}/${tile.x}`)
    if (!map.data?.[0]) break
    const selected = map.select?.[0] ?? all[i].release
    const at = index.get(selected)
    versions.push(all[at ?? i])
    i = (at ?? i) + 1
  }
  const dates = await Promise.all(versions.map((v) => takenAt(v, at).catch(() => null)))
  // a release that only re-published the same photo: one entry, the newest release
  const seen = new Set<number>()
  const result: ImageryDate[] = []
  versions.forEach((v, i) => {
    const timeMs = dates[i] ?? v.timeMs
    if (seen.has(timeMs)) return
    seen.add(timeMs)
    result.push({ value: `esri:${v.release}`, timeMs, taken: dates[i] !== null, kind: 'esri' })
  })
  // the newest release is the photo the live service shows
  return { latest: result[0] ? { ...result[0], value: '' } : null, dates: result }
}

/** When the photo of `version` at `at` was taken (ms), null when its metadata does not say. */
async function takenAt(version: WaybackRelease, { lon, lat }: LonLat): Promise<number | null> {
  const url =
    `${version.metadataUrl}/${WAYBACK_METADATA_LAYER}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
    '&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE2&returnGeometry=false&f=json'
  const answer = await fetchJson<{ features?: { attributes?: { SRC_DATE2?: number | null } }[] }>(url)
  const ms = answer.features?.[0]?.attributes?.SRC_DATE2
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return (await response.json()) as T
}
