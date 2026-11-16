/**
 * Prototypes of the track's look (« labo », branch only): active with `?labo-trace=1,3,4,5,6,7` in the address, and
 * switched at run time with `window.__laboTrace([…])` so the same frame can be rendered with and without each one.
 * 1 width in perspective, 3 dark casing, 4 lit by the scene (shade of the relief, veil with the distance), 5 pulses
 * running along the track, 6 the rest of the route ghosted ahead of the marker, 7 the steepest climb highlighted.
 * Without the parameter nothing here is built and the shader terms stay neutral.
 */
import { Color, Vector3 } from 'three'
import type { Camera, DirectionalLight, Object3D, Scene, WebGLRenderer } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three'
import type { TerrainEngine } from '../core/types'
import { useAppStore } from '../state/store'
import type { SegmentLines, TrackLineSet } from './trackLineSet'
import { addTrailCut, createGlowMaterial, setGlow, setFlightWeights, NO_TRAIL } from './trackLineStyle'

const param = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('labo-trace')
/** The prototypes are built (the parameter is in the address). */
export const LABO = param !== null
let active = new Set((param ?? '').split(',').map(Number).filter((n) => n > 0))
const on = (id: number) => active.has(id)
let wake: (() => void) | null = null
if (LABO && typeof window !== 'undefined') {
  ;(window as unknown as { __laboTrace: (ids: number[]) => void }).__laboTrace = (ids) => {
    active = new Set(ids)
    wake?.()
  }
  // for the captures of the prototypes (scratch scripts): the app's store
  ;(window as unknown as { __store: typeof useAppStore }).__store = useAppStore
}

const CASING = new Color('#0e171c')
const GHOST = new Color('#ffffff')
const HOT = new Color('#ffc233')
/** width in perspective: the bounds of the factor (the flights keep 0.6 to 1.6) */
const WIDTH_MIN = 0.3
const WIDTH_MAX = 2.8
/** the climb highlighted: the steepest stretch of this length */
const HOT_LENGTH_M = 400

interface LaboSegment {
  casing: Line2
  ghost: Line2
  ghostGeometry: LineGeometry
  hot: Line2
  hotGlow: Line2
  /** the flight weights built with the line, put back when « 1 » is off */
  weights: Float32Array
}

interface Labo {
  casing: LineMaterial
  ghost: LineMaterial
  hot: LineMaterial
  hotGlow: LineMaterial
  segments: LaboSegment[]
  hotRange: { fromM: number; toM: number } | null
  /** sun direction and drape the shade was computed for */
  shadeKey: string
  drapes: number
  perspective: boolean | null
}

const labos = new WeakMap<TrackLineSet, Labo>()

const LINKED = ['instanceStart', 'instanceEnd', 'instanceColorStart', 'instanceColorEnd', 'instanceTrackStart', 'instanceTrackEnd', 'instanceFlightStart', 'instanceFlightEnd', 'instanceShadeStart', 'instanceShadeEnd']

function weightsOf(segment: SegmentLines): Float32Array {
  const attribute = segment.geometry.getAttribute('instanceFlightStart') as InterleavedBufferAttribute | undefined
  const count = segment.dist.length
  const out = new Float32Array(count)
  if (!attribute) return out
  for (let i = 0; i < count - 1; i++) out[i] = attribute.getX(i)
  out[count - 1] = out[count - 2] ?? 0
  return out
}

function setShade(segment: SegmentLines, shade: Float32Array): void {
  const pieces = shade.length - 1
  const array = new Float32Array(Math.max(0, pieces) * 2)
  for (let i = 0; i < pieces; i++) {
    array[i * 2] = shade[i]
    array[i * 2 + 1] = shade[i + 1]
  }
  const buffer = new InstancedInterleavedBuffer(array, 2, 1)
  segment.geometry.setAttribute('instanceShadeStart', new InterleavedBufferAttribute(buffer, 1, 0))
  segment.geometry.setAttribute('instanceShadeEnd', new InterleavedBufferAttribute(buffer, 1, 1))
}

