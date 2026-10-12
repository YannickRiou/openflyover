/**
 * Marker keys of the film (`film.markerKeys`): the place along the track where the marker changes its look (ball,
 * figure or picture), cross-faded over a short stretch. Same anchor as the camera and parameter keys, the distance
 * along the film track; a key holds during a stop. Before the first key the marker is the one of the « Marqueur »
 * settings. A key replaces the shape, the figure and the picture only: size, colours, label and stick stay those of
 * the settings. Pure module (no three.js): `markerAt` is a function of the position alone, so a frame depends on the
 * film progress only (the export stays deterministic).
 */
import { oneOf } from '../core/guards'
import { smootherstep } from '../core/math'
import type { Track } from '../core/types'
import { trackPathOf } from '../flyover/path'
import { MARKER_FIGURE_CHOICES, MARKER_KINDS, markerMovesWithTime } from '../scene/markerSettings'
import type { MarkerFigureChoice, MarkerKind, MarkerSettings } from '../scene/markerSettings'
import type { Film } from './model'

export interface FilmMarkerKey {
  id: string
  /** distance along the film track (metres, same scale as the camera keys): the middle of the cross-fade */
  atM: number
  kind: MarkerKind
  figure: MarkerFigureChoice
  /** picture of an 'image' look: id of the project media table (`film/media.ts`); none: the picture of the settings */
  imageId?: string
}

/**
 * Length of a cross-fade in film seconds at the average pace of the flight (`markerFadeM`): long enough to read as a
 * change of look rather than a pop, short enough to stay a detail of the shot.
 */
export const MARKER_FADE_S = 0.8

/** Metres of a cross-fade: `MARKER_FADE_S` of film at the average pace of the flight (the track over its duration). */
export function markerFadeM(lengthM: number, flightS: number): number {
  return flightS > 0 ? (lengthM * MARKER_FADE_S) / flightS : 0
}

/** The keys by position. */
export function sortedMarkerKeys(keys: readonly FilmMarkerKey[]): FilmMarkerKey[] {
  return [...keys].sort((a, b) => a.atM - b.atM)
}

/** Shape, figure and picture of a loaded key (the id and the place are checked by the film). */
export function isValidMarkerLook(key: Record<string, unknown>): boolean {
  return oneOf(MARKER_KINDS, key.kind) && oneOf(MARKER_FIGURE_CHOICES, key.figure) && (key.imageId === undefined || typeof key.imageId === 'string')
}

/** What the marker shows between two looks: `from` fading into `to` (`mix` 0..1; the same object when settled). */
export interface MarkerBlend {
  from: MarkerSettings
  to: MarkerSettings
  mix: number
}

/** The settings with the look of `key`; a picture look without a picture of its own keeps the one of the settings. */
function withKey(base: MarkerSettings, key: FilmMarkerKey, imageOf: (id: string) => string): MarkerSettings {
  return { ...base, kind: key.kind, figure: key.figure, image: key.imageId ? imageOf(key.imageId) : base.image }
}

/**
 * The marker at `atM` metres: the look of the last key whose cross-fade (`fadeM` metres centred on the key, from the
 * start of the track at the earliest) has begun, fading in from the look before it (the previous key's, or `base`
 * before the first one) by smootherstep. `imageOf` gives the data URL of a media id ('' when unknown). Without a key
 * (or before the first), `base` itself.
 */
export function markerAt(
  film: Pick<Film, 'markerKeys'>,
  base: MarkerSettings,
  atM: number,
  fadeM: number,
  imageOf: (id: string) => string = () => '',
): MarkerBlend {
  const keys = sortedMarkerKeys(film.markerKeys)
  const start = (k: FilmMarkerKey) => Math.max(0, k.atM - fadeM / 2)
  let i = keys.length - 1
  while (i >= 0 && start(keys[i]) > atM) i--
  if (i < 0) return { from: base, to: base, mix: 1 }
  const to = withKey(base, keys[i], imageOf)
  const mix = fadeM > 0 ? smootherstep((atM - start(keys[i])) / fadeM) : 1
  if (mix >= 1) return { from: to, to, mix: 1 }
  return { from: i > 0 ? withKey(base, keys[i - 1], imageOf) : base, to, mix }
}

/** A key can bring an animated or pulsing look: a held export frame must then be rendered again. */
export function markerKeysMoveWithTime(film: Pick<Film, 'markerKeys'>, base: MarkerSettings): boolean {
  return markerMovesWithTime(base) || film.markerKeys.some((k) => markerMovesWithTime({ ...base, kind: k.kind }))
}

/**
 * Where the film track changes track, in metres along it: the cuts between the stages « À la suite » (`cutsM`), else
 * the start of each segment after the first (the days of a track chained with « Enchaîner en un seul parcours »).
 */
export function junctionsM(track: Track | undefined, cutsM?: readonly number[]): number[] {
  if (cutsM && cutsM.length > 0) return [...cutsM]
  if (!track || track.segments.length < 2) return []
  const { dist } = trackPathOf(track)
  const out: number[] = []
  let index = 0
  for (const segment of track.segments.slice(0, -1)) {
    index += segment.points.length
    if (index < dist.length) out.push(dist[index])
  }
  return out
}
