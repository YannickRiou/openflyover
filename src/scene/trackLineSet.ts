/**
 * The track lines drawn by `TrackLines`, as plain three.js objects: one Line2 per segment (and its glow) draped on the
 * terrain, their colours, styles and « trace qui se dessine » cut. No React here (the component is in TrackLines.tsx).
 *
 * Re-draping is cheap: each densified point stores its local position at height 0 and its local "up" vector, so it is
 * `base + up * height`. Buffers are updated in place when the point count is unchanged.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  SRGBColorSpace,
  Vector3,
  type InterleavedBufferAttribute,
  type MeshBasicMaterial,
  type ShaderMaterial,
} from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { LocalFrame, TerrainEngine, Track, TrackPoint } from '../core/types'
import {
  TRACK_METRICS,
  colorizeValues,
  resampleValues,
  metricRange,
  trackMetricValues,
  type TrackColorBy,
} from '../flyover/trackColor'
import { flightEase, flightOffsetAt, trackHeightM } from '../flyover/flights'
import { smoothPoints } from '../flyover/smooth'
import { raceAt } from '../flyover/race'
import type { Race } from '../flyover/race'
import type { Sequence } from '../flyover/sequence'
import { densify } from '../import/stats'
import { DEFAULT_TRACK_STYLE, TRACK_CURTAIN_RANGE } from './markerSettings'
import type { TrackStyle } from './markerSettings'
import { drapeRibbon } from './trackRibbon'
import type { RibbonLayer } from './trackRibbon'
import { cumulativeDistances } from '../geo/lonLat'
import {
  addTrailCut,
  applyDash,
  COMET_WIDTH_SHARE,
  createCurtainMaterial,
  createGlowMaterial,
  createShadowMaterial,
  CURTAIN_TOP_ALPHA,
  cutLine,
  lineWidthPx,
  NO_TRAIL,
  setFlightCut,
  setFlightWeights,
  setGlow,
  SHADOW_WIDTH_SHARE,
  setTrackDistances,
  setTrailStart,
  TRACK_GLOW_MAX_STRENGTH,
  TRAIL_FADE_SHARE,
  type CuttableLine,
} from './trackLineStyle'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default line width in CSS pixels (LineMaterial with worldUnits = false); `settings.trackStyle.width` sets it. */
export const LINE_WIDTH_PX = DEFAULT_TRACK_STYLE.width
/** Maximum spacing between consecutive points after densification (metres). */
export const DENSIFY_STEP_M = 10
/** Vertical lift above the (exaggerated) terrain so the line is never z-fighting with it (metres). */
export const LINE_LIFT_M = 3
/** The curtain of a flight starts this far above the terrain-exaggerated flight height, a little under the line (which is lifted by LINE_LIFT_M), so the two never fight for the depth (metres). */
export const CURTAIN_LIFT_M = 1
/**
 * Where a flight passes over itself (the turns of a thermal, a glide over an earlier one), the curtain stops on the pass
 * under it instead of falling through it to the ground: the turns read as a stack of bands. A pass is under a point when
 * one of its points is within this horizontal distance (metres), at least CURTAIN_STACK_GAP_M lower and at least
 * CURTAIN_STACK_ALONG_M away along the track (the neighbours on the same pass are not under it).
 */
export const CURTAIN_STACK_RADIUS_M = 30
export const CURTAIN_STACK_GAP_M = 10
export const CURTAIN_STACK_ALONG_M = 100
/** Delay between a terrain change and the re-drape (milliseconds). */
export const REDRAPE_DEBOUNCE_MS = 150
/**
 * While tiles stream in, the engine reports a change almost every frame; a trailing-only debounce would
 * leave the line at its recorded elevation (often under the relief) until loading pauses. This bounds the
 * wait: the line is re-draped at least this often during a burst of changes (milliseconds).
 */
export const REDRAPE_MAX_WAIT_MS = 600

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Terrain height sampler (metres, true scale) or undefined when unknown. */
export type HeightSampler = (lon: number, lat: number) => number | undefined

/**
 * Per-point data needed to drape a polyline on the terrain repeatedly:
 * `base` is the local position at ellipsoid height 0, `up` the local unit normal at that point, so the
 * local position at height h is `base + up * h` (exact, since lonLatToEcef is linear in h).
 */
