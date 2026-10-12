/**
 * Parameter keys of the film (`film.paramKeys`; one timeline lane per keyed parameter): values of a film-wide setting
 * (speed, exposure, sun hour, colour grading) pinned along the track and eased from one key to the next. Same anchor as
 * the camera keys, the distance along the first track: a key holds during a stop. Pure module (no three.js), generic over the parameter so
 * other keyed values can reuse it: add a name to `FILM_PARAMS` and its entry to `PARAM_SPECS`.
 */
import { smootherstep } from '../core/math'
import { GRADING_RANGES, type GradingValues } from '../scene/grading'
import type { Film } from './model'

/** The parameters a key can drive (closed list). */
export const FILM_PARAMS = ['speed', 'exposure', 'sunHour', 'saturation', 'contrast', 'warmth', 'vignette'] as const
export type FilmParam = (typeof FILM_PARAMS)[number]

export interface FilmParamKey {
  id: string
  /** distance along the first track (metres, same scale as the camera keys) */
  atM: number
  param: FilmParam
  value: number
}

export interface ParamSpec {
  label: string
  min: number
  max: number
  step: number
  /** eased geometrically (a speed factor: ×0.5 to ×2 passes ×1 halfway) rather than linearly */
  log?: boolean
  format(value: number): string
}

const comma = (n: number, digits: number) => n.toFixed(digits).replace('.', ',')
const signed = (n: number) => `${n > 0 ? '+' : ''}${comma(n, 2)}`
const gradingSpec = (label: string, key: keyof GradingValues): ParamSpec => ({ label, ...GRADING_RANGES[key], format: signed })

/**
 * Label, range (also the validity range of a loaded project) and display of each parameter. The ranges of the
 * settings they replace: `exposureEv` ±4 EV, `sunHour` 0–24 h of solar time, the grading sliders, `SPEED_FACTOR_RANGE`.
 */
export const PARAM_SPECS: Record<FilmParam, ParamSpec> = {
  speed: { label: 'Vitesse', min: 0.25, max: 4, step: 0.05, log: true, format: (v) => `×${comma(v, 2).replace(/,?0+$/, '')}` },
  exposure: { label: 'Exposition', min: -4, max: 4, step: 0.1, format: (v) => `${v > 0 ? '+' : ''}${comma(v, 1)} IL` },
  sunHour: {
    label: 'Soleil (heure)',
    min: 0,
    max: 24,
    step: 0.25,
    format: (v) => `${Math.floor(Math.round(v * 60) / 60)} h ${String(Math.round(v * 60) % 60).padStart(2, '0')}`,
  },
  saturation: gradingSpec('Saturation', 'saturation'),
  contrast: gradingSpec('Contraste', 'contrast'),
  warmth: gradingSpec('Température', 'warmth'),
  vignette: gradingSpec('Vignettage', 'vignette'),
}

/** Names of the timeline lanes, one per keyed parameter (shorter than the labels of `PARAM_SPECS`). */
export const PARAM_LANE_LABELS: Record<FilmParam, string> = {
  speed: 'Vitesse',
  exposure: 'Exposition',
  sunHour: 'Soleil',
  saturation: 'Saturation',
  contrast: 'Contraste',
  warmth: 'Température',
  vignette: 'Vignettage',
}

/** The keys of one parameter among `keys` (the film's or the clock's: any key with a `param`), in their order. */
export function keysOfParam<T extends { param: FilmParam }>(keys: readonly T[], param: FilmParam): T[] {
  return keys.filter((k) => k.param === param)
}

/**
 * The parameters that get a timeline lane of their own: those with at least one key, in `FILM_PARAMS` order. Not the
 * speed, whose keys sit on the « Vitesse » lane, which always exists.
 */
export function paramLanes(film: { paramKeys: readonly { param: FilmParam }[] }): FilmParam[] {
  return FILM_PARAMS.filter((p) => p !== 'speed' && film.paramKeys.some((k) => k.param === p))
}

/** The keys of one parameter, by position. */
export function sortedParamKeys(keys: readonly FilmParamKey[], param: FilmParam): FilmParamKey[] {
  return keys.filter((k) => k.param === param).sort((a, b) => a.atM - b.atM)
}

/**
 * Value at `atM` metres from keys already sorted by position (`sortedParamKeys`): `base` without keys, the first
 * key's value before it, the last one's after it, and between two keys an ease from one to the next by smootherstep
 * (still at each key: no jerk), geometric for a `log` parameter.
 */
export function valueAtKeys(keys: readonly FilmParamKey[], base: number, atM: number, log = false): number {
  if (keys.length === 0) return base
  const next = keys.findIndex((k) => k.atM > atM)
  if (next === 0) return keys[0].value
  if (next === -1) return keys[keys.length - 1].value
  const a = keys[next - 1]
  const b = keys[next]
  const k = smootherstep((atM - a.atM) / (b.atM - a.atM))
  return log ? a.value * (b.value / a.value) ** k : a.value + (b.value - a.value) * k
}

/**
 * Value of `param` at `atM` metres along the first track: the film's keys, else `base` (the film-wide setting).
 * A pure function of the position, so a frame depends on the film progress alone (the export stays deterministic).
 */
export function paramAt(film: Pick<Film, 'paramKeys'>, base: number, param: FilmParam, atM: number): number {
  return valueAtKeys(sortedParamKeys(film.paramKeys, param), base, atM, PARAM_SPECS[param].log)
}

/** The film has a key for one of `params` (default: any). */
export function hasParamKeys(film: Pick<Film, 'paramKeys'>, params: readonly FilmParam[] = FILM_PARAMS): boolean {
  return film.paramKeys.some((k) => params.includes(k.param))
}

const GRADING_PARAMS = ['saturation', 'contrast', 'warmth', 'vignette'] as const satisfies readonly FilmParam[]

/** The film has a key for a colour grading value. */
export const hasGradingKeys = (film: Pick<Film, 'paramKeys'>) => hasParamKeys(film, GRADING_PARAMS)

/** Grading values at `atM`: `base` itself (same object) when no key drives one of them. */
export function gradingAt(film: Pick<Film, 'paramKeys'>, base: GradingValues, atM: number): GradingValues {
  if (!hasGradingKeys(film)) return base
  return {
    contrast: paramAt(film, base.contrast, 'contrast', atM),
    saturation: paramAt(film, base.saturation, 'saturation', atM),
    warmth: paramAt(film, base.warmth, 'warmth', atM),
    vignette: paramAt(film, base.vignette, 'vignette', atM),
  }
}

/** The film-wide settings a key replaces (`Settings`): its value when no key exists. */
export interface ParamBases {
  exposureEv: number
  sunHour: number
  grading: GradingValues
}

/** Film-wide value of `param`: what the film shows where no key drives it. */
export function paramBase(settings: ParamBases, param: FilmParam): number {
  switch (param) {
    case 'speed':
      return 1
    case 'exposure':
      return settings.exposureEv
    case 'sunHour':
      return settings.sunHour
    default:
      return settings.grading[param]
  }
}

/** The value kept in the range of its parameter, at the precision of its slider. */
export function clampParamValue(param: FilmParam, value: number): number {
  const { min, max, step } = PARAM_SPECS[param]
  return Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(4))
}
