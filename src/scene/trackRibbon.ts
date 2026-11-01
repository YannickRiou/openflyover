/**
 * « Ruban de données »: a translucent wall along each track whose height and colour follow one recorded quantity
 * (`settings.trackRibbon`). One strip per segment, two vertices per densified point: the bottom on the draped line, the
 * top above it by the value's share of `heightM`, and a thin, bright strip along that top edge (a third vertex under it). It reuses the curtain material of the flights (`createCurtainMaterial`:
 * vertex colours with alpha, cut at the marker and by the trail through the `trackM` attribute), so the draw-on shows it
 * as it shows the line. The values and colours are made once per metric; the heights and the drape follow the settings
 * and the terrain. Three.js only, no React.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, SRGBColorSpace } from 'three'
import { colorizeValues, metricRange, resampleValues, TRACK_METRICS, trackMetricValues } from '../flyover/trackColor'
import type { TrackMetric, ValueRange } from '../flyover/trackColor'
import type { TrackRibbonSettings } from './markerSettings'
import type { SegmentLines, TrackLineSet } from './trackLineSet'

/** Opacity of the wall at its top edge, and at the line. */
export const RIBBON_TOP_ALPHA = 0.85
export const RIBBON_FOOT_ALPHA = 0.3
/** Share of `heightM` the lowest value stands at: the wall never vanishes where the value is low. */
export const RIBBON_MIN_SHARE = 0.04
/** The edge line along the top of the wall: its thickness, as a share of `heightM` (at least `RIBBON_EDGE_MIN_M`), and how far its colour goes towards white. */
export const RIBBON_EDGE_SHARE = 0.05
export const RIBBON_EDGE_MIN_M = 2
export const RIBBON_EDGE_LIGHTEN = 0.45

/** What a segment keeps of its ribbon. */
export interface RibbonLayer {
  mesh: Mesh
  /** the metric the colours and fractions were made for */
  metric: TrackMetric
  /** value of each densified point within the shared range, 0..1; NaN where unknown */
  fractions: Float32Array
  heightM: number
}

/** Share of the range (0..1) of each value, NaN kept; the middle of a range with no spread. */
export function ribbonFractions(values: ArrayLike<number>, range: ValueRange | null): Float32Array {
  const out = new Float32Array(values.length)
  const spread = range ? range.max - range.min : 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out[i] = Number.isNaN(v) || !range ? Number.NaN : spread > 0 ? Math.min(1, Math.max(0, (v - range.min) / spread)) : 0.5
  }
  return out
}

/** Height of the wall (metres) for a fraction of the range: the minimum share at 0, `heightM` at 1; 0 where the value is unknown. */
export const ribbonHeightM = (fraction: number, heightM: number) =>
  Number.isNaN(fraction) ? 0 : heightM * (RIBBON_MIN_SHARE + (1 - RIBBON_MIN_SHARE) * fraction)

function createRibbonMesh(set: TrackLineSet, segment: SegmentLines): Mesh {
  const count = segment.points.length
  const index: number[] = []
  // per point: the foot (3k), the bottom of the edge strip (3k + 1), the top (3k + 2); the wall between the first two, the edge between the last two
  for (let k = 0; k < count - 1; k++) {
    for (const [a, b] of [[0, 1], [1, 2]]) index.push(3 * k + a, 3 * k + b, 3 * k + 3 + a, 3 * k + b, 3 * k + 3 + b, 3 * k + 3 + a)
  }
  const trackM = new Float32Array(count * 3)
  for (let k = 0; k < count; k++) trackM.fill(segment.dist[k], 3 * k, 3 * k + 3)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 9), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 12), 4))
  geometry.setAttribute('trackM', new BufferAttribute(trackM, 1))
  geometry.setIndex(index)
  const mesh = new Mesh(geometry, set.ribbonMaterial)
  mesh.name = 'track-ribbon'
  mesh.renderOrder = 1
  set.object.add(mesh)
  return mesh
}