export interface DrapeBuffer {
  count: number
  lon: Float64Array
  lat: Float64Array
  /** recorded elevation, NaN when the point has none */
  ele: Float32Array
  /** device offset of the flight the point is in (`flightOffsetAt`), NaN on the ground (the default) */
  flight: Float32Array
  /** xyz per point */
  base: Float64Array
  /** xyz per point */
  up: Float64Array
}

export function buildDrapeBuffer(points: readonly TrackPoint[], frame: LocalFrame): DrapeBuffer {
  const count = points.length
  const buffer: DrapeBuffer = {
    count,
    lon: new Float64Array(count),
    lat: new Float64Array(count),
    ele: new Float32Array(count),
    flight: new Float32Array(count).fill(Number.NaN),
    base: new Float64Array(count * 3),
    up: new Float64Array(count * 3),
  }
  const b = new Vector3()
  const u = new Vector3()
  for (let i = 0; i < count; i++) {
    const p = points[i]
    buffer.lon[i] = p.lon
    buffer.lat[i] = p.lat
    buffer.ele[i] = p.ele ?? Number.NaN
    frame.toLocal(p.lon, p.lat, 0, b)
    frame.toLocal(p.lon, p.lat, 1, u)
    const o = i * 3
    buffer.base[o] = b.x
    buffer.base[o + 1] = b.y
    buffer.base[o + 2] = b.z
    buffer.up[o] = u.x - b.x
    buffer.up[o + 1] = u.y - b.y
    buffer.up[o + 2] = u.z - b.z
  }
  return buffer
}

/**
 * Compute the draped local positions (xyz per point) into `out`:
 * height = `trackHeightM` (terrain ?? recorded elevation ?? 0, the recorded one in a flight) * exaggeration + LINE_LIFT_M.
 */
export function computeDrapedPositions(
  buffer: DrapeBuffer,
  sample: HeightSampler | null,
  exaggeration: number,
  out: Float32Array,
): Float32Array {
  const { count, lon, lat, ele, flight, base, up } = buffer
  for (let i = 0; i < count; i++) {
    const y = trackHeightM(sample?.(lon[i], lat[i]), ele[i], flight[i]) * exaggeration + LINE_LIFT_M
    const o = i * 3
    out[o] = base[o] + up[o] * y
    out[o + 1] = base[o + 1] + up[o + 1] * y
    out[o + 2] = base[o + 2] + up[o + 2] * y
  }
  return out
}

function isInterleavedAttribute(value: unknown): value is InterleavedBufferAttribute {
  return typeof value === 'object' && value !== null && (value as InterleavedBufferAttribute).isInterleavedBufferAttribute === true
}

/**
 * Write a polyline (xyz per point, at least 2 points) into a LineGeometry.
 * When the segment count is unchanged the existing interleaved buffer is updated in place (one upload,
 * no attribute re-creation); otherwise `setPositions` rebuilds the attributes.
 */
export function writeLinePositions(geometry: LineGeometry, positions: Float32Array): void {
  const pointCount = Math.floor(positions.length / 3)
  if (pointCount < 2) return
  const segmentCount = pointCount - 1
  const start: unknown = geometry.getAttribute('instanceStart')
  if (isInterleavedAttribute(start) && start.data.array.length === segmentCount * 6) {
    const array = start.data.array as Float32Array
    for (let i = 0; i < segmentCount; i++) {
      const o = i * 6
      const p = i * 3
      array[o] = positions[p]
      array[o + 1] = positions[p + 1]
      array[o + 2] = positions[p + 2]
      array[o + 3] = positions[p + 3]
      array[o + 4] = positions[p + 4]
      array[o + 5] = positions[p + 5]
    }
    start.data.needsUpdate = true
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return
  }
  geometry.setPositions(positions)
}

/**
 * Write per-point colours (rgb per point, linear) into a LineGeometry, in place when the colour buffer
 * already has the right size (same pair layout as the positions).
 */
export function writeLineColors(geometry: LineGeometry, colors: Float32Array): void {
  const pointCount = Math.floor(colors.length / 3)
  if (pointCount < 2) return
  const start: unknown = geometry.getAttribute('instanceColorStart')
  if (isInterleavedAttribute(start) && start.data.array.length === (pointCount - 1) * 6) {
    const array = start.data.array as Float32Array
    for (let i = 0; i < pointCount - 1; i++) {
      array.set(colors.subarray(i * 3, i * 3 + 6), i * 6)
    }
    start.data.needsUpdate = true
    return
  }
  geometry.setColors(colors)
}

