/**
 * Volumetric clouds of the scene (`@takram/three-clouds`): the setting, the cloud cover per layer (weather of the
 * outing or manual), the parameters of the three cloud layers or of the sea of clouds, and the drift with the wind.
 *
 * A pure function of (setting, conditions, film time), so the export renders the same clouds for the same frame. The
 * wind is the one at the start of the outing, constant for the film: the drift is wind x film time, never an
 * accumulation over frames. Pure (no DOM, React or Three).
 */
import { deviceBudget } from '../core/deviceBudget'
import { withDefaults } from '../core/guards'
import { clamp } from '../core/math'
import type { LonLat } from '../core/types'
import { haversineM } from '../geo/lonLat'
import { MIN_STATION_DISTANCE_M, weatherAt, type WeatherSeries } from './series'
import type { SceneConditions } from './sceneWeather'

export const CLOUD_MODES = ['meteo', 'manuel', 'mer', 'aucun'] as const
export type CloudMode = (typeof CLOUD_MODES)[number]

/** Quality of the exported frames (the preview always uses the cheapest one). */
export const CLOUD_QUALITIES = ['low', 'medium', 'high'] as const
export type CloudQuality = (typeof CLOUD_QUALITIES)[number]
/** The setting: a quality chosen by hand, or 'auto' (follows the export quality, `export/qualityTier.ts`). */
export const CLOUD_QUALITY_SETTINGS = ['auto', ...CLOUD_QUALITIES] as const
export type CloudQualitySetting = (typeof CLOUD_QUALITY_SETTINGS)[number]

/**
 * Noise slices averaged per exported frame. Each slice is one noisy march per pixel; with 2 / 4 / 6 the exported
 * frames kept a visible grain on the dense sea of clouds (measured, see ARCHITECTURE.md).
 */
export const EXPORT_SAMPLES: Record<CloudQuality, number> = { low: 16, medium: 24, high: 32 }

/** Rendering of the sea of clouds: volumetric clouds, or a lit surface (scene/CloudSeaSurface.tsx). */
export const SEA_RENDERS = ['volume', 'surface'] as const
export type SeaRender = (typeof SEA_RENDERS)[number]

/** The user setting (`settings.clouds`, atmosphere only). */
export interface CloudSettings {
  /**
   * 'meteo': cover of the outing (Open-Meteo, low / mid / high); 'manuel': `coverage`; 'mer': sea of clouds up to
   * `seaTopM`; 'aucun': no clouds
   */
  mode: CloudMode
  /** manual cover of the low layer, 0..1 (the mid and high layers follow at 60 % and 40 %) */
  coverage: number
  /** base of the low layer above the lowest point of the first track (metres) */
  altitudeM: number
  /** top of the sea of clouds ('mer'), above sea level before the exaggeration (metres) */
  seaTopM: number
  /** rendering of the sea of clouds ('mer') */
  seaRender: SeaRender
  /** quality of the exported frames; 'auto' takes the one of the export quality */
  quality: CloudQualitySetting
  /** « Vent », 'manuel' and 'mer': speed of the wind pushing the clouds (km/h, 0 = still), instead of the weather's */
  windKmh: number
}

/** `seaRender`: « Nappe » by default on a phone or tablet (core/deviceBudget.ts) */
export const DEFAULT_CLOUDS: CloudSettings = { mode: 'meteo', coverage: 0.4, altitudeM: 1200, seaTopM: 2000, seaRender: deviceBudget().seaRender, quality: 'auto', windKmh: 15 }

export const CLOUD_ALTITUDE_RANGE = { min: 200, max: 4000, step: 100 } as const
export const SEA_TOP_RANGE = { min: 300, max: 5000, step: 50 } as const
export const CLOUD_WIND_RANGE = { min: 0, max: 100, step: 5 } as const

/** Settings saved before the sea of clouds get its top and rendering by default (a saved quality stays as chosen). */
export const withCloudDefaults = withDefaults(DEFAULT_CLOUDS)

