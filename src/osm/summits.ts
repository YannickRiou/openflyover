/**
 * Distant summits for the « Panorama » stop of the film (OpenStreetMap, same Overpass queue and cache as the landmarks):
 * the named peaks within `SUMMIT_RADIUS_M` of the stop, highest first, drawn as labels while the camera turns round
 * (scene/PanoramaSummits.tsx). The landmarks only reach 3 km from the track: a panorama names what is far away.
 */
import type { LandmarkLabel } from '../scene/labelModel'
import { formatNumber } from '../ui/format'
import { overpassElements } from './overpass'

/** How far from the stop the summits are looked for (metres). */
export const SUMMIT_RADIUS_M = 25_000
/** Most summits kept for a stop: more would be a crowd of labels. */
export const MAX_SUMMITS = 40

export interface Summit {
  /** "node/123" */
  id: string
  name: string
  lon: number
  lat: number
  /** metres, absent when OpenStreetMap has none */
  ele?: number
}

/** The point is rounded to 0.02° (about 2 km) so that stops next to each other share one query and its cache. */
const GRID_DEG = 0.02

/** Overpass QL query of the named peaks around a stop. */
export function summitQuery(lon: number, lat: number): string {
  const round = (x: number) => (Math.round(x / GRID_DEG) * GRID_DEG).toFixed(2)
  return `[out:json][timeout:60];\nnode["natural"="peak"]["name"](around:${SUMMIT_RADIUS_M},${round(lat)},${round(lon)});\nout body qt;\n`
}

interface PeakElement {
  type?: string
  id?: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

/** The named peaks of an Overpass response, highest first (unknown height last), at most `MAX_SUMMITS`; throws on a server-side error. */
export function parseSummits(json: unknown): Summit[] {
  const out: Summit[] = []
  for (const element of overpassElements(json) as PeakElement[]) {
    const tags = element.tags
    const name = (tags?.['name:fr'] ?? tags?.name ?? '').trim()
    if (!name || element.lat === undefined || element.lon === undefined || element.id === undefined) continue
    const summit: Summit = { id: `${element.type ?? 'node'}/${element.id}`, name, lon: element.lon, lat: element.lat }
    const ele = Number.parseFloat(tags?.ele ?? '')
    if (Number.isFinite(ele)) summit.ele = ele
    out.push(summit)
  }
  out.sort((a, b) => (b.ele ?? -Infinity) - (a.ele ?? -Infinity))
  return out.slice(0, MAX_SUMMITS)
}

/** Labels of the summits; those that the landmarks name already (`knownIds`: "osm:node/123") are left out. */
export function summitLabels(summits: readonly Summit[], knownIds: ReadonlySet<string> = new Set()): LandmarkLabel[] {
  return summits
    .filter((s) => !knownIds.has(`osm:${s.id}`))
    .map((s) => {
      const label: LandmarkLabel = {
        id: `summit:${s.id}`,
        lon: s.lon,
        lat: s.lat,
        text: s.ele === undefined ? s.name : `${s.name} · ${formatNumber(s.ele)} m`,
        kind: 'peak',
        // below the waypoints (50) and the landmarks of the route; the highest summits win among themselves
        priority: 10 + Math.min(35, (s.ele ?? 0) / 100),
      }
      if (s.ele !== undefined) label.ele = s.ele
      return label
    })
}