// ---------------------------------------------------------------------------
// Flights: curtain and shadow
// ---------------------------------------------------------------------------

/** The stretches of consecutive points in a flight, as [first, count]; a lone point draws nothing. */
export function flightStretches(buffer: DrapeBuffer): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < buffer.count; i++) {
    if (Number.isNaN(buffer.flight[i])) continue
    const first = i
    while (i + 1 < buffer.count && !Number.isNaN(buffer.flight[i + 1])) i++
    if (i > first) out.push([first, i - first + 1])
  }
  return out
}

/** The two strips of a flight of `count` points starting at `first`; `dist` are the segment's point distances. */
function buildFlightPiece(first: number, count: number, dist: Float64Array, curtainMaterial: MeshBasicMaterial, shadowMaterial: ShaderMaterial): FlightPiece {
  // a quad between the vertex pairs (2k, 2k + 1) and (2k + 2, 2k + 3), shared by both strips
  const index: number[] = []
  for (let k = 0; k < count - 1; k++) index.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2)
  const trackM = new Float32Array(count * 2)
  const edge = new Float32Array(count * 2)
  for (let k = 0; k < count; k++) {
    trackM.fill(dist[first + k], 2 * k, 2 * k + 2)
    edge[2 * k] = -1
    edge[2 * k + 1] = 1
  }
  const curtain = new BufferGeometry()
  curtain.setAttribute('position', new BufferAttribute(new Float32Array(count * 6), 3))
  curtain.setAttribute('color', new BufferAttribute(new Float32Array(count * 8), 4))
  curtain.setAttribute('trackM', new BufferAttribute(trackM, 1))
  curtain.setIndex(index)
  const shadow = new BufferGeometry()
  shadow.setAttribute('position', new BufferAttribute(new Float32Array(count * 6), 3))
  shadow.setAttribute('ahead', new BufferAttribute(new Float32Array(count * 6), 3))
  shadow.setAttribute('edge', new BufferAttribute(edge, 1))
  shadow.setAttribute('trackM', new BufferAttribute(trackM.slice(), 1))
  shadow.setIndex(index)
  const piece: FlightPiece = { first, count, curtain: new Mesh(curtain, curtainMaterial), shadow: new Mesh(shadow, shadowMaterial) }
  piece.curtain.name = 'track-curtain'
  piece.curtain.renderOrder = 1
  piece.shadow.name = 'track-shadow'
  piece.shadow.renderOrder = 1
  setCurtainColors([piece], null)
  return piece
}

/**
 * For each point of `piece`, the top of the highest pass of the same flight under it (`CURTAIN_STACK_RADIUS_M`), -Infinity
 * where there is none. `tops`: the curtain's top at each point of the piece.
 */
export function passUnder(buffer: DrapeBuffer, piece: FlightPiece, tops: Float64Array): Float64Array {
  const { lon, lat } = buffer
  const trackM = piece.curtain.geometry.getAttribute('trackM') as BufferAttribute
  const metresPerLat = 111_320
  const metresPerLon = metresPerLat * Math.cos((lat[piece.first] * Math.PI) / 180)
  const cellOf = (k: number) => [Math.floor((lon[piece.first + k] * metresPerLon) / CURTAIN_STACK_RADIUS_M), Math.floor((lat[piece.first + k] * metresPerLat) / CURTAIN_STACK_RADIUS_M)]
  const cells = new Map<string, number[]>()
  for (let k = 0; k < piece.count; k++) {
    const key = cellOf(k).join(',')
    const list = cells.get(key)
    if (list) list.push(k)
    else cells.set(key, [k])
  }
  const under = new Float64Array(piece.count).fill(-Infinity)
  for (let k = 0; k < piece.count; k++) {
    const [cx, cy] = cellOf(k)
    const i = piece.first + k
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (!(tops[j] < tops[k] - CURTAIN_STACK_GAP_M) || tops[j] <= under[k]) continue
          if (Math.abs(trackM.getX(2 * j) - trackM.getX(2 * k)) < CURTAIN_STACK_ALONG_M) continue
          const east = (lon[piece.first + j] - lon[i]) * metresPerLon
          const north = (lat[piece.first + j] - lat[i]) * metresPerLat
          if (east * east + north * north <= CURTAIN_STACK_RADIUS_M * CURTAIN_STACK_RADIUS_M) under[k] = tops[j]
        }
      }
    }
  }
  return under
}