/** Part of the climb of the track, from its lowest point, below the proposed top of the sea of clouds. */
const SEA_TOP_FRACTION = 0.75

/**
 * Top of the sea of clouds proposed for a track (when 'mer' is chosen): three quarters of the way from its lowest to
 * its highest point, rounded to the slider step, so the valleys are filled and the passes and summits emerge.
 */
export function seaTopFor(minEle: number | undefined, maxEle: number | undefined): number {
  if (minEle === undefined || maxEle === undefined || !Number.isFinite(minEle) || !Number.isFinite(maxEle)) {
    return DEFAULT_CLOUDS.seaTopM
  }
  const top = minEle + SEA_TOP_FRACTION * (maxEle - minEle)
  return clamp(Math.round(top / SEA_TOP_RANGE.step) * SEA_TOP_RANGE.step, SEA_TOP_RANGE.min, SEA_TOP_RANGE.max)
}

export function isValidClouds(v: CloudSettings): boolean {
  return (
    (CLOUD_MODES as readonly string[]).includes(v.mode) &&
    (CLOUD_QUALITY_SETTINGS as readonly string[]).includes(v.quality) &&
    (SEA_RENDERS as readonly string[]).includes(v.seaRender) &&
    v.coverage >= 0 &&
    v.coverage <= 1 &&
    v.altitudeM >= CLOUD_ALTITUDE_RANGE.min &&
    v.altitudeM <= CLOUD_ALTITUDE_RANGE.max &&
    v.seaTopM >= SEA_TOP_RANGE.min &&
    v.seaTopM <= SEA_TOP_RANGE.max &&
    v.windKmh >= CLOUD_WIND_RANGE.min &&
    v.windKmh <= CLOUD_WIND_RANGE.max
  )
}

/** Cloud cover of the three layers, fractions in [0, 1]. */
export interface CloudCovers {
  low: number
  mid: number
  high: number
}

/** Below this cover a layer is not rendered (and no clouds at all below it everywhere). */
export const MIN_CLOUD_COVER = 0.02
/** Manual mode: the mid and high layers relative to the low one. */
const MANUAL_MID = 0.6
const MANUAL_HIGH = 0.4

/**
 * Cover of each layer: null for 'aucun' and 'mer' (its own layer, `seaOfClouds`), or in 'meteo' without conditions
 * (no weather loaded) or without any cloud value. A missing layer counts as the total cover.
 */
export function cloudCoversAt(settings: CloudSettings, conditions: SceneConditions | undefined): CloudCovers | null {
  if (settings.mode === 'aucun' || settings.mode === 'mer') return null
  if (settings.mode === 'manuel') {
    const c = clamp(settings.coverage, 0, 1)
    return { low: c, mid: MANUAL_MID * c, high: MANUAL_HIGH * c }
  }
  return conditions ? coversOf(conditions) : null
}

/** The cloud values of the weather at one place (`SceneConditions`, `WeatherSample`). */
type CoverInputs = Pick<SceneConditions, 'cloudCover' | 'cloudCoverLow' | 'cloudCoverMid' | 'cloudCoverHigh'>

/** Cover of the three layers of the weather: a missing layer counts as the total, null when every value is missing. */
function coversOf(conditions: CoverInputs): CloudCovers | null {
  const total = conditions.cloudCover
  const layer = (percent: number) => (Number.isNaN(percent) ? total : percent)
  const covers = [layer(conditions.cloudCoverLow), layer(conditions.cloudCoverMid), layer(conditions.cloudCoverHigh)]
  if (covers.every((c) => Number.isNaN(c))) return null
  const [low, mid, high] = covers.map((c) => (Number.isNaN(c) ? 0 : clamp(c / 100, 0, 1)))
  return { low, mid, high }
}

