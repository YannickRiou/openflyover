/**
 * Days of a multi-day track and their cards (« Cartes de jour », Lumière tab): days split on the local calendar date of
 * the recorded times, and the figures of each day the card can show. The card itself is drawn from these at every frame
 * (overlay/data.ts `dayCardAt`), so it follows the track, the nights and the weather; earlier versions baked it into
 * the texts of the film (`day-n`), which `withoutDayCards` removes. Pure module (no DOM, React, Three or store).
 */
import type { TrackPath } from '../flyover/path'
import type { WeatherSeries, WeatherSummary } from '../weather/series'
import { summarizeOuting } from '../weather/series'
import type { Film, FilmText } from './model'

/** A day of the track: from its first recorded point to the first point of the next day (metres along the path). */
export interface TrackDay {
  /** local calendar date, 'YYYY-MM-DD' */
  date: string
  startM: number
  endM: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Local calendar date of `ms`: on the clock of the recording when the file says its offset (`utcOffsetMin`), else on
 * this device's clock (as the timeline shows the recorded time).
 */
export function localDate(ms: number, utcOffsetMin?: number): string {
  if (utcOffsetMin !== undefined) {
    const d = new Date(ms + utcOffsetMin * 60_000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Days of `path` by the local date of its timed points (one day, or none without time, for a single-day track). */
export function trackDays(path: TrackPath, utcOffsetMin?: number): TrackDay[] {
  const days: TrackDay[] = []
  for (let i = 0; i < path.count; i++) {
    if (Number.isNaN(path.time[i])) continue
    const date = localDate(path.time[i], utcOffsetMin)
    const last = days[days.length - 1]
    if (last?.date === date) continue
    if (last) last.endM = path.dist[i]
    days.push({ date, startM: days.length === 0 ? 0 : path.dist[i], endM: path.lengthM })
  }
  return days
}

/** Texts made by the day cards of earlier versions: `day-1`, `day-2`… */
export const isDayCard = (text: Pick<FilmText, 'id'>) => /^day-\d+$/.test(text.id)

/** Timeline id of the card of day `k` (0 for the first): its block on the « Textes » lane (`film.dayCards`). */
const DAY_CARD_PREFIX = 'card-day-'
export const dayCardId = (k: number) => `${DAY_CARD_PREFIX}${k}`
export const isDayCardItem = (item: string | null | undefined): item is string => typeof item === 'string' && item.startsWith(DAY_CARD_PREFIX)
export const dayCardIndexOf = (item: string) => Number(item.slice(DAY_CARD_PREFIX.length))

/**
 * Window of the card of day `k` on the clock (`clock.days`, there only while the cards are on): from the day's card time
 * for the cards' duration, never past the next day's card; null when there is no such day.
 */
export function dayCardWindow(days: readonly { cardS: number }[], k: number, durationS: number): { startS: number; endS: number } | null {
  const day = days[k]
  if (!day) return null
  const endS = Math.min(day.cardS + durationS, days[k + 1]?.cardS ?? Infinity)
  return endS > day.cardS ? { startS: day.cardS, endS } : null
}

/** `film` without the day cards baked into its texts by earlier versions (the other texts are kept as they are). */
export function withoutDayCards(film: Film): Film {
  return film.texts.some(isDayCard) ? { ...film, texts: film.texts.filter((text) => !isDayCard(text)) } : film
}

/** What a day card can say of its day. */
export interface DayFigures {
  /** 1 for the first day */
  n: number
  count: number
  /** local calendar date, 'YYYY-MM-DD' */
  date: string
  /** first recorded time of the day (ms since epoch) */
  startTime?: number
  distanceM: number
  /** climb of the day (absent without elevations) */
  ascentM?: number
  /** from its first to its last recorded time */
  durationS?: number
  weather?: WeatherSummary
}

/**
 * Figures of each day of `days`: distance, climb (`ascent`: the cumulative ascent at each point of the path,
 * `cumulativeAscent`), time from its first to its last recorded point and the weather along it (`series`, when fetched).
 * A day is its timed points of its local date (`utcOffsetMin`, as `trackDays`): the last point of an evening and the
 * first of the morning can stand at the same distance.
 */
export function dayFigures(
  path: TrackPath,
  days: readonly TrackDay[],
  ascent: ArrayLike<number> | undefined,
  series?: WeatherSeries | null,
  utcOffsetMin?: number,
): DayFigures[] {
  const ends = new Map<string, { first: number; last: number }>()
  for (let i = 0; i < path.count; i++) {
    if (Number.isNaN(path.time[i])) continue
    const date = localDate(path.time[i], utcOffsetMin)
    const known = ends.get(date)
    if (known) known.last = i
    else ends.set(date, { first: i, last: i })
  }
  return days.map((day, k) => {
    const { first, last } = ends.get(day.date) ?? { first: 0, last: 0 }
    const figures: DayFigures = { n: k + 1, count: days.length, date: day.date, distanceM: day.endM - day.startM }
    figures.startTime = path.time[first]
    if (path.time[last] > path.time[first]) figures.durationS = (path.time[last] - path.time[first]) / 1000
    const gained = ascent ? ascent[last] - ascent[first] : Number.NaN
    if (Number.isFinite(gained)) figures.ascentM = Math.max(0, gained)
    if (series) {
      const weather = summarizeOuting(series, path, 60, { fromM: day.startM, toM: day.endM })
      if (weather) figures.weather = weather
    }
    return figures
  })
}