/**
 * Drape the curtain and the shadow of a flight: the curtain's top follows the flight (a little under the line), its
 * bottom and the shadow lie on the terrain (LINE_LIFT_M above it like the line, never above the flight); where the
 * terrain is not known yet they collapse onto the flight, and come down once its tiles load (the re-drape). The curtain
 * stops on a pass of the flight under it (`passUnder`) and falls `curtainM` metres at most (Infinity: to the ground).
 */
export function drapeFlightPiece(buffer: DrapeBuffer, piece: FlightPiece, sample: HeightSampler | null, exaggeration: number, curtainM = Infinity): void {
  const { lon, lat, ele, flight, base, up } = buffer
  const curtain = piece.curtain.geometry.getAttribute('position') as BufferAttribute
  const shadow = piece.shadow.geometry.getAttribute('position') as BufferAttribute
  const ahead = piece.shadow.geometry.getAttribute('ahead') as BufferAttribute
  const at = (i: number, height: number, out: BufferAttribute, v: number) =>
    out.setXYZ(v, base[i * 3] + up[i * 3] * height, base[i * 3 + 1] + up[i * 3 + 1] * height, base[i * 3 + 2] + up[i * 3 + 2] * height)
  const tops = new Float64Array(piece.count)
  const lows = new Float64Array(piece.count)
  for (let k = 0; k < piece.count; k++) {
    const i = piece.first + k
    const ground = sample?.(lon[i], lat[i])
    tops[k] = trackHeightM(ground, ele[i], flight[i]) * exaggeration + CURTAIN_LIFT_M
    lows[k] = ground === undefined || Number.isNaN(ground) ? tops[k] : Math.min(tops[k], ground * exaggeration + LINE_LIFT_M)
  }
  const under = passUnder(buffer, piece, tops)
  for (let k = 0; k < piece.count; k++) {
    const i = piece.first + k
    const bottom = Math.min(tops[k], Math.max(lows[k], under[k], tops[k] - curtainM))
    at(i, tops[k], curtain, 2 * k)
    at(i, bottom, curtain, 2 * k + 1)
    at(i, lows[k], shadow, 2 * k)
    at(i, lows[k], shadow, 2 * k + 1)
  }
  // direction of travel at each point, for the width of the shadow in the screen
  for (let k = 0; k < piece.count; k++) {
    const a = 2 * Math.max(0, k - 1)
    const b = 2 * Math.min(piece.count - 1, k + 1)
    for (let v = 2 * k; v < 2 * k + 2; v++) ahead.setXYZ(v, shadow.getX(b) - shadow.getX(a), shadow.getY(b) - shadow.getY(a), shadow.getZ(b) - shadow.getZ(a))
  }
  for (const attribute of [curtain, shadow, ahead]) attribute.needsUpdate = true
  piece.curtain.geometry.computeBoundingSphere()
  piece.shadow.geometry.computeBoundingSphere()
}

/**
 * Colour the curtains of `pieces` like the line: `colors` (linear rgb per point of the segment, null = white, the material
 * then carrying the track colour), opaque-ish at the line (CURTAIN_TOP_ALPHA) and transparent at the ground.
 */
export function setCurtainColors(pieces: readonly FlightPiece[], colors: Float32Array | null): void {
  for (const piece of pieces) {
    const attribute = piece.curtain.geometry.getAttribute('color') as BufferAttribute
    for (let k = 0; k < piece.count; k++) {
      const o = (piece.first + k) * 3
      const r = colors ? colors[o] : 1
      const g = colors ? colors[o + 1] : 1
      const b = colors ? colors[o + 2] : 1
      attribute.setXYZW(2 * k, r, g, b, CURTAIN_TOP_ALPHA)
      attribute.setXYZW(2 * k + 1, r, g, b, 0)
    }
    attribute.needsUpdate = true
  }
}