/** One cloud layer of the scene (`CloudLayer` of three-clouds); heightM 0 = layer off. */
export interface CloudLayerParams {
  /** base above sea level, terrain exaggeration applied (metres); CloudsLayer adds the geoid undulation */
  altitudeM: number
  heightM: number
  densityScale: number
  /** local weather^exponent: > 1 thins the layer out relative to the dominant one */
  weatherExponent: number
  /** shape of the layer; the three-clouds defaults of the layer when absent */
  shape?: CloudShape
}

/** Shape of a cloud layer (`CloudLayer` of three-clouds). */
export interface CloudShape {
  /** width of the cloudy threshold of the weather texture: smaller is crisper */
  coverageFilterWidth: number
  /** height fraction where the layer is the widest, through hf^bias (0.35: low in the layer, rounded tops) */
  shapeAlteringBias: number
  /** density × (linear × height fraction + constant), from the base (0) to the top (1) of the layer */
  densityProfile: { linear: number; constant: number }
}

export interface SceneClouds {
  /** global `coverage` of three-clouds, [0, 0.55] */
  coverage: number
  /** low (channel r), mid (g), high (b) */
  layers: [CloudLayerParams, CloudLayerParams, CloudLayerParams]
  /** period of the shape noise (metres); three-clouds default (1 / 0.0003, ~3.3 km) when absent */
  shapePeriodM?: number
}

export interface CloudGeometry {
  /** lowest recorded elevation of the first track (metres), the ground the low clouds stand above */
  groundM: number
  /** `CloudSettings.altitudeM` */
  altitudeM: number
  exaggeration: number
}

/** Layer thickness and density, low / mid / high (three-clouds defaults for cumulus, a thinner mid layer, cirrus). */
const LAYER_HEIGHTS_M = [900, 1000, 500] as const
const DENSITY = [0.2, 0.12, 0.003] as const
/** Mid layer base above the low one; cirrus base at max(HIGH_MIN_ALTITUDE_M, ground + HIGH_ABOVE_GROUND_M) (metres). */
const MID_GAP_M = 2000
const HIGH_MIN_ALTITUDE_M = 7000
const HIGH_ABOVE_GROUND_M = 5500
const MAX_EXPONENT = 8
/** Coverage of three-clouds above which every texel is cloudy (default coverage filter width 0.6). */
const FULL_COVERAGE = 0.4
/** Largest `coverage` of three-clouds we use (also the scale of the 8-bit cover field). */
export const MAX_COVERAGE = 0.55
/**
 * Sea of clouds (`seaOfClouds`): thickness (metres, not exaggerated), coverage, exponent, density, shape of its layer
 * and period of its shape noise (metres).
 */
const SEA_THICKNESS_M = 600
const SEA_COVERAGE = 0.95
const SEA_EXPONENT = 0.75
const SEA_DENSITY = 0.15
const SEA_SHAPE: CloudShape = { coverageFilterWidth: 0.3, shapeAlteringBias: 0.35, densityProfile: { linear: -0.5, constant: 1 } }
const SEA_SHAPE_PERIOD_M = 4000

/**
 * `coverage` of three-clouds giving a cloudy fraction 0, 0.1, …, 1 of the sky, per channel of its weather texture
 * (r: low, g: mid, b: high), measured on `local_weather.png` of @takram/three-clouds 0.7.6. A texel w is cloudy at
 * the middle of a layer when w > 1 − 2.5·coverage, so coverage = (1 − Q(1 − f)) / 2.5 with Q the quantiles of the
 * channel; beyond its share of non-zero texels (74 % r, 58 % g), coverage goes from 0.4 to 0.55 (zeros cloudy too).
 */
const COVERAGE_FOR_FRACTION: readonly (readonly number[])[] = [
  [0, 0.129, 0.187, 0.232, 0.273, 0.31, 0.347, 0.384, 0.434, 0.492, 0.55],
  [0, 0.191, 0.267, 0.32, 0.359, 0.386, 0.408, 0.444, 0.479, 0.515, 0.55],
  [0, 0.091, 0.127, 0.154, 0.179, 0.201, 0.223, 0.246, 0.273, 0.308, 0.4],
]

