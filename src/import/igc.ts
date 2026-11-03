/**
 * IGC parser: the flight-recorder format of paragliders, hang gliders and gliders (FAI, written by XCTrack, Flymaster,
 * Skytraxx, XCSoar, Flyskyhy…; XContest and Leonardo serve it). Plain text, one record per line, the first letter says
 * which: `H` headers (the date, `HFDTE`; the glider type), `I` the extra fields of the fixes, `B` a fix (time, position,
 * two altitudes), `C` the task declaration (take-off, turn points, landing); `A`, `E`, `F`, `K`, `L`, `G` are ignored.
 * The pilot's name and the glider's identity are never read: nothing personal reaches the track.
 */
import type { Track, TrackPoint, Waypoint } from '../core/types'
import { buildTrack, stripExtension } from './stats'
import { t } from '../i18n'

const DAY_MS = 86_400_000
/** a time of the day that goes back by more than this is the next day (a flight across midnight UTC), not a glitch */
const MIDNIGHT_JUMP_S = 3600
/** bytes of a B record before the extensions (`B` + time 6 + latitude 8 + longitude 9 + validity 1 + two altitudes 10) */
const B_BASE_LENGTH = 35

function invalid(reason: string): Error {
  return new Error(t('imports.igc.invalid', { reason }))
}

/** Where the extra digits of the minutes (`LAD`, `LOD`: the thousandths of a thousandth) sit in a B record, 0-based, end excluded. */
interface Digits {
  start: number
  end: number
}

/** `I023637LAD3839LOD`: a count, then for each field its first and last byte (from 1) and its three-letter code. */
function readExtensions(line: string): { lad?: Digits; lod?: Digits } {
  const out: { lad?: Digits; lod?: Digits } = {}
  for (let at = 3; at + 7 <= line.length; at += 7) {
    const first = Number(line.slice(at, at + 2))
    const last = Number(line.slice(at + 2, at + 4))
    const code = line.slice(at + 4, at + 7)
    if (!Number.isInteger(first) || !Number.isInteger(last) || first <= B_BASE_LENGTH || last < first) continue
    if (code === 'LAD') out.lad = { start: first - 1, end: last }
    else if (code === 'LOD') out.lod = { start: first - 1, end: last }
  }
  return out
}

/** Degrees from `degrees`, `MMmmm` minutes (thousandths), the hemisphere and the extra digits of the minutes. */
function toDegrees(degrees: string, minutes: string, extra: string, negative: boolean, limit: number): number | undefined {
  const whole = Number(degrees)
  const min = Number(minutes + extra) / 1000 / 10 ** extra.length
  if (!Number.isFinite(whole) || !Number.isFinite(min) || min >= 60) return undefined
  const value = whole + min / 60
  if (value > limit) return undefined
  return negative ? -value : value
}

/** `HFDTE150921` and `HFDTEDATE:150921,01`: the day of the flight (UTC) as ms since epoch, undefined when absent or odd. */
function readDate(lines: readonly string[]): number | undefined {
  for (const line of lines) {
    const match = /^H[FOP]DTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/.exec(line)
    if (!match) continue
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
    // the format dates from the 1990s: 80..99 are 19xx
    return Date.UTC(year < 80 ? 2000 + year : 1900 + year, month - 1, day)
  }
  return undefined
}

/** `HFGTYGLIDERTYPE:Ozone Zeno`: the text after the colon, '' when the header is absent. */
function readGliderType(lines: readonly string[]): string {
  for (const line of lines) {
    const match = /^H[FOP]GTY(?:GLIDERTYPE)?:?(.*)$/i.exec(line)
    if (match) return match[1].trim()
  }
  return ''
}

/** « paragliding » unless the glider type says a hang glider (a rigid wing: `figureOfActivity` gives both the paraglider). */
function activityOf(gliderType: string): string {
  return /hang|delta|rigid|moyes|wills\s?wing/i.test(gliderType) ? 'hang gliding' : 'paragliding'
}

/** The turn points of the task (`C` records after the declaration line): take-off, start, turn points, finish, landing. */
function readWaypoints(lines: readonly string[]): Waypoint[] {
  const waypoints: Waypoint[] = []
  for (const line of lines) {
    // the declaration line has digits where a point has its hemisphere letter: only points match
    const match = /^C(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])(.*)$/.exec(line)
    if (!match) continue
    const lat = toDegrees(match[1], match[2], '', match[3] === 'S', 90)
    const lon = toDegrees(match[4], match[5], '', match[6] === 'W', 180)
    // unused entries of the task are written at 0° 0′
    if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) continue
    waypoints.push({ lon, lat, name: match[7].trim() || t('imports.igc.defaultPoint', { n: waypoints.length + 1 }) })
  }
  return waypoints
}

export function parseIgc(text: string, fileName: string): Track[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .map((line) => line.trimEnd())
  const day = readDate(lines)
  const { lad, lod } = readExtensions(lines.find((line) => line.startsWith('I')) ?? '')

  const points: TrackPoint[] = []
  let dayOffset = 0
  let previousSeconds = -1
  for (const line of lines) {
    if (line[0] !== 'B' || line.length < B_BASE_LENGTH) continue
    const match = /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])/.exec(line)
    if (!match) continue
    const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (hours > 23 || minutes > 59 || seconds > 60) continue
    const lat = toDegrees(match[4], match[5], lad ? line.slice(lad.start, lad.end) : '', match[6] === 'S', 90)
    const lon = toDegrees(match[7], match[8], lod ? line.slice(lod.start, lod.end) : '', match[9] === 'W', 180)
    // a fix without a position is written at 0° 0′
    if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) continue

    const point: TrackPoint = { lon, lat }
    // the GNSS altitude of a fix that has one, else the pressure altitude (relative to 1013.25 hPa: rougher)
    const pressure = Number(line.slice(25, 30))
    const gnss = Number(line.slice(30, 35))
    if (match[10] === 'A' && Number.isFinite(gnss) && gnss !== 0) point.ele = gnss
    else if (Number.isFinite(pressure)) point.ele = pressure
    if (day !== undefined) {
      const secondsOfDay = hours * 3600 + minutes * 60 + seconds
      if (previousSeconds - secondsOfDay > MIDNIGHT_JUMP_S) dayOffset += DAY_MS
      previousSeconds = secondsOfDay
      point.time = day + dayOffset + secondsOfDay * 1000
    }
    points.push(point)
  }

  if (points.length === 0) {
    throw invalid(lines.some((line) => line[0] === 'A' || line[0] === 'H') ? t('imports.igc.noPoint') : t('imports.igc.notIgc'))
  }
  const track = buildTrack({
    name: stripExtension(fileName) || t('imports.igc.defaultName'),
    source: 'gpx',
    segments: [{ points }],
    activityType: activityOf(readGliderType(lines)),
  })
  const waypoints = readWaypoints(lines)
  if (waypoints.length > 0) track.waypoints = waypoints
  return [track]
}
