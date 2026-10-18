/**
 * The track lines drawn by `TrackLines`, as plain three.js objects: one Line2 per segment (and its glow) draped on the
 * terrain, their colours, styles and « trace qui se dessine » cut. No React here (the component is in TrackLines.tsx).
 *
 * Re-draping is cheap: each densified point stores its local position at height 0 and its local "up" vector, so it is
 * `base + up * height`. Buffers are updated in place when the point count is unchanged.
 */
import {
  Color,
  Group,
  SRGBColorSpace,
  Vector3,
  type InterleavedBufferAttribute,
} from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { LocalFrame, TerrainEngine, Track, TrackPoint } from '../core/types'
import {
  TRACK_METRICS,
  colorizeValues,
  resampleValues,
  robustRange,
  trackMetricValues,
  type TrackColorBy,
} from '../flyover/trackColor'
import { smoothPoints } from '../flyover/smooth'
import { raceAt } from '../flyover/race'
import type { Race } from '../flyover/race'
import type { Sequence } from '../flyover/sequence'
import { densify } from '../import/stats'
import { DEFAULT_TRACK_STYLE } from './markerSettings'
import type { TrackStyle } from './markerSettings'
import { cumulativeDistances } from '../geo/lonLat'
import {
  addTrailCut,
  applyDash,
  createGlowMaterial,
  cutLine,
  lineWidthPx,
  NO_TRAIL,
  setGlow,
  setTrackDistances,
  setTrailStart,
  TRACK_GLOW_MAX_STRENGTH,
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
 * height = (terrain ?? recorded elevation ?? 0) * exaggeration + LINE_LIFT_M.
 */
export function computeDrapedPositions(
  buffer: DrapeBuffer,
  sample: HeightSampler | null,
  exaggeration: number,
  out: Float32Array,
): Float32Array {
  const { count, lon, lat, ele, base, up } = buffer
  for (let i = 0; i < count; i++) {
    let h = sample ? sample(lon[i], lat[i]) : undefined
    if (h === undefined || Number.isNaN(h)) {
      const recorded = ele[i]
      h = Number.isNaN(recorded) ? 0 : recorded
    }
    const y = h * exaggeration + LINE_LIFT_M
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
// Three.js object management (no React below this line except the component; exported for unit tests)
// ---------------------------------------------------------------------------

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
  /** distance the lines are drawn up to (Infinity = whole), NaN when it must be applied again (after a drape) */
  drawnM: number
}

function createLineMaterials(
  color: string,
  width: number,
  height: number,
): { solid: LineMaterial; glow: LineMaterial } {
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
  return { solid, glow }
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
    const positions = new Float32Array(buffer.count * 3)
    const geometry = new LineGeometry()
    setTrackDistances(geometry, dist)
    const solid = new Line2(geometry, materials.solid)
    solid.name = 'track-line'
    solid.renderOrder = 2
    const glow = new Line2(geometry, materials.glow)
    glow.name = 'track-line-glow'
    glow.renderOrder = 1
    glow.visible = false
    object.add(solid, glow)
    segments.push({ index, source, points, buffer, positions, dist, shortened: -1, geometry, solid, glow })
  }

  return {
    track,
    frame,
    smoothingM,
    object,
    segments,
    solidMaterial: materials.solid,
    glowMaterial: materials.glow,
    drawnM: Number.NaN,
  }
}

function materialsOf(set: TrackLineSet): LineMaterial[] {
  return [set.solidMaterial, set.glowMaterial]
}

export function disposeTrackLineSet(set: TrackLineSet): void {
  set.object.removeFromParent()
  for (const segment of set.segments) segment.geometry.dispose()
  for (const material of materialsOf(set)) material.dispose()
}

export function drapeTrackLineSet(set: TrackLineSet, engine: TerrainEngine | null, exaggeration: number): void {
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  for (const segment of set.segments) {
    computeDrapedPositions(segment.buffer, sampler, exaggeration, segment.positions)
    // rewrites every piece, the one shortened by the draw-on included
    writeLinePositions(segment.geometry, segment.positions)
    segment.shortened = -1
    if (segment.geometry.getAttribute('instanceDistanceStart')) segment.solid.computeLineDistances()
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
    set.solidMaterial.color.set(base).multiplyScalar(1 / exposure)
    const glowVertexColors = set.solidMaterial.vertexColors && glowColor === ''
    if (set.glowMaterial.vertexColors !== glowVertexColors) {
      set.glowMaterial.vertexColors = glowVertexColors
      set.glowMaterial.needsUpdate = true
    }
    set.glowMaterial.color.set(glowColor || base).multiplyScalar(1 / exposure)
  }
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
      }
    }
    return
  }
  const values = list.map((set) => trackMetricValues(set.track, colorBy))
  const range = robustRange(values.flat()) ?? { min: 0, max: 0 }
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
    }
    setVertexColors(set, true)
  })
}