/** Write the top and bottom of the wall from the draped line (`segment.positions`) and the fractions. */
export function drapeRibbon(segment: SegmentLines): void {
  const layer = segment.ribbon
  if (!layer) return
  const position = layer.mesh.geometry.getAttribute('position') as BufferAttribute
  const { positions, buffer } = segment
  const { up } = buffer
  for (let k = 0; k < layer.fractions.length; k++) {
    const h = ribbonHeightM(layer.fractions[k], layer.heightM)
    const edge = Math.min(h, Math.max(RIBBON_EDGE_MIN_M, RIBBON_EDGE_SHARE * layer.heightM))
    const o = k * 3
    position.setXYZ(3 * k, positions[o], positions[o + 1], positions[o + 2])
    position.setXYZ(3 * k + 1, positions[o] + up[o] * (h - edge), positions[o + 1] + up[o + 1] * (h - edge), positions[o + 2] + up[o + 2] * (h - edge))
    position.setXYZ(3 * k + 2, positions[o] + up[o] * h, positions[o + 1] + up[o + 1] * h, positions[o + 2] + up[o + 2] * h)
  }
  position.needsUpdate = true
  layer.mesh.geometry.computeBoundingSphere()
}

/** Colour the wall by `metric` over `range`: the colormap of the metric, opaque at the top, fading towards the line, with a lighter opaque edge strip; clear where the value is unknown. */
function colorRibbon(layer: RibbonLayer, perPoint: Float64Array, range: ValueRange | null): void {
  const colors = colorizeValues(perPoint, range ?? { min: 0, max: 0 }, TRACK_METRICS[layer.metric].colormap)
  const attribute = layer.mesh.geometry.getAttribute('color') as BufferAttribute
  const linear = new Color()
  for (let k = 0; k < perPoint.length; k++) {
    linear.setRGB(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2], SRGBColorSpace)
    const known = !Number.isNaN(perPoint[k])
    attribute.setXYZW(3 * k, linear.r, linear.g, linear.b, known ? RIBBON_FOOT_ALPHA : 0)
    attribute.setXYZW(3 * k + 1, linear.r, linear.g, linear.b, known ? RIBBON_TOP_ALPHA : 0)
    // the edge: the same colour lightened, opaque
    attribute.setXYZW(
      3 * k + 2,
      linear.r + (1 - linear.r) * RIBBON_EDGE_LIGHTEN,
      linear.g + (1 - linear.g) * RIBBON_EDGE_LIGHTEN,
      linear.b + (1 - linear.b) * RIBBON_EDGE_LIGHTEN,
      known ? 1 : 0,
    )
  }
  attribute.needsUpdate = true
}

/**
 * Show, hide or update the ribbons of `sets` for `settings`. A new metric (or a new set of lines) recomputes the values,
 * the range shared by the tracks and the colours; a new height only moves the top edge.
 */
export function applyTrackRibbon(sets: Iterable<TrackLineSet>, settings: TrackRibbonSettings): void {
  const list = [...sets]
  if (!settings.enabled) {
    for (const set of list) for (const segment of set.segments) if (segment.ribbon) segment.ribbon.mesh.visible = false
    return
  }
  const stale = list.some((set) => set.segments.some((segment) => !segment.ribbon || segment.ribbon.metric !== settings.metric))
  const values = stale ? list.map((set) => trackMetricValues(set.track, settings.metric)) : []
  const range = stale ? metricRange(values.flat(), settings.metric) : null
  list.forEach((set, k) => {
    for (const segment of set.segments) {
      let layer = segment.ribbon
      if (!layer || layer.metric !== settings.metric) {
        const perPoint = resampleValues(segment.source, values[k][segment.index], segment.points)
        layer = {
          mesh: layer?.mesh ?? createRibbonMesh(set, segment),
          metric: settings.metric,
          fractions: ribbonFractions(perPoint, range),
          heightM: settings.heightM,
        }
        segment.ribbon = layer
        colorRibbon(layer, perPoint, range)
      }
      layer.mesh.visible = true
      layer.heightM = settings.heightM
      drapeRibbon(segment)
    }
  })
}
