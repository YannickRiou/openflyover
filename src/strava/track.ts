/**
 * A Strava activity and its streams -> the app's Track, built like a GPX or FIT track (`buildTrack`). Pure.
 */
import type { Track, TrackPoint } from '../core/types'
import { buildTrack, isUtcOffsetMin } from '../import/stats'
import type { StravaActivity, StravaStreams } from './api'
import { t } from '../i18n'

/** Strava sport type -> the app's activity (the FIT sport names) and its label in the list. */
const SPORTS: Record<string, { activity: string; label: string }> = {
  Ride: { activity: 'cycling', get label() { return t('strava.sport.Ride') } },
  GravelRide: { activity: 'cycling', get label() { return t('strava.sport.GravelRide') } },
  MountainBikeRide: { activity: 'cycling', get label() { return t('strava.sport.MountainBikeRide') } },
  VirtualRide: { activity: 'cycling', get label() { return t('strava.sport.VirtualRide') } },
  EBikeRide: { activity: 'e_biking', get label() { return t('strava.sport.EBikeRide') } },
  EMountainBikeRide: { activity: 'e_biking', get label() { return t('strava.sport.EMountainBikeRide') } },
  Run: { activity: 'running', get label() { return t('strava.sport.Run') } },
  TrailRun: { activity: 'trail_running', get label() { return t('strava.sport.TrailRun') } },
  Hike: { activity: 'hiking', get label() { return t('strava.sport.Hike') } },
  Walk: { activity: 'walking', get label() { return t('strava.sport.Walk') } },
  AlpineSki: { activity: 'alpine_skiing', get label() { return t('strava.sport.AlpineSki') } },
  BackcountrySki: { activity: 'backcountry_skiing', get label() { return t('strava.sport.BackcountrySki') } },
  NordicSki: { activity: 'cross_country_skiing', get label() { return t('strava.sport.NordicSki') } },
  Snowshoe: { activity: 'snowshoeing', get label() { return t('strava.sport.Snowshoe') } },
}

/** The sport type (`sport_type`, else the older `type`) of an activity. */
function sportOf(activity: Pick<StravaActivity, 'sport_type' | 'type'>): string {
  return activity.sport_type || activity.type || ''
}

/** App activity of a Strava sport type: from the table, else the type in snake case ("RockClimbing" -> "rock_climbing"). */
export function stravaActivityType(sport: string): string | undefined {
  if (!sport) return undefined
  return SPORTS[sport]?.activity ?? sport.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Label of the sport type in the activity list (the Strava name when it is not in the table). */
export function stravaSportLabel(activity: Pick<StravaActivity, 'sport_type' | 'type'>): string {
  const sport = sportOf(activity)
  return SPORTS[sport]?.label ?? sport
}

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/**
 * One single-segment track: positions, times (start of the activity + the `time` stream), altitude, heart rate,
 * cadence and power when recorded; the name, sport and UTC offset of the activity.
 * Throws when the activity has no GPS position (indoor, manual entry).
 */
export function streamsToTrack(activity: StravaActivity, streams: StravaStreams): Track {
  const startMs = Date.parse(activity.start_date)
  const points: TrackPoint[] = []
  for (const [i, latlng] of (streams.latlng?.data ?? []).entries()) {
    const lat = finite(latlng?.[0])
    const lon = finite(latlng?.[1])
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const point: TrackPoint = { lon, lat }
    const ele = finite(streams.altitude?.data[i])
    if (ele !== undefined) point.ele = ele
    const seconds = finite(streams.time?.data[i])
    if (seconds !== undefined && Number.isFinite(startMs)) point.time = startMs + seconds * 1000
    const hr = finite(streams.heartrate?.data[i])
    if (hr !== undefined) point.hr = hr
    const cad = finite(streams.cadence?.data[i])
    if (cad !== undefined) point.cad = cad
    const power = finite(streams.watts?.data[i])
    if (power !== undefined) point.power = power
    points.push(point)
  }
  if (points.length === 0) throw new Error(t('strava.noPosition'))

  const track = buildTrack({
    name: activity.name.trim() || t('strava.defaultName'),
    source: 'strava',
    segments: [{ points }],
    activityType: stravaActivityType(sportOf(activity)),
  })
  const offsetS = finite(activity.utc_offset)
  const utcOffsetMin = offsetS === undefined ? undefined : Math.round(offsetS / 900) * 15
  if (isUtcOffsetMin(utcOffsetMin)) track.utcOffsetMin = utcOffsetMin
  return track
}