// ---------------------------------------------------------------------------
// Three.js object management (no React below this line except the component; exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * A flight of a segment: its consecutive points `first`..`first + count - 1`, the curtain falling from the line to the
 * relief and the shadow draped on it, both strips of two vertices per point (top and ground / left and right).
 */
export interface FlightPiece {
  first: number
  count: number
  curtain: Mesh<BufferGeometry, MeshBasicMaterial>
  shadow: Mesh<BufferGeometry, ShaderMaterial>
}

export interface SegmentLines extends CuttableLine {
  /** index in track.segments */
  index: number
  /** points densified from (the recorded ones, or their smoothed copies), kept in `points` as the same objects */
  source: TrackPoint[]
  /** densified points */
  points: TrackPoint[]
  buffer: DrapeBuffer
  /** scratch xyz per point, reused on every drape */
  positions: Float32Array
  geometry: LineGeometry
  solid: Line2
  /** wider soft halo, shown with `trackStyle.glow` */
  glow: Line2
  /** luminous trail behind the marker, shown with `trackStyle.comet` */
  comet: Line2
  /** the flights of the segment, none for a track on the ground */
  flights: FlightPiece[]
  /** the data ribbon (`trackRibbon.ts`), made when it is first shown */
  ribbon?: RibbonLayer
}

export interface TrackLineSet {
  track: Track
  frame: LocalFrame
  /** `trackStyle.smoothingM` the lines were built with */
  smoothingM: number
  object: Group
  segments: SegmentLines[]
  solidMaterial: LineMaterial
  glowMaterial: LineMaterial
  cometMaterial: LineMaterial
  curtainMaterial: MeshBasicMaterial
  /** the material of the data ribbons of the set: a curtain's, cut like the line */
  ribbonMaterial: MeshBasicMaterial
  shadowMaterial: ShaderMaterial
  /** distance the lines are drawn up to (Infinity = whole), NaN when it must be applied again (after a drape) */
  drawnM: number
  /** share of its colours the track is drawn with: 1, or less for an outing already drawn in a « Bilan » (`dimTrackLineSet`) */
  dim: number
}

function createLineMaterials(
  color: string,
  width: number,
  height: number,
): { solid: LineMaterial; glow: LineMaterial; comet: LineMaterial } {
  const solid = new LineMaterial({
    color: new Color(color),
    linewidth: LINE_WIDTH_PX,
    worldUnits: false,
  })
  solid.resolution.set(width, height)
  const glow = createGlowMaterial(new Color(color), width, height)
  // in the opaque pass (still MAX-blended), after the terrain and before the line: the line covers the glow under it
  glow.transparent = false
  // each track its own trail: the materials belong to its set
  addTrailCut(solid, 'track-line-trail')
  addTrailCut(glow, 'track-glow-trail')
  // a halo like the glow, cut to the stretch behind the marker (same program, own uniforms)
  const comet = createGlowMaterial(new Color(color), width, height)
  comet.transparent = false
  addTrailCut(comet, 'track-glow-trail')
  return { solid, glow, comet }
}

