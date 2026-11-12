/**
 * KML parser (Google Earth, XCTrack, XContest, Leonardo, GPS Visualizer…), namespace-agnostic like the GPX one. A track is
 * a `gx:Track` (times and positions, one `when` and one `gx:coord` per point) or a `LineString` (positions only,
 * `lon,lat,alt` triples); a `gx:MultiTrack` or several geometries of one Placemark are the segments of one track. A
 * Placemark with a `Point` is a waypoint. KMZ is a zip of a KML (`kmz.ts`).
 */
import { errorMessage } from '../core/errors'
import type { Track, TrackPoint, TrackSegment, Waypoint } from '../core/types'
import { buildTrack, parseUtcTime, stripExtension } from './stats'
import { t } from '../i18n'

/** altitude modes whose altitude is not metres above the sea (the ground follows the relief): the altitude is dropped */
const RELATIVE_MODES = new Set(['clampToGround', 'relativeToGround', 'clampToSeaFloor', 'relativeToSeaFloor'])

function invalid(reason: string): Error {
  return new Error(t('imports.kml.invalid', { reason }))
}

function parseXml(text: string): Document {
  const source = text.replace(/^﻿/, '')
  if (source.trim() === '') throw invalid(t('imports.kml.empty'))
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(source, 'application/xml')
  } catch (error) {
    throw invalid(t('imports.kml.xmlMalformed', { detail: errorMessage(error) }))
  }
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) {
    const detail = (parserError.textContent ?? '').trim().split('\n')[0]
    throw invalid(detail ? t('imports.kml.xmlMalformed', { detail }) : t('imports.kml.xmlMalformedPlain'))
  }
  return doc
}

const textOf = (element: Element | undefined | null): string => (element?.textContent ?? '').trim()

/** The first direct child of `parent` with this local name. */
function childNamed(parent: Element, localName: string): Element | undefined {
  for (const child of parent.children) if (child.localName === localName) return child
  return undefined
}

function childrenNamed(parent: Element, localName: string): Element[] {
  return [...parent.children].filter((child) => child.localName === localName)
}

function within(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit
}

/** `lon,lat[,alt]` (a `coordinates` tuple) or `lon lat [alt]` (a `gx:coord`); undefined when not a position. */
function parsePosition(raw: string): TrackPoint | undefined {
  const parts = raw.trim().split(/[\s,]+/)
  if (parts.length < 2) return undefined
  const [lon, lat] = [Number(parts[0]), Number(parts[1])]
  if (!within(lon, 180) || !within(lat, 90)) return undefined
  const point: TrackPoint = { lon, lat }
  if (parts.length >= 3 && parts[2] !== '') {
    const ele = Number(parts[2])
    if (Number.isFinite(ele)) point.ele = ele
  }
  return point
}

/** A `gx:Track`: its `when` and `gx:coord` children are matched by index (a position without a time keeps none). */
function trackPoints(track: Element): TrackPoint[] {
  const whens = childrenNamed(track, 'when')
  const points: TrackPoint[] = []
  childrenNamed(track, 'coord').forEach((coord, index) => {
    const point = parsePosition(textOf(coord))
    if (!point) return
    const time = whens[index] ? parseUtcTime(textOf(whens[index])) : Number.NaN
    if (Number.isFinite(time)) point.time = time
    points.push(point)
  })
  return points
}

/** A `LineString`: `lon,lat,alt` tuples separated by white space. */
function lineStringPoints(line: Element): TrackPoint[] {
  const coordinates = textOf(childNamed(line, 'coordinates'))
  return coordinates === '' ? [] : coordinates.split(/\s+/).flatMap((raw) => parsePosition(raw) ?? [])
}

/**
 * The altitudes only when they mean metres above the sea (`altitudeMode` absolute, or not said) and do not all say 0 (a
 * file written without altitudes): else they are dropped and the app computes them from the relief, as for a GPX without.
 */
function withAltitudes(points: TrackPoint[], mode: string): TrackPoint[] {
  const usable = !RELATIVE_MODES.has(mode) && points.some((p) => p.ele !== undefined && p.ele !== 0)
  if (usable) return points
  return points.map((point) => {
    const copy = { ...point }
    delete copy.ele
    return copy
  })
}

interface Candidate {
  name: string
  segments: TrackSegment[]
}

/** The Placemark a geometry belongs to (or the document when it has none). */
function placemarkOf(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) if (node.localName === 'Placemark') return node
  return null
}

export function parseKml(text: string, fileName: string): Track[] {
  const doc = parseXml(text)
  const root = doc.documentElement
  if (!root || root.localName !== 'kml') throw invalid(t('imports.kml.notKml'))

  const documentElement = root.getElementsByTagNameNS('*', 'Document')[0]
  const documentName = documentElement ? textOf(childNamed(documentElement, 'name')) : ''
  const fallbackName = documentName || stripExtension(fileName) || t('imports.kml.defaultName')

  // every track geometry, in document order, grouped by Placemark
  const byPlacemark = new Map<Element | null, Candidate>()
  for (const element of root.getElementsByTagNameNS('*', '*')) {
    if (element.localName !== 'Track' && element.localName !== 'LineString') continue
    const mode = textOf(childNamed(element, 'altitudeMode'))
    const points = withAltitudes(element.localName === 'Track' ? trackPoints(element) : lineStringPoints(element), mode)
    if (points.length === 0) continue
    const placemark = placemarkOf(element)
    const candidate = byPlacemark.get(placemark) ?? { name: placemark ? textOf(childNamed(placemark, 'name')) : '', segments: [] }
    candidate.segments.push({ points })
    byPlacemark.set(placemark, candidate)
  }
  if (byPlacemark.size === 0) throw invalid(t('imports.kml.noPoint'))

  // the Points of the file: waypoints of the first track
  const waypoints: Waypoint[] = []
  for (const placemark of root.getElementsByTagNameNS('*', 'Placemark')) {
    const point = [...placemark.getElementsByTagNameNS('*', 'Point')].map((p) => parsePosition(textOf(childNamed(p, 'coordinates')))).find(Boolean)
    if (!point) continue
    const waypoint: Waypoint = { lon: point.lon, lat: point.lat, name: textOf(childNamed(placemark, 'name')) || t('imports.kml.defaultPoint', { n: waypoints.length + 1 }) }
    if (point.ele !== undefined && point.ele !== 0) waypoint.ele = point.ele
    waypoints.push(waypoint)
  }

  const candidates = [...byPlacemark.values()]
  return candidates.map((candidate, index) => {
    const name = candidate.name || (candidates.length > 1 ? `${fallbackName} (${index + 1})` : fallbackName)
    const track = buildTrack({ name, source: 'gpx', segments: candidate.segments })
    if (index === 0 && waypoints.length > 0) track.waypoints = waypoints
    return track
  })
}
