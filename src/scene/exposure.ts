/**
 * Scene exposure under the physical atmosphere. Takram radiances are physical: the daylight exposure would
 * leave dusk and night pitch black, so the exposure opens up as the sun goes down, like a camera on
 * automatic, and the user adds a compensation in stops (EV).
 *
 * Pure functions (no React, no renderer).
 */
import type { Vector3 } from 'three'
import type { SceneWeather } from '../weather/sceneWeather'

/** Radiance → display scale in daylight. */
export const DAYLIGHT_EXPOSURE = 5

/** Automatic extra stops by sun elevation (degrees): none in daylight, then civil dusk, then full night. */
const AUTO_EV_CURVE: readonly (readonly [elevationDeg: number, ev: number])[] = [
  [10, 0],
  [-6, 3],
  [-18, 6],
]

/** Faint sky fill of the relief at night (the atmosphere only models sunlight), before exposure. */
export const NIGHT_FILL_INTENSITY = 0.004

const DEG = 180 / Math.PI

/** Sun elevation above the local horizon (radians) from unit ECEF vectors. */
export function sunElevation(sunDirectionEcef: Vector3, upEcef: Vector3): number {
  return Math.asin(Math.min(1, Math.max(-1, sunDirectionEcef.dot(upEcef))))
}

/** Extra stops opened automatically for a sun at `elevationRad` (piecewise linear, clamped). */
export function autoExposureEv(elevationRad: number): number {
  const deg = elevationRad * DEG
  const first = AUTO_EV_CURVE[0]
  const last = AUTO_EV_CURVE[AUTO_EV_CURVE.length - 1]
  if (deg >= first[0]) return first[1]
  if (deg <= last[0]) return last[1]
  for (let i = 1; i < AUTO_EV_CURVE.length; i++) {
    const [d1, ev1] = AUTO_EV_CURVE[i]
    if (deg >= d1) {
      const [d0, ev0] = AUTO_EV_CURVE[i - 1]
      return ev0 + ((deg - d0) / (d1 - d0)) * (ev1 - ev0)
    }
  }
  return last[1]
}

/** Renderer exposure for the sun elevation and the user compensation (stops). */
export function sceneExposure(elevationRad: number, compensationEv: number): number {
  return DAYLIGHT_EXPOSURE * 2 ** (autoExposureEv(elevationRad) + compensationEv)
}

/** Night fill light: 0 while the sun is up, full once it is 6° below the horizon; `nightLightEv` stops brighter (« Clarté des nuits »). */
export function nightFillIntensity(elevationRad: number, nightLightEv = 0): number {
  const t = Math.min(1, Math.max(0, -(elevationRad * DEG) / 6))
  return NIGHT_FILL_INTENSITY * t * 2 ** nightLightEv
}

/** Linear multipliers of the unlit colours of a marker: the light it takes from the scene (`markerLight`). */
export interface MarkerLight {
  r: number
  g: number
  b: number
}

export const NEUTRAL_MARKER_LIGHT: MarkerLight = { r: 1, g: 1, b: 1 }
/** No channel goes under this (linear): a white ball stays a light ball at night, never a grey-brown one. */
export const MARKER_LIGHT_FLOOR = 0.32
/**
 * The light by sun elevation (degrees, linear multipliers, level included): neutral in daylight, warming over the last
 * 14° of the sun's descent to a full orange at the horizon, a dimmer afterglow, a mauve dusk, then the bluish and
 * dimmer night from 14° below. The tints go from one to the next without crossing grey, so the white ball is cream,
 * then mauve, then pale blue, never a dull grey.
 */
const LIGHT_STOPS: readonly (readonly [elevationDeg: number, light: MarkerLight])[] = [
  [14, { r: 1, g: 1, b: 1 }],
  [5, { r: 1, g: 0.85, b: 0.68 }],
  [0, { r: 1, g: 0.72, b: 0.5 }],
  [-4, { r: 0.86, g: 0.64, b: 0.52 }],
  [-6, { r: 0.78, g: 0.6, b: 0.72 }],
  [-9, { r: 0.6, g: 0.64, b: 0.84 }],
  [-14, { r: 0.42, g: 0.52, b: 0.76 }],
]
/** Share of the weather's dimming (`SceneWeather`: 0.75 sun + 0.25 sky) a marker takes: overcast skies dim it a little at most. */
const WEATHER_DIM = 0.1
/** Under clouds the tint of the light fades towards grey, down to this share of it with no direct sun. */
const WEATHER_TINT_MIN = 0.6

/**
 * The marker takes a little of the scene's light (`LIGHT_STOPS`), its tint fading and its level dropping a little as
 * the weather takes the sun and the sky (`sunScale`, `skyScale`). A function of the sun elevation and the weather of
 * the frame alone (no memory between frames), with a floor so it stays readable on any ground.
 */
export function markerLight(elevationRad: number, weather: Pick<SceneWeather, 'sunScale' | 'skyScale'>): MarkerLight {
  const deg = elevationRad * DEG
  const last = LIGHT_STOPS.length - 1
  let i = 1
  while (i < last && deg < LIGHT_STOPS[i][0]) i++
  const [d0, from] = LIGHT_STOPS[i - 1]
  const [d1, to] = LIGHT_STOPS[i]
  const k = Math.min(1, Math.max(0, (deg - d0) / (d1 - d0)))
  const tint = { r: from.r + (to.r - from.r) * k, g: from.g + (to.g - from.g) * k, b: from.b + (to.b - from.b) * k }
  const overcast = 0.75 * weather.sunScale + 0.25 * weather.skyScale
  const keep = WEATHER_TINT_MIN + (1 - WEATHER_TINT_MIN) * overcast
  const grey = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b
  const level = 1 - WEATHER_DIM * (1 - overcast)
  const channel = (c: number) => Math.min(1, Math.max(MARKER_LIGHT_FLOOR, (c * keep + grey * (1 - keep)) * level))
  return { r: channel(tint.r), g: channel(tint.g), b: channel(tint.b) }
}