export function buildTrackLineSet(
  track: Track,
  frame: LocalFrame,
  width: number,
  height: number,
  smoothingM = 0,
): TrackLineSet {
  const object = new Group()
  object.name = `track:${track.id}`
  const materials = createLineMaterials(track.color, width, height)
  const curtainMaterial = createCurtainMaterial()
  const ribbonMaterial = createCurtainMaterial()
  const shadowMaterial = createShadowMaterial(width, height)

  const segments: SegmentLines[] = []
  /** distance at the start of the segment, as the marker counts it */
  let startM = 0
  for (const [index, segment] of track.segments.entries()) {
    const source = smoothPoints(segment.points, smoothingM)
    const points = densify(source, DENSIFY_STEP_M)
    if (points.length < 2) continue
    // recorded distances carried over to the densified points: the scale of the marker (`smoothedTrackPath`)
    const dist = resampleValues(source, cumulativeDistances(segment.points, startM), points)
    startM = dist[dist.length - 1]
    const buffer = buildDrapeBuffer(points, frame)
    for (let i = 0; i < buffer.count; i++) buffer.flight[i] = flightOffsetAt(track.flights, dist[i])
    const flights = flightStretches(buffer).map(([first, count]) => buildFlightPiece(first, count, dist, curtainMaterial, shadowMaterial))
    const positions = new Float32Array(buffer.count * 3)
    const geometry = new LineGeometry()
    setTrackDistances(geometry, dist)
    // the width follows the depth in the air, easing in and out at the ends of a flight
    if (flights.length > 0) setFlightWeights(geometry, Float32Array.from(dist, (d) => flightEase(track.flights, d)))
    const solid = new Line2(geometry, materials.solid)
    solid.name = 'track-line'
    solid.renderOrder = 2
    const glow = new Line2(geometry, materials.glow)
    glow.name = 'track-line-glow'
    glow.renderOrder = 1
    glow.visible = false
    const comet = new Line2(geometry, materials.comet)
    comet.name = 'track-line-comet'
    comet.renderOrder = 1
    comet.visible = false
    object.add(solid, glow, comet)
    for (const piece of flights) object.add(piece.curtain, piece.shadow)
    segments.push({ index, source, points, buffer, positions, dist, shortened: -1, geometry, solid, glow, comet, flights })
  }

  return {
    track,
    frame,
    smoothingM,
    object,
    segments,
    solidMaterial: materials.solid,
    glowMaterial: materials.glow,
    cometMaterial: materials.comet,
    curtainMaterial,
    ribbonMaterial,
    shadowMaterial,
    drawnM: Number.NaN,
    dim: 1,
  }
}

function materialsOf(set: TrackLineSet): LineMaterial[] {
  return [set.solidMaterial, set.glowMaterial, set.cometMaterial]
}

export function disposeTrackLineSet(set: TrackLineSet): void {
  set.object.removeFromParent()
  for (const segment of set.segments) {
    segment.geometry.dispose()
    for (const piece of segment.flights) {
      piece.curtain.geometry.dispose()
      piece.shadow.geometry.dispose()
    }
    segment.ribbon?.mesh.geometry.dispose()
  }
  for (const material of [...materialsOf(set), set.curtainMaterial, set.ribbonMaterial, set.shadowMaterial]) material.dispose()
}

/** `trailStartM` of the comet when it is off: past every distance along a track, so nothing is painted. */
const NO_COMET = 1e9

/** `drapeFlightPiece`'s `curtainM` for « Longueur du rideau »: its maximum is « Jusqu'au sol ». */
export const curtainLengthM = (flightCurtainM: number) => (flightCurtainM >= TRACK_CURTAIN_RANGE.max ? Infinity : flightCurtainM)

export function drapeTrackLineSet(set: TrackLineSet, engine: TerrainEngine | null, exaggeration: number, curtainM = Infinity): void {
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  for (const segment of set.segments) {
    computeDrapedPositions(segment.buffer, sampler, exaggeration, segment.positions)
    // rewrites every piece, the one shortened by the draw-on included
    writeLinePositions(segment.geometry, segment.positions)
    segment.shortened = -1
    if (segment.geometry.getAttribute('instanceDistanceStart')) segment.solid.computeLineDistances()
    for (const piece of segment.flights) drapeFlightPiece(segment.buffer, piece, sampler, exaggeration, curtainM)
    drapeRibbon(segment)
  }
  set.drawnM = Number.NaN
}

/**
 * Line colours divided by the renderer exposure. The lines are unlit: with the atmosphere the frame is
 * tone-mapped at a high exposure (physical radiances) and they would otherwise burn out to white.
 * `glowColor` ('#rrggbb') replaces the track colour (and its per-vertex colours) in the glow; '' keeps it.
 */
export function applyExposure(sets: Iterable<TrackLineSet>, exposure: number, glowColor = ''): void {
  for (const set of sets) {
    // with vertex colours the material colour is a plain multiplier
    const base = set.solidMaterial.vertexColors ? '#ffffff' : set.track.color
    set.solidMaterial.color.set(base).multiplyScalar(set.dim / exposure)
    const glowVertexColors = set.solidMaterial.vertexColors && glowColor === ''
    for (const material of [set.glowMaterial, set.cometMaterial]) {
      if (material.vertexColors !== glowVertexColors) {
        material.vertexColors = glowVertexColors
        material.needsUpdate = true
      }
      material.color.set(glowColor || base).multiplyScalar(set.dim / exposure)
    }
    // its vertex colours are white (the track colour is the material's) or the line's
    set.curtainMaterial.color.set(base).multiplyScalar(set.dim / exposure)
    // the ribbon is always in the colours of its metric
    set.ribbonMaterial.color.set('#ffffff').multiplyScalar(set.dim / exposure)
  }
}