export function applyResolution(sets: Iterable<TrackLineSet>, width: number, height: number): void {
  for (const set of sets) for (const material of materialsOf(set)) material.resolution.set(width, height)
}

/**
 * Width, glow and dashes of `style`. Widths are in pixels of the canvas times the export render scale, so a 4K
 * video looks like the 1080p one; `pixelSize` is the world length of a pixel for the dashes (`quantizedPixelSize`).
 */
export function applyTrackStyle(sets: Iterable<TrackLineSet>, style: TrackStyle, renderScale: number, pixelSize: number): void {
  for (const set of sets) {
    set.solidMaterial.linewidth = lineWidthPx(style, renderScale)
    set.glowMaterial.linewidth = lineWidthPx(style, renderScale, true)
    // the halo starts at the edge of the line
    setGlow(set.glowMaterial, style.glowIntensity * TRACK_GLOW_MAX_STRENGTH, Math.min(1, style.width / style.glowWidth))
    for (const material of materialsOf(set)) applyDash(material, style, renderScale, pixelSize)
    for (const segment of set.segments) {
      segment.glow.visible = style.glow
      // measured once draped (the drape keeps them up to date)
      const { geometry } = segment
      const measurable = geometry.getAttribute('instanceStart') && !geometry.getAttribute('instanceDistanceStart')
      if (style.dash !== 'plein' && measurable) segment.solid.computeLineDistances()
    }
  }
}

/**
 * Draw `set` up to `distanceM` along its track (Infinity = whole), over the last `trailM` metres only (« Traînée »,
 * Infinity = from the start). A track drawn whole stays whole.
 */
export function cutTrackLineSet(set: TrackLineSet, distanceM: number, trailM = Infinity): void {
  // set even when the marker has not moved: the trail length may have changed while paused
  const startM = Number.isFinite(distanceM) && Number.isFinite(trailM) ? distanceM - trailM : NO_TRAIL
  for (const material of materialsOf(set)) setTrailStart(material, startM)
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
 * Reconcile the Three objects with the store: keep sets whose track, frame and smoothing are unchanged, rebuild
 * the others, drop the ones whose track disappeared.
 */
export function syncTrackLineSets(
  group: Group,
  sets: Map<string, TrackLineSet>,
  tracks: readonly Track[],
  frame: LocalFrame | null,
  width: number,
  height: number,
  smoothingM = 0,
): void {
  const alive = new Set<string>()
  for (const track of tracks) {
    alive.add(track.id)
    const existing = sets.get(track.id)
    if (existing && existing.track === track && existing.frame === frame && existing.smoothingM === smoothingM) continue
    if (existing) {
      disposeTrackLineSet(existing)
      sets.delete(track.id)
    }
    if (!frame) continue
    const set = buildTrackLineSet(track, frame, width, height, smoothingM)
    group.add(set.object)
    sets.set(track.id, set)
  }
  for (const [id, set] of sets) {
    if (alive.has(id)) continue
    disposeTrackLineSet(set)
    sets.delete(id)
  }
}