/** Coverage for a cloudy fraction `f` of layer `i` (linear between the measured tenths). */
function coverageFor(i: number, f: number): number {
  const table = COVERAGE_FOR_FRACTION[i]
  const x = clamp(f, 0, 1) * 10
  const k = Math.min(9, Math.floor(x))
  return table[k] + (table[k + 1] - table[k]) * (x - k)
}

/**
 * Parameters of the three layers for `covers`, null when no layer reaches MIN_CLOUD_COVER.
 *
 * three-clouds has a single `coverage` C: the layer that needs the most sets it (COVERAGE_FOR_FRACTION). A layer
 * needing less, C_i, is thinned by its exponent: w^e > t ⇔ w > t^(1/e) with t = 1 − 2.5·C, so e = ln t / ln t_i
 * (t_i = 1 − 2.5·C_i, e ≥ 1, ≤ 8) keeps its own cloudy fraction. Past C = 0.4 (t ≤ 0, near overcast) exponents no
 * longer thin: the density of the other layers is scaled by C_i / C instead. Altitudes: low base `altitudeM` above
 * the ground, mid 2 km higher, cirrus at max(7 km, ground + 5.5 km); all × exaggeration like the relief
 * (thicknesses unchanged).
 */
export function sceneCloudsFrom(covers: CloudCovers | null, geometry: CloudGeometry): SceneClouds | null {
  if (!covers) return null
  const c = [covers.low, covers.mid, covers.high].map((v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0))
  if (Math.max(...c) < MIN_CLOUD_COVER) return null
  const k = Number.isFinite(geometry.exaggeration) && geometry.exaggeration > 0 ? geometry.exaggeration : 1
  const bases = layerBasesM(geometry)
  const needed = c.map((cover, i) => (cover < MIN_CLOUD_COVER ? 0 : coverageFor(i, cover)))
  const coverage = Math.min(MAX_COVERAGE, Math.max(...needed))
  const t = 1 - coverage / FULL_COVERAGE
  const layers = c.map((cover, i): CloudLayerParams => {
    const altitudeM = bases[i] * k
    if (cover < MIN_CLOUD_COVER) return { altitudeM, heightM: 0, densityScale: 0, weatherExponent: 1 }
    const ti = 1 - needed[i] / FULL_COVERAGE
    const thin = t > 0 && ti > t
    return {
      altitudeM,
      heightM: LAYER_HEIGHTS_M[i],
      densityScale: t > 0 ? DENSITY[i] : (DENSITY[i] * needed[i]) / coverage,
      weatherExponent: thin ? clamp(Math.log(t) / Math.log(ti), 1, MAX_EXPONENT) : 1,
    }
  })
  return { coverage, layers: layers as SceneClouds['layers'] }
}

/**
 * Sea of clouds: one dense layer, a quilt over the whole scene, whose top is flat at the scale of the scene and
 * rolls like the top of cumulus at the scale of a few hundred metres.
 *
 * Thickness SEA_THICKNESS_M below the top: the base stays above the valley floors, so a camera under the sea sees an
 * overcast ceiling rather than a white-out. The tuning (coverage just below 1, exponent, crisp threshold, density 0.15)
 * keeps the tops within a few hundred metres and erodes them into cumulus billows (ARCHITECTURE.md "Volumetric clouds").
 */
export function seaOfClouds(seaTopM: number, exaggeration: number): SceneClouds {
  const k = Number.isFinite(exaggeration) && exaggeration > 0 ? exaggeration : 1
  const off: CloudLayerParams = { altitudeM: 0, heightM: 0, densityScale: 0, weatherExponent: 1 }
  return {
    coverage: SEA_COVERAGE,
    layers: [
      {
        altitudeM: seaTopM * k - SEA_THICKNESS_M,
        heightM: SEA_THICKNESS_M,
        densityScale: SEA_DENSITY,
        weatherExponent: SEA_EXPONENT,
        shape: SEA_SHAPE,
      },
      off,
      { ...off },
    ],
    shapePeriodM: SEA_SHAPE_PERIOD_M,
  }
}