/** Draw `set` in `dim` of its colours (1 = as it is), at once: a track already drawn in a « Bilan » is dimmer than the one being drawn. */
export function dimTrackLineSet(set: TrackLineSet, dim: number): void {
  if (set.dim === dim) return
  for (const material of [...materialsOf(set), set.curtainMaterial, set.ribbonMaterial]) material.color.multiplyScalar(dim / set.dim)
  set.dim = dim
}

function setVertexColors(set: TrackLineSet, enabled: boolean): void {
  for (const material of materialsOf(set)) {
    if (material.vertexColors === enabled) continue
    material.vertexColors = enabled
    material.needsUpdate = true
  }
}

/**
 * Colour every set by `colorBy` ('none' restores each track's own colour), with one value range shared
 * by all the tracks. Call `applyExposure` afterwards: the material colours depend on the mode.
 */
export function applyTrackColors(sets: Iterable<TrackLineSet>, colorBy: TrackColorBy): void {
  const list = [...sets]
  if (colorBy === 'none') {
    for (const set of list) {
      setVertexColors(set, false)
      for (const segment of set.segments) {
        segment.geometry.deleteAttribute('instanceColorStart')
        segment.geometry.deleteAttribute('instanceColorEnd')
        setCurtainColors(segment.flights, null)
      }
    }
    return
  }
  const values = list.map((set) => trackMetricValues(set.track, colorBy))
  const range = metricRange(values.flat(), colorBy) ?? { min: 0, max: 0 }
  const { colormap } = TRACK_METRICS[colorBy]
  const linear = new Color()
  list.forEach((set, k) => {
    for (const segment of set.segments) {
      const perPoint = resampleValues(segment.source, values[k][segment.index], segment.points)
      const colors = colorizeValues(perPoint, range, colormap)
      for (let o = 0; o < colors.length; o += 3) {
        linear.setRGB(colors[o], colors[o + 1], colors[o + 2], SRGBColorSpace)
        colors[o] = linear.r
        colors[o + 1] = linear.g
        colors[o + 2] = linear.b
      }
      writeLineColors(segment.geometry, colors)
      setCurtainColors(segment.flights, colors)
    }
    setVertexColors(set, true)
  })
}

export function applyResolution(sets: Iterable<TrackLineSet>, width: number, height: number): void {
  for (const set of sets) {
    for (const material of materialsOf(set)) material.resolution.set(width, height)
    set.shadowMaterial.uniforms.resolution.value.set(width, height)
  }
}

/** The distance from the camera at which a flight is drawn at the user's width (the camera's target): nearer is thicker. */
export function applyFlightDepth(sets: Iterable<TrackLineSet>, depthM: number): void {
  for (const set of sets) for (const material of materialsOf(set)) material.uniforms.flightDepthM.value = depthM
}

/**
 * Width, glow, dashes and flight extras of `style`. Widths are in pixels of the canvas times the export render scale, so a 4K
 * video looks like the 1080p one; `pixelSize` is the world length of a pixel for the dashes (`quantizedPixelSize`).
 */
export function applyTrackStyle(sets: Iterable<TrackLineSet>, style: TrackStyle, renderScale: number, pixelSize: number): void {
  for (const set of sets) {
    set.solidMaterial.linewidth = lineWidthPx(style, renderScale)
    set.glowMaterial.linewidth = lineWidthPx(style, renderScale, true)
    // the halo starts at the edge of the line
    setGlow(set.glowMaterial, style.glowIntensity * TRACK_GLOW_MAX_STRENGTH, Math.min(1, style.width / style.glowWidth))
    // the comet is wider and smooth: the halo of a dashed line is dashed, the comet is not
    set.cometMaterial.linewidth = style.width * COMET_WIDTH_SHARE * renderScale
    setGlow(set.cometMaterial, style.cometIntensity * TRACK_GLOW_MAX_STRENGTH, 1 / COMET_WIDTH_SHARE)
    for (const material of [set.solidMaterial, set.glowMaterial]) applyDash(material, style, renderScale, pixelSize)
    set.shadowMaterial.uniforms.widthPx.value = style.width * SHADOW_WIDTH_SHARE * renderScale
    for (const segment of set.segments) {
      segment.glow.visible = style.glow
      segment.comet.visible = style.comet && style.drawOn
      for (const piece of segment.flights) {
        piece.curtain.visible = style.flightCurtain
        piece.shadow.visible = style.flightShadow
      }
      // measured once draped (the drape keeps them up to date)
      const { geometry } = segment
      const measurable = geometry.getAttribute('instanceStart') && !geometry.getAttribute('instanceDistanceStart')
      if (style.dash !== 'plein' && measurable) segment.solid.computeLineDistances()
    }
  }
}

