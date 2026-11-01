/**
 * Route drawn by hand: between two clicked points the line follows the paths of the map. Walkers on French ground go
 * through the IGN Géoplateforme route service (BD TOPO, pedestrian profile); everywhere else, and for bikes, through the
 * FOSSGIS OSRM servers (OpenStreetMap data). A leg that no service can route stays a straight line.
 * Pure module: the network call is injected (`FetchJson`).
 */
import type { LonLat } from '../core/types'

export type RouteProfile = 'foot' | 'bike'
/** How a leg is drawn: along the paths, or straight between its two points. */
export type LegMode = 'trail' | 'straight'

/** Reads the JSON of a URL; rejects on a network failure or an HTTP error. */
export type FetchJson = (url: string, signal?: AbortSignal) => Promise<unknown>

/** Where the IGN route service has data (bounding box of its `bdtopo-pgr` resource: metropolitan France and overseas). */
const IGN_BOX = { west: -63.28125, south: -21.421484375, east: 55.8984375, north: 51.27109375 }

/** The IGN service takes both points of a leg: inside its box (it answers « no data » for the neighbours' share of it, and the next service takes over). */
export function ignCovers(a: LonLat, b: LonLat): boolean {
  return [a, b].every((p) => p.lon >= IGN_BOX.west && p.lon <= IGN_BOX.east && p.lat >= IGN_BOX.south && p.lat <= IGN_BOX.north)
}

const coords = (p: LonLat) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`

/** IGN Géoplateforme: shortest pedestrian route on BD TOPO, geometry as GeoJSON, no steps. */
export function ignUrl(from: LonLat, to: LonLat): string {
  return `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-pgr&profile=pedestrian&optimization=shortest&start=${coords(from)}&end=${coords(to)}&getSteps=false&geometryFormat=geojson`
}

/** FOSSGIS OSRM server of a profile (the server fixes the profile, whatever the word in the path). */
export function osmUrl(profile: RouteProfile, from: LonLat, to: LonLat): string {
  return `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coords(from)};${coords(to)}?overview=full&geometries=geojson`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** The `[lon, lat]` pairs of a GeoJSON LineString, null when it is not a line of at least two valid points. */
function lineOf(geometry: unknown): LonLat[] | null {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return null
  const line: LonLat[] = []
  for (const pair of geometry.coordinates as unknown[]) {
    if (!Array.isArray(pair)) return null
    const [lon, lat] = pair as unknown[]
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
    line.push({ lon, lat })
  }
  return line.length >= 2 ? line : null
}

/** The line of an IGN answer (`geometry`) or of an OSRM answer (`routes[0].geometry`); null when there is none. */
export function parseRoute(json: unknown): LonLat[] | null {
  if (!isRecord(json)) return null
  if (Array.isArray(json.routes)) return lineOf(isRecord(json.routes[0]) ? json.routes[0].geometry : undefined)
  return lineOf(json.geometry)
}

/** The routed line from `from` to `to` along the paths, or null when no service finds one. Never rejects (an aborted call rejects). */
export async function routeLeg(from: LonLat, to: LonLat, profile: RouteProfile, fetchJson: FetchJson, signal?: AbortSignal): Promise<LonLat[] | null> {
  const urls = [...(profile === 'foot' && ignCovers(from, to) ? [ignUrl(from, to)] : []), osmUrl(profile, from, to)]
  for (const url of urls) {
    try {
      const line = parseRoute(await fetchJson(url, signal))
      if (line) return line
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  return null
}

/**
 * The points of the whole route: for each leg its routed line (`legs[i]` joins `waypoints[i]` to `waypoints[i + 1]`),
 * or the straight line when the leg is null. Points repeated at a junction are kept once.
 */
export function joinLegs(waypoints: readonly LonLat[], legs: readonly (readonly LonLat[] | null)[]): LonLat[] {
  const out: LonLat[] = []
  const push = (p: LonLat) => {
    const last = out[out.length - 1]
    if (!last || last.lon !== p.lon || last.lat !== p.lat) out.push(p)
  }
  if (waypoints.length === 1) push(waypoints[0])
  for (let i = 0; i < waypoints.length - 1; i++) {
    for (const p of legs[i] ?? [waypoints[i], waypoints[i + 1]]) push(p)
  }
  return out
}