/**
 * Layers of the clouds whose cover varies over the scene (`cloudCoverField`): the same bases and thicknesses as
 * `sceneCloudsFrom` for the largest cover of each layer anywhere, but no thinning: the field gives the coverage of
 * every layer where it is rendered, so each layer keeps its own density and exponent 1. Null when no layer reaches
 * MIN_CLOUD_COVER.
 */
export function zonedCloudsFrom(covers: CloudCovers, geometry: CloudGeometry): SceneClouds | null {
  const base = sceneCloudsFrom(covers, geometry)
  if (!base) return null
  const layers = base.layers.map((layer, i) =>
    layer.heightM > 0 ? { ...layer, densityScale: DENSITY[i], weatherExponent: 1 } : layer,
  )
  return { ...base, layers: layers as SceneClouds['layers'] }
}

/** Base of the low, mid and high layers above sea level, before the exaggeration (metres). */
function layerBasesM(geometry: CloudGeometry): number[] {
  const ground = Number.isFinite(geometry.groundM) ? geometry.groundM : 0
  const lowBase = ground + geometry.altitudeM
  return [lowBase, lowBase + MID_GAP_M, Math.max(HIGH_MIN_ALTITUDE_M, ground + HIGH_ABOVE_GROUND_M)]
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/** Horizontal velocity (m/s), towards east and north. */
export interface Wind {
  east: number
  north: number
}

/** Without weather: a light westerly breeze (m/s). */
export const DEFAULT_WIND: Readonly<Wind> = Object.freeze({ east: 4, north: 0 })
/** Wind at the cloud levels relative to the 10 m wind of the archive. */
const ALOFT_FACTOR = 2
/**
 * Clouds drift this many times faster than the real wind: the film shows hours in minutes, at the real speed
 * the drift would not be seen.
 */
export const CLOUD_TIMELAPSE = 20

/**
 * Wind of the film: the 10 m wind of the series at `timeMs` and (lon, lat) (start of the outing), as a velocity
 * towards east / north; DEFAULT_WIND without series or value. Meteorological direction: where it blows from.
 */
export function filmWind(series: WeatherSeries | null, timeMs: number, lon: number, lat: number): Wind {
  const sample = series ? weatherAt(series, timeMs, lon, lat) : undefined
  if (!sample || !Number.isFinite(sample.windSpeed) || !Number.isFinite(sample.windDirection)) return { ...DEFAULT_WIND }
  const speed = Math.max(0, sample.windSpeed) / 3.6
  const toward = ((sample.windDirection + 180) * Math.PI) / 180
  return { east: speed * Math.sin(toward), north: speed * Math.cos(toward) }
}

/**
 * Wind pushing the clouds of `clouds`: the weather's `wind` in 'meteo'; else « Vent » (`windKmh`) in the direction of
 * `wind` (from the west when it is calm).
 */
export function settingsWind(clouds: Pick<CloudSettings, 'mode' | 'windKmh'>, wind: Wind): Wind {
  if (clouds.mode === 'meteo') return wind
  const speed = Math.hypot(wind.east, wind.north)
  const [east, north] = speed > 0 ? [wind.east / speed, wind.north / speed] : [1, 0]
  const ms = clouds.windKmh / 3.6
  return { east: east * ms, north: north * ms }
}

/** Displacement of the clouds (metres east / north) after `filmTimeS` of film. */
export function cloudDrift(wind: Wind, filmTimeS: number): Wind {
  const t = Number.isFinite(filmTimeS) ? filmTimeS * ALOFT_FACTOR * CLOUD_TIMELAPSE : 0
  return { east: wind.east * t, north: wind.north * t }
}

type Vec3 = readonly [number, number, number]

/** Cube-sphere UV of an ECEF position, as sampled by the three-clouds shaders (`getCubeSphereUv`). */
export function cubeSphereUv(p: Vec3): [number, number] {
  const len = Math.hypot(p[0], p[1], p[2])
  const n = [p[0] / len, p[1] / len, p[2] / len]
  const f = n.map(Math.abs)
  const max = Math.max(f[0], f[1], f[2])
  const c = n.map((v) => v / max)
  let m: [number, number]
  if (f[1] > f[0] && f[1] > f[2]) m = c[1] > 0 ? [-n[0], n[2]] : [n[0], n[2]]
  else if (f[0] > f[1] && f[0] > f[2]) m = c[0] > 0 ? [n[1], n[2]] : [-n[1], n[2]]
  else m = c[2] > 0 ? [n[0], n[1]] : [n[0], -n[1]]
  const m2 = [m[0] * m[0], m[1] * m[1]]
  const q = -2 * m2[0] + 2 * m2[1] - 3
  const q2 = q * q
  const ux = Math.sqrt(Math.max(0, 1.5 + m2[0] - m2[1] - 0.5 * Math.sqrt(-24 * m2[0] + q2))) * (m[0] > 0 ? 1 : -1)
  const uy = Math.sqrt(6 / (3 - ux * ux)) * m[1]
  return [ux * 0.5 + 0.5, uy * 0.5 + 0.5]
}

/** Step of the finite differences of the UV Jacobian (metres). */
const JACOBIAN_STEP_M = 1000

/** UV change per metre towards east (first column) and north (second) at `origin` (ECEF): [[du/dE, du/dN], [dv/dE, dv/dN]]. */
function uvJacobian(origin: Vec3, east: Vec3, north: Vec3): [[number, number], [number, number]] {
  const at = (v: Vec3, s: number) => cubeSphereUv([origin[0] + v[0] * s, origin[1] + v[1] * s, origin[2] + v[2] * s])
  const e1 = at(east, JACOBIAN_STEP_M)
  const e0 = at(east, -JACOBIAN_STEP_M)
  const n1 = at(north, JACOBIAN_STEP_M)
  const n0 = at(north, -JACOBIAN_STEP_M)
  const s = 2 * JACOBIAN_STEP_M
  return [
    [(e1[0] - e0[0]) / s, (n1[0] - n0[0]) / s],
    [(e1[1] - e0[1]) / s, (n1[1] - n0[1]) / s],
  ]
}

/**
 * Offset of the local weather texture (`localWeatherOffset`, in tiles) that moves the cloud cover by `drift`
 * (metres east / north) around `origin` (ECEF), with `east` / `north` the ECEF unit vectors there and `repeat`
 * the tiles per cube face edge (`localWeatherRepeat`). The shader samples uv·repeat + offset, so the pattern
 * moves by D when offset = −J·D·repeat (J: UV Jacobian at the origin, linear in the drift).
 */
export function weatherOffsetFor(origin: Vec3, east: Vec3, north: Vec3, drift: Wind, repeat: number): [number, number] {
  const [[ue, un], [ve, vn]] = uvJacobian(origin, east, north)
  return [-(ue * drift.east + un * drift.north) * repeat, -(ve * drift.east + vn * drift.north) * repeat]
}

// ---------------------------------------------------------------------------
// Cover that varies over the scene
// ---------------------------------------------------------------------------

/** Texels per side of the cover field. The stations are ~10 km apart: smoother than this is not worth more. */
export const FIELD_SIZE = 32
/** The field spans the stations plus this margin, at least `FIELD_MIN_RADIUS_M` and at most `FIELD_MAX_RADIUS_M` (metres). */
const FIELD_MARGIN_M = 10_000
const FIELD_MIN_RADIUS_M = 20_000
const FIELD_MAX_RADIUS_M = 250_000
const EARTH_RADIUS_M = 6_371_008.8
const DEG = Math.PI / 180

/** Where the cover field is: the scene frame (`origin`, `east`, `north` in ECEF) and its place on the globe. */
export interface FieldFrame extends LonLat {
  origin: Vec3
  east: Vec3
  north: Vec3
}

/**
 * Cloud cover over the scene at one instant, as the coverage of each layer in a small texture of the cloud shaders
 * (patched `sampleWeather`, `scene/cloudShaders.ts`). Not drifted with the wind: the weather stays where its stations are.
 */
export interface CloudField {
  size: number
  /** RGBA bytes, row r from the lowest v, column c from the lowest u: coverage of the low, mid, high layer (255 = `MAX_COVERAGE`), then 0 */
  data: Uint8Array
  /** centre of the square the field spans in the cube-sphere UV of the shaders, and 1 / its width */
  centre: [number, number]
  invSpan: number
  /** the largest cover of each layer anywhere in the field */
  covers: CloudCovers
}

/**
 * Cover of the three layers over the scene: each station of the series gives its cover at `timeMs`
 * (`weatherAt`), blended over the field by inverse distance weighting (power 2, as between stations in `series.ts`),
 * then turned into the `coverage` of three-clouds per layer (`coverageFor`). The field is a square of the UV space
 * around the scene frame, wide enough for every station; outside it the shaders take the edge. A pure function of its
 * arguments: the export renders the same field as the preview. Null without station or without any cloud value.
 */
export function cloudCoverField(series: WeatherSeries, timeMs: number, frame: FieldFrame, size = FIELD_SIZE): CloudField | null {
  if (series.time.length === 0) return null
  const stations = series.stations.flatMap((station) => {
    const sample = weatherAt({ ...series, stations: [station] }, timeMs, station.lon, station.lat)
    const covers = sample && coversOf(sample)
    return covers ? [{ station, covers: [covers.low, covers.mid, covers.high] }] : []
  })
  if (stations.length === 0) return null
  const farthest = Math.max(...stations.map((s) => haversineM(frame, s.station)))
  const radius = clamp(farthest + FIELD_MARGIN_M, FIELD_MIN_RADIUS_M, FIELD_MAX_RADIUS_M)
  const [[ue, un], [ve, vn]] = uvJacobian(frame.origin, frame.east, frame.north)
  const halfUv = radius * Math.max(Math.hypot(ue, un), Math.hypot(ve, vn))
  const det = ue * vn - un * ve
  const data = new Uint8Array(size * size * 4)
  const max = [0, 0, 0]
  const metresPerLon = EARTH_RADIUS_M * Math.cos(frame.lat * DEG) * DEG
  const metresPerLat = EARTH_RADIUS_M * DEG
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // UV offset of the texel centre from the centre of the field, then metres towards east / north (inverse Jacobian)
      const du = ((col + 0.5) / size - 0.5) * 2 * halfUv
      const dv = ((row + 0.5) / size - 0.5) * 2 * halfUv
      const place = { lon: frame.lon + ((vn * du - un * dv) / det) / metresPerLon, lat: frame.lat + ((ue * dv - ve * du) / det) / metresPerLat }
      let wSum = 0
      const mixed = [0, 0, 0]
      for (const { station, covers } of stations) {
        const d = Math.max(MIN_STATION_DISTANCE_M, haversineM(place, station))
        const w = 1 / (d * d)
        wSum += w
        for (let i = 0; i < 3; i++) mixed[i] += covers[i] * w
      }
      for (let i = 0; i < 3; i++) {
        const cover = mixed[i] / wSum
        max[i] = Math.max(max[i], cover)
        const needed = cover < MIN_CLOUD_COVER ? 0 : coverageFor(i, cover)
        data[(row * size + col) * 4 + i] = Math.round((needed / MAX_COVERAGE) * 255)
      }
    }
  }
  return {
    size,
    data,
    centre: cubeSphereUv(frame.origin),
    invSpan: 1 / (2 * halfUv),
    covers: { low: max[0], mid: max[1], high: max[2] },
  }
}
