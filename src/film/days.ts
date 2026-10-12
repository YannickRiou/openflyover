/**
 * Days of a multi-day track and their cards (« Ajouter les cartes de jour », Lumière tab): days split on the local
 * calendar date of the recorded times; the cards are ordinary texts of the film, added on demand, then free to edit.
 * Pure module (no DOM, React, Three or store).
 */
import type { TrackPath } from '../flyover/path'
import { formatDistance } from '../ui/format'
import type { FilmClock } from './clock'
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

/** What a day card says under « Jour n »: the distance of the day, the distance from the start at its end. */
export interface DayCardContent {
  day: boolean
  total: boolean
}

/** How long a day card stays (seconds at ×1), as a stage card « À la suite ». */
export const DAY_CARD_S = 5

/** Texts made by `withDayCards`: `day-1`, `day-2`… */
export const isDayCard = (text: Pick<FilmText, 'id'>) => /^day-\d+$/.test(text.id)

/** The days of a track and how to read their dates (`trackDays`). */
export interface DayCardTrack {
  days: readonly TrackDay[]
  lengthM: number
  utcOffsetMin?: number
}

/**
 * `film` with a card at the start of each day of `track` (none for a single day), replacing the day cards made
 * before: « Jour n » and, below, the distance of the day and / or the distance at its end. The first shows when the
 * flight starts, the others when the marker reaches the day's first point, or later, at the end of the night pause
 * whose sunrise is that day.
 */
export function withDayCards(film: Film, track: DayCardTrack, clock: Pick<FilmClock, 'timeAtProgress' | 'nights'>, content: DayCardContent): Film {
  const texts = film.texts.filter((t) => !isDayCard(t))
  const { days, lengthM, utcOffsetMin } = track
  if (days.length < 2 || !(lengthM > 0)) return { ...film, texts }
  const cards = days.map((day, k): FilmText => {
    let startS = clock.timeAtProgress(k === 0 ? 0 : day.startM / lengthM)
    for (const night of clock.nights) if (k > 0 && localDate(night.sunriseMs, utcOffsetMin) === day.date) startS = Math.max(startS, night.holdEndS)
    const lines = [...(content.day ? [formatDistance(day.endM - day.startM)] : []), ...(content.total ? [`${formatDistance(day.endM)} au total`] : [])]
    const card: FilmText = { id: `day-${k + 1}`, startS: Math.round(startS * 10) / 10, durationS: DAY_CARD_S, text: `Jour ${k + 1}`, anchor: 'center', size: 1.25 }
    if (lines.length > 0) card.subtitle = lines.join(' · ')
    return card
  })
  return { ...film, texts: [...texts, ...cards] }
}