/** The extra lines of the prototypes, beside the set's own (same geometry, but the ghost's own, uncut). */
export function buildLabo(set: TrackLineSet, width: number, height: number): void {
  const material = (color: Color, key: string, extra: Partial<LineMaterial> = {}) => {
    const m = new LineMaterial({ color, worldUnits: false, ...extra })
    m.resolution.set(width, height)
    addTrailCut(m, key)
    return m
  }
  // no depth write: the track drawn after it at the same depth stays on top (no fighting between the two)
  const casing = material(CASING, 'labo-casing', { depthWrite: false })
  const ghost = material(GHOST, 'labo-ghost', { transparent: true, opacity: 0.75, depthWrite: false, dashed: true, dashScale: 1, dashSize: 6, gapSize: 12 })
  const hot = material(HOT, 'labo-hot')
  const hotGlow = createGlowMaterial(HOT, width, height)
  hotGlow.transparent = false
  addTrailCut(hotGlow, 'track-glow-trail')
  const segments = set.segments.map((segment) => {
    const make = (geometry: LineGeometry, m: LineMaterial, order: number, name: string) => {
      const line = new Line2(geometry, m)
      line.name = name
      line.renderOrder = order
      line.visible = false
      line.frustumCulled = false
      set.object.add(line)
      return line
    }
    const ghostGeometry = new LineGeometry()
    setShade(segment, new Float32Array(segment.dist.length).fill(1))
    return {
      casing: make(segment.geometry, casing, 1.5, 'labo-casing'),
      ghost: make(ghostGeometry, ghost, 1.6, 'labo-ghost'),
      ghostGeometry,
      hot: make(segment.geometry, hot, 2.5, 'labo-hot'),
      hotGlow: make(segment.geometry, hotGlow, 1.2, 'labo-hot-glow'),
      weights: weightsOf(segment),
    }
  })
  labos.set(set, { casing, ghost, hot, hotGlow, segments, hotRange: steepest(set), shadeKey: '', drapes: 0, perspective: null })
}

/** After a drape: the ghost's geometry takes the new pieces again, and the shade must be computed again. */
export function drapeLabo(set: TrackLineSet): void {
  const labo = labos.get(set)
  if (!labo) return
  labo.drapes++
  for (const [k, segment] of set.segments.entries()) {
    const { ghostGeometry, ghost } = labo.segments[k]
    for (const name of LINKED) {
      const attribute = segment.geometry.getAttribute(name)
      if (attribute) ghostGeometry.setAttribute(name, attribute)
    }
    ghostGeometry.deleteAttribute('instanceDistanceStart')
    ghostGeometry.deleteAttribute('instanceDistanceEnd')
    if (ghostGeometry.getAttribute('instanceStart')) ghost.computeLineDistances()
  }
}

export function disposeLabo(set: TrackLineSet): void {
  const labo = labos.get(set)
  if (!labo) return
  for (const s of labo.segments) s.ghostGeometry.dispose()
  for (const m of [labo.casing, labo.ghost, labo.hot, labo.hotGlow]) m.dispose()
}

/** The steepest climb of `HOT_LENGTH_M` along the track (recorded elevations), null without them. */
function steepest(set: TrackLineSet): { fromM: number; toM: number } | null {
  let best = 0
  let range: { fromM: number; toM: number } | null = null
  for (const segment of set.segments) {
    const { dist } = segment
    const ele = segment.buffer.ele
    let j = 0
    for (let i = 0; i < dist.length; i++) {
      while (j < dist.length - 1 && dist[j] - dist[i] < HOT_LENGTH_M) j++
      if (dist[j] - dist[i] < HOT_LENGTH_M * 0.9 || !Number.isFinite(ele[i]) || !Number.isFinite(ele[j])) continue
      const gain = ele[j] - ele[i]
      if (gain > best) {
        best = gain
        range = { fromM: dist[i], toM: dist[j] }
      }
    }
  }
  return range
}

const _sun = new Vector3()
const _target = new Vector3()
const _p = new Vector3()

function sunDirection(scene: Scene): Vector3 | null {
  let light: DirectionalLight | null = null
  scene.traverse((o: Object3D) => {
    const d = o as DirectionalLight
    if (d.isDirectionalLight && (!light || d.castShadow)) light = d
  })
  if (!light) return null
  const l = light as DirectionalLight
  l.getWorldPosition(_sun)
  l.target.getWorldPosition(_target)
  return _sun.sub(_target).normalize()
}

/**
 * Shade of each point (1 in the sun, 0.45 in the shade of the relief): a ray towards the sun over 4 km, the line in the
 * shade when the exaggerated relief rises above it; smoothed over a few points so the edge of a shadow is soft.
 */
function computeShade(set: TrackLineSet, engine: TerrainEngine, exaggeration: number, sun: Vector3): void {
  const frame = set.frame
  for (const segment of set.segments) {
    const { buffer } = segment
    const raw = new Float32Array(buffer.count)
    for (let i = 0; i < buffer.count; i++) {
      const ground = engine.sampleHeight(buffer.lon[i], buffer.lat[i])
      if (ground === undefined) {
        raw[i] = 1
        continue
      }
      const start = frame.toLocal(buffer.lon[i], buffer.lat[i], ground * exaggeration + 3)
      let lit = 1
      for (let d = 60; d <= 4000; d *= 1.18) {
        _p.copy(sun).multiplyScalar(d).add(start)
        const at = frame.toLonLat(_p)
        const h = engine.sampleHeight(at.lon, at.lat)
        if (h !== undefined && h * exaggeration > at.height) {
          lit = 0.45
          break
        }
      }
      raw[i] = lit
    }
    const smooth = new Float32Array(buffer.count)
    for (let i = 0; i < buffer.count; i++) {
      let s = 0
      let n = 0
      for (let k = Math.max(0, i - 3); k <= Math.min(buffer.count - 1, i + 3); k++) {
        s += raw[k]
        n++
      }
      smooth[i] = s / n
    }
    setShade(segment, smooth)
  }
}