/**
 * Draw `set` up to `distanceM` along its track (Infinity = whole), over the last `trailM` metres only (« Traînée »,
 * Infinity = from the start), and the comet over the last `cometM` metres (0 = none). A track drawn whole stays whole.
 */
export function cutTrackLineSet(set: TrackLineSet, distanceM: number, trailM = Infinity, cometM = 0): void {
  // set even when the marker has not moved: the trail length may have changed while paused
  const trail = Number.isFinite(distanceM) && Number.isFinite(trailM)
  const startM = trail ? distanceM - trailM : NO_TRAIL
  const fadeM = trail ? trailM * TRAIL_FADE_SHARE : 0
  for (const material of [set.solidMaterial, set.glowMaterial]) setTrailStart(material, startM, fadeM)
  // the comet: the last `cometM` metres behind the marker, thinning out to nothing at its tail (0 or a track drawn whole: nothing)
  if (cometM > 0 && Number.isFinite(distanceM)) setTrailStart(set.cometMaterial, distanceM - cometM, cometM)
  else setTrailStart(set.cometMaterial, NO_COMET, 0)
  // the curtain and the shadow are cut per pixel, up to the marker too
  for (const material of [set.curtainMaterial, set.ribbonMaterial, set.shadowMaterial]) setFlightCut(material, startM, fadeM, distanceM)
  if (distanceM === set.drawnM) return
  for (const segment of set.segments) cutLine(segment, distanceM)
  set.drawnM = distanceM
}

/**
 * Distance each track is drawn up to with « trace qui se dessine »: the first track to its marker, the others to
 * their ghost racer when the race is on (`race` not null), else whole; « À la suite » (`sequence` not null), the
 * stages flown whole, the current one to the marker, the next ones not yet.
 */
export function drawOnDistances(tracks: readonly Track[], progress: number, race: Race | null, sequence: Sequence | null = null): number[] {
  if (sequence) return sequence.stages.map((s) => Math.max(0, progress * sequence.stages[sequence.stages.length - 1].endM - s.startM))
  const out = tracks.map(() => Infinity)
  if (tracks.length > 0) out[0] = progress * tracks[0].stats.distanceM
  if (race) for (const racer of raceAt(race, progress)) if (racer.index > 0) out[racer.index] = racer.distanceM
  return out
}

/**
 * Reconcile the Three objects with the store: keep sets whose points, frame and smoothing are unchanged (a recolour or
 * a rename only swaps their `track`: `applyExposure` reads its colour), rebuild the others, drop the ones whose track
 * disappeared. Returns the sets built, the ones to drape.
 */
export function syncTrackLineSets(
  group: Group,
  sets: Map<string, TrackLineSet>,
  tracks: readonly Track[],
  frame: LocalFrame | null,
  width: number,
  height: number,
  smoothingM = 0,
): TrackLineSet[] {
  const alive = new Set<string>()
  const built: TrackLineSet[] = []
  for (const track of tracks) {
    alive.add(track.id)
    const existing = sets.get(track.id)
    if (existing && existing.track.segments === track.segments && existing.frame === frame && existing.smoothingM === smoothingM) {
      existing.track = track
      continue
    }
    if (existing) {
      disposeTrackLineSet(existing)
      sets.delete(track.id)
    }
    if (!frame) continue
    const set = buildTrackLineSet(track, frame, width, height, smoothingM)
    group.add(set.object)
    sets.set(track.id, set)
    built.push(set)
  }
  for (const [id, set] of sets) {
    if (alive.has(id)) continue
    disposeTrackLineSet(set)
    sets.delete(id)
  }
  return built
}

