import type { Track, TrackPoint } from '../../core/types'

/** XML 1.0 refuses most control characters, even escaped: they are left out of a name. */
const withoutControls = (text: string): string => Array.from(text).filter((c) => c.charCodeAt(0) >= 32 || c === '\t' || c === '\n' || c === '\r').join('')
const escapeXml = (text: string): string => withoutControls(text).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
const coordinate = (value: number): string => String(Math.round(value * 1e7) / 1e7)

function pointXml(p: TrackPoint, tag: string, indent: string): string {
  const inner: string[] = []
  if (p.ele !== undefined && Number.isFinite(p.ele)) inner.push(`<ele>${Math.round(p.ele * 100) / 100}</ele>`)
  if (p.time !== undefined && Number.isFinite(p.time)) inner.push(`<time>${new Date(p.time).toISOString()}</time>`)
  const tpx: string[] = []
  if (p.temp !== undefined) tpx.push(`<gpxtpx:atemp>${p.temp}</gpxtpx:atemp>`)
  if (p.hr !== undefined) tpx.push(`<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`)
  if (p.cad !== undefined) tpx.push(`<gpxtpx:cad>${Math.round(p.cad)}</gpxtpx:cad>`)
  const extensions = [...(p.power !== undefined ? [`<power>${Math.round(p.power)}</power>`] : []), ...(tpx.length > 0 ? [`<gpxtpx:TrackPointExtension>${tpx.join('')}</gpxtpx:TrackPointExtension>`] : [])]
  if (extensions.length > 0) inner.push(`<extensions>${extensions.join('')}</extensions>`)
  return `${indent}<${tag} lat="${coordinate(p.lat)}" lon="${coordinate(p.lon)}">${inner.join('')}</${tag}>`
}

/**
 * « Exporter la trace en GPX »: a GPX 1.1 document of the track as it is now (segments, waypoints, name, activity). The
 * measures the app knows (heart rate, cadence, temperature in the Garmin extension, power in a `power` element) go in the
 * point extensions, so the file opens again here and in the other tools.
 */
export function trackToGpx(track: Track): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="OpenFlyover" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><name>${escapeXml(track.name)}</name></metadata>`,
  ]
  for (const w of track.waypoints ?? []) {
    lines.push(`  <wpt lat="${coordinate(w.lat)}" lon="${coordinate(w.lon)}">${w.ele !== undefined ? `<ele>${w.ele}</ele>` : ''}<name>${escapeXml(w.name)}</name></wpt>`)
  }
  lines.push('  <trk>', `    <name>${escapeXml(track.name)}</name>`)
  if (track.activityType) lines.push(`    <type>${escapeXml(track.activityType)}</type>`)
  for (const segment of track.segments) {
    lines.push('    <trkseg>', ...segment.points.map((p) => pointXml(p, 'trkpt', '      ')), '    </trkseg>')
  }
  lines.push('  </trk>', '</gpx>', '')
  return lines.join('\n')
}

/** File name of the export: the track's name without what a file system refuses. */
export function gpxFileName(track: Track): string {
  const printable = Array.from(track.name, (c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('')
  const base = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 100)
  // Windows keeps these names for devices
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? `_${base}` : base || 'trace'}.gpx`
}