export interface LaboFrame {
  gl: WebGLRenderer
  scene: Scene
  camera: Camera
  engine: TerrainEngine | null
  exaggeration: number
  invalidate: () => void
}

/** Every frame: what is on, widths and colours from the set's own lines, the cuts, the shade, the pulses. */
export function updateLabo(sets: Iterable<TrackLineSet>, frame: LaboFrame): void {
  wake = frame.invalidate
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __labo: unknown }).__labo = { invalidate: frame.invalidate, canvas: frame.gl.domElement }
  }
  const exposure = frame.gl.toneMappingExposure || 1
  const sun = on(4) ? sunDirection(frame.scene) : null
  for (const set of sets) {
    const labo = labos.get(set)
    if (!labo) continue
    const solid = set.solidMaterial
    const glow = set.glowMaterial
    const all = [solid, glow, labo.casing, labo.hot, labo.hotGlow, labo.ghost]
    // 1. width in perspective: every piece follows the depth, within wider bounds than a flight's
    const perspective = on(1)
    if (labo.perspective !== perspective) {
      labo.perspective = perspective
      for (const [k, segment] of set.segments.entries()) {
        setFlightWeights(segment.geometry, perspective ? new Float32Array(segment.dist.length).fill(1) : labo.segments[k].weights)
      }
      drapeLabo(set)
    }
    for (const m of all) {
      m.uniforms.widthMin.value = perspective ? WIDTH_MIN : 0.6
      m.uniforms.widthMax.value = perspective ? WIDTH_MAX : 1.6
      m.uniforms.flightDepthM.value = solid.uniforms.flightDepthM.value
    }
    // 3. casing: a dark line a little wider than the track, under it
    labo.casing.linewidth = solid.linewidth + 3.2
    labo.casing.color.copy(CASING)
    for (const s of labo.segments) s.casing.visible = on(3)
    // cut like the line (trail)
    for (const m of [labo.casing, labo.hot, labo.hotGlow]) {
      if (m === labo.hot || m === labo.hotGlow) continue
      m.uniforms.trailStartM.value = solid.uniforms.trailStartM.value
      m.uniforms.trailFadeM.value = solid.uniforms.trailFadeM.value
    }
    // 4. lit by the scene: the shade of the relief and a veil with the distance, on the line and its halo
    if (on(4) && sun && frame.engine) {
      const key = `${sun.x.toFixed(2)},${sun.y.toFixed(2)},${sun.z.toFixed(2)}:${labo.drapes}`
      if (key !== labo.shadeKey) {
        labo.shadeKey = key
        computeShade(set, frame.engine, frame.exaggeration, sun)
        drapeLabo(set)
      }
    }
    for (const m of [solid, glow, labo.casing]) {
      m.uniforms.shadeOn.value = on(4) ? 1 : 0
      m.uniforms.veilAmount.value = on(4) ? 0.5 : 0
      m.uniforms.veilScaleM.value = 4500
    }
    // 5. pulses running along the track, in the direction of travel
    solid.uniforms.pulseStrength.value = on(5) ? 0.6 : 0
    solid.uniforms.pulseSpacingM.value = 220
    solid.uniforms.pulsePhaseM.value = on(5) ? (performance.now() / 1000) * 90 : 0
    if (on(5)) frame.invalidate()
    // 6. the rest of the route, ghosted: from the marker on, only while the track draws itself
    const drawing = Number.isFinite(set.drawnM)
    labo.ghost.linewidth = Math.max(1.5, solid.linewidth * 0.6)
    labo.ghost.color.copy(GHOST).multiplyScalar(1 / exposure)
    labo.ghost.uniforms.trailStartM.value = drawing ? set.drawnM : NO_TRAIL
    for (const s of labo.segments) s.ghost.visible = on(6) && drawing
    // 7. the steepest climb, golden and wider, with its own halo
    const range = labo.hotRange
    labo.hot.linewidth = solid.linewidth * 1.5
    labo.hot.color.copy(HOT).multiplyScalar(1 / exposure)
    labo.hotGlow.linewidth = glow.linewidth * 1.3
    labo.hotGlow.color.copy(HOT).multiplyScalar(1 / exposure)
    setGlow(labo.hotGlow, 0.9, Math.min(1, labo.hot.linewidth / labo.hotGlow.linewidth))
    for (const m of [labo.hot, labo.hotGlow]) {
      m.uniforms.trailStartM.value = range ? range.fromM : NO_TRAIL
      m.uniforms.trackEndM.value = range ? range.toM : -1
    }
    for (const s of labo.segments) {
      s.hot.visible = on(7) && range !== null
      s.hotGlow.visible = on(7) && range !== null
    }
    for (const m of all) m.resolution.copy(solid.resolution)
  }
}
