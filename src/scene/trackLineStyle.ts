/**
 * Style of the track lines (`settings.trackStyle`) for TrackLines: the glow material, the dash pattern and its scale,
 * and the « trace qui se dessine » cut. Three.js only, no React.
 *
 * Dashes: LineMaterial measures them in world units. To keep them a few pixels long whatever the zoom, the scale
 * follows the camera distance rounded to a power of two: the dashes stay put on the ground while the camera flies.
 * Draw-on: each segment draws its pieces up to the marker (`instanceCount`) and the last one is shortened by moving its
 * end vertex in the shared buffer (restored afterwards). The distance comes from the playback progress, so the preview
 * and the export draw the same line. The trail (« Traînée ») hides the start the other way: the painting step skips
 * what lies before a distance (`addTrailCut`), since the pieces drawn always start at the first, and its oldest part
 * thins out to nothing instead of ending on a sharp cut.
 *
 * Flights (stretches recorded in the air, `flyover/flights.ts`) add three things: the line's width follows its depth
 * there (patched in by `addTrailCut`), a translucent curtain falls from the line to the relief, and a soft shadow is
 * draped on the ground under it (their materials are at the end of this file, the meshes are built in `trackLineSet.ts`).
 */
import {
  CustomBlending,
  DoubleSide,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  MaxEquation,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { Camera, Color, Vector3 } from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import type { TrackDash, TrackStyle } from './markerSettings'

/** Dash and gap of the patterns, in line widths. */
export const DASH_PATTERNS: Record<Exclude<TrackDash, 'plein'>, { dash: number; gap: number }> = {
  tirets: { dash: 3, gap: 2 },
  points: { dash: 1, gap: 1.5 },
}
/** Default strength of a glow at its centre (times its colour), fading to 0 at its edge. */
export const GLOW_STRENGTH = 0.55
/**
 * Strength of the track glow at « Intensité du halo » 100 %: below 1, so the glow stays dimmer than the line it borders
 * and the line keeps a clear edge instead of merging with its glow into a wider line.
 */
export const TRACK_GLOW_MAX_STRENGTH = 0.8
/** Width of the comet (« Comète »), in line widths. */
export const COMET_WIDTH_SHARE = 6

// ---------------------------------------------------------------------------
// Glow
// ---------------------------------------------------------------------------

const FRAGMENT_OUTPUT = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'
/**
 * Gaussian fade from `glowInner` (the edge of the line drawn over it, as a fraction of the half-width; 0 = the centre)
 * to 0 at the edge (`vUv.x` across the line, `vUv.y` beyond ±1 in the round caps); nothing inside, so the line keeps
 * its colour. The gaussian, shifted to reach 0 at the edge, reads as light rather than as a band. Written with MAX
 * blending: where neighbouring pieces overlap at a joint the result does not add up into beads (nor into an opaque
 * line far away), and the glow lightens dark ground with the track colour.
 */
const GLOW_OUTPUT = `
  float glowR = abs( vUv.y ) > 1.0 ? length( vec2( vUv.x, abs( vUv.y ) - 1.0 ) ) : abs( vUv.x );
  float glowX = clamp( ( glowR - glowInner ) / max( 1.0 - glowInner, 1e-3 ), 0.0, 1.0 );
  float glowFade = glowR < glowInner ? 0.0 : ( exp( -4.0 * glowX * glowX ) - exp( -4.0 ) ) / ( 1.0 - exp( -4.0 ) );
  gl_FragColor = vec4( diffuseColor.rgb * glowFade * glowStrength, 1.0 );
`

export function createGlowMaterial(color: Color, width: number, height: number): LineMaterial {
  const material = new LineMaterial({
    color,
    worldUnits: false,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: MaxEquation,
  })
  material.resolution.set(width, height)
  // set with `setGlow`
  material.uniforms.glowStrength = { value: GLOW_STRENGTH }
  material.uniforms.glowInner = { value: 0 }
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `uniform float glowStrength;\nuniform float glowInner;\n${shader.fragmentShader.replace(FRAGMENT_OUTPUT, GLOW_OUTPUT)}`
  }
  // a different program than the plain line material, whose source is the same before the patch
  material.customProgramCacheKey = () => 'track-glow'
  return material
}

// ---------------------------------------------------------------------------
// Width and dashes
// ---------------------------------------------------------------------------

/** Strength of a glow material where it starts, and the part of its half-width covered by the line (0..1). */
export function setGlow(material: LineMaterial, strength: number, inner: number): void {
  material.uniforms.glowStrength.value = strength
  material.uniforms.glowInner.value = inner
}

/** Width in canvas pixels of the line, or of its glow, for this style. */
export function lineWidthPx(style: TrackStyle, renderScale: number, glow = false): number {
  return (glow ? style.glowWidth : style.width) * renderScale
}

/**
 * World length of one pixel at `distance` from a perspective camera (viewport `heightPx` tall), rounded to a
 * power of two so that the dash pattern does not crawl along the line while the camera moves.
 */
export function quantizedPixelSize(distance: number, camera: Camera, heightPx: number): number {
  const pixel = (2 * distance) / (camera.projectionMatrix.elements[5] * Math.max(1, heightPx))
  return 2 ** Math.round(Math.log2(Math.max(pixel, 1e-6)))
}

/**
 * Dash settings of a line material: off for 'plein'; otherwise the pattern in pixels of a `pixelSize` world
 * length (`quantizedPixelSize`). Changing `dashed` recompiles the material, so it is only set when it changes.
 */
export function applyDash(material: LineMaterial, style: TrackStyle, renderScale: number, pixelSize: number): void {
  const dashed = style.dash !== 'plein'
  if (material.dashed !== dashed) {
    material.dashed = dashed
    material.needsUpdate = true
  }
  if (style.dash === 'plein') return
  const { dash, gap } = DASH_PATTERNS[style.dash]
  const px = style.width * renderScale
  material.dashScale = 1 / pixelSize
  material.dashSize = dash * px
  material.gapSize = gap * px
}

// ---------------------------------------------------------------------------
// Draw-on
// ---------------------------------------------------------------------------

/**
 * Pieces of a polyline (`dist` per point) drawn up to `distanceM`: `count` pieces, the last one drawn over the
 * fraction `t` of its length (1 = whole). `count` is 0 before the polyline and `dist.length - 1` past its end.
 */
export function cutAt(dist: Float64Array, distanceM: number): { count: number; t: number } {
  const last = dist.length - 1
  if (last < 1 || distanceM <= dist[0]) return { count: 0, t: 1 }
  if (distanceM >= dist[last]) return { count: last, t: 1 }
  // first point beyond the distance, by bisection
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dist[mid] <= distanceM) lo = mid
    else hi = mid
  }
  const span = dist[hi] - dist[lo]
  return { count: hi, t: span > 0 ? (distanceM - dist[lo]) / span : 1 }
}

/** The part of a segment the draw-on changes: its geometry, draped points and point distances. */
export interface CuttableLine {
  geometry: LineGeometry
  /** draped xyz per point, as written into the geometry */
  positions: Float32Array
  dist: Float64Array
  /** piece whose end vertex is moved to the marker, -1 for none */
  shortened: number
}

function setPieceEnd(line: CuttableLine, piece: number, x: number, y: number, z: number): void {
  const end = line.geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute | undefined
  if (!end?.isInterleavedBufferAttribute) return
  end.setXYZ(piece, x, y, z)
  end.data.needsUpdate = true
}

/** Undo the shortening of the last drawn piece (its end back on the next draped point). */
export function restorePiece(line: CuttableLine): void {
  if (line.shortened < 0) return
  const o = (line.shortened + 1) * 3
  setPieceEnd(line, line.shortened, line.positions[o], line.positions[o + 1], line.positions[o + 2])
  line.shortened = -1
}

/** Draw `line` up to `distanceM` (Infinity = whole). */
export function cutLine(line: CuttableLine, distanceM: number): void {
  restorePiece(line)
  const { count, t } = cutAt(line.dist, distanceM)
  line.geometry.instanceCount = count
  if (count === 0 || t >= 1) return
  const piece = count - 1
  const a = piece * 3
  const p = line.positions
  setPieceEnd(line, piece, p[a] + (p[a + 3] - p[a]) * t, p[a + 1] + (p[a + 4] - p[a + 1]) * t, p[a + 2] + (p[a + 5] - p[a + 2]) * t)
  line.shortened = piece
}

// ---------------------------------------------------------------------------
// Flights: width following the depth
// ---------------------------------------------------------------------------

/** Bounds of the factor a flight's width follows the depth with: it never vanishes nor becomes a ribbon. */
export const FLIGHT_WIDTH_MIN = 0.6
export const FLIGHT_WIDTH_MAX = 1.6

/**
 * Factor of the user's width at `depthM` from the camera in a flight, `focusM` being the distance it is the user's width
 * at (the camera's target): nearer is thicker, farther thinner, within the bounds. `weight` (`flightEase`) fades it in
 * from the ground, where it is 1. The vertex shader of `addTrailCut` computes the same, per vertex.
 */
export function flightWidthFactor(focusM: number, depthM: number, weight = 1): number {
  if (!(focusM > 0) || !(depthM > 0) || !(weight > 0)) return 1
  return 1 + (Math.min(FLIGHT_WIDTH_MAX, Math.max(FLIGHT_WIDTH_MIN, focusM / depthM)) - 1) * Math.min(1, weight)
}

/** Store the flight weight (0..1, `flightEase`) of both ends of every piece in the geometry, like `setTrackDistances`. */
export function setFlightWeights(geometry: LineGeometry, weights: Float32Array): void {
  const pieces = weights.length - 1
  const array = new Float32Array(Math.max(0, pieces) * 2)
  for (let i = 0; i < pieces; i++) {
    array[i * 2] = weights[i]
    array[i * 2 + 1] = weights[i + 1]
  }
  const buffer = new InstancedInterleavedBuffer(array, 2, 1)
  geometry.setAttribute('instanceFlightStart', new InterleavedBufferAttribute(buffer, 1, 0))
  geometry.setAttribute('instanceFlightEnd', new InterleavedBufferAttribute(buffer, 1, 1))
}

// ---------------------------------------------------------------------------
// Flights: curtain and ground shadow
// ---------------------------------------------------------------------------

/** Opacity of the curtain at the line, fading to 0 at the ground. */
export const CURTAIN_TOP_ALPHA = 0.35
/** Opacity of the shadow at its centre, and its width as a share of the line's. */
export const SHADOW_ALPHA = 0.4
export const SHADOW_WIDTH_SHARE = 1.5
/** `trailEndM` when the whole track is drawn: past every distance. */
const NO_END = 1e9

/** Uniforms of the draw-on and trail cut shared by the curtain and the shadow (`setFlightCut`). */
interface FlightCut {
  trailStartM: { value: number }
  trailFadeM: { value: number }
  drawEndM: { value: number }
}

const newFlightCut = (): FlightCut => ({ trailStartM: { value: NO_TRAIL }, trailFadeM: { value: 0 }, drawEndM: { value: NO_END } })

/** Fragment code of the cut: nothing before the trail start or past the marker, the trail thinning out the oldest part. */
const CUT_DISCARD = 'if ( vTrackM < trailStartM || vTrackM > drawEndM ) discard;'
const CUT_FADE = 'trailFadeM > 0.0 ? smoothstep( trailStartM, trailStartM + trailFadeM, vTrackM ) : 1.0'
const CUT_PARS = 'uniform float trailStartM;\nuniform float trailFadeM;\nuniform float drawEndM;\nvarying float vTrackM;\n'

/**
 * The wall under a flight: vertex colours with alpha (the line's colours, `CURTAIN_TOP_ALPHA` at the top, 0 at the ground),
 * the relief hides it (depth test) but it hides nothing (no depth write). Its `trackM` attribute (distance along the
 * track) drives the cut: the part not yet flown and the trail are skipped per pixel, the trail thinning out in opacity.
 */
export function createCurtainMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide })
  const cut = newFlightCut()
  material.userData.cut = cut
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cut)
    shader.vertexShader = `attribute float trackM;\nvarying float vTrackM;\n${shader.vertexShader.replace('void main() {', 'void main() {\n  vTrackM = trackM;')}`
    shader.fragmentShader = `${CUT_PARS}${shader.fragmentShader
      .replace('void main() {', `void main() {\n  ${CUT_DISCARD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.a *= ${CUT_FADE};`)}`
  }
  material.customProgramCacheKey = () => 'track-curtain'
  return material
}

/**
 * The flight's shadow: a ribbon draped on the ground (centre line twice, `edge` -1 / +1, `ahead` the direction of travel),
 * widened in screen space to `widthPx` like the line, so one strip has no overlap to darken where pieces meet as a
 * translucent line would. Black, soft towards its edges.
 */
export function createShadowMaterial(width: number, height: number): ShaderMaterial {
  const cut = newFlightCut()
  const material = new ShaderMaterial({
    uniforms: { ...cut, resolution: { value: new Vector2(width, height) }, widthPx: { value: 0 }, shadowAlpha: { value: SHADOW_ALPHA } },
    // <common> declares isPerspectiveMatrix, which <logdepthbuf_vertex> calls
    vertexShader: `#include <common>
attribute vec3 ahead;
attribute float edge;
attribute float trackM;
uniform vec2 resolution;
uniform float widthPx;
varying float vEdge;
varying float vTrackM;
#include <logdepthbuf_pars_vertex>
void main() {
  vEdge = edge;
  vTrackM = trackM;
  vec4 here = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  vec4 next = projectionMatrix * modelViewMatrix * vec4( position + ahead, 1.0 );
  float aspect = resolution.x / resolution.y;
  vec2 dir = next.xy / next.w - here.xy / here.w;
  dir.x *= aspect;
  dir = length( dir ) > 1e-6 ? normalize( dir ) : vec2( 1.0, 0.0 );
  vec2 offset = vec2( dir.y / aspect, - dir.x ) * edge;
  here.xy += offset * widthPx / resolution.y * here.w;
  gl_Position = here;
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `${CUT_PARS}uniform float shadowAlpha;
varying float vEdge;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  ${CUT_DISCARD}
  float soft = 1.0 - smoothstep( 0.2, 1.0, abs( vEdge ) );
  gl_FragColor = vec4( 0.0, 0.0, 0.0, shadowAlpha * soft * ( ${CUT_FADE} ) );
}`,
    transparent: true,
    // the ribbon is widened in the screen: which face looks at the camera depends on the direction of travel
    side: DoubleSide,
    depthWrite: false,
    // pulled towards the camera like the line's lift: the relief between two draped points must not cut it
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.userData.cut = cut
  return material
}

/** Cut a curtain or shadow material like the line: nothing before `startM` (thinning out over `fadeM`) nor past `endM` along the track. */
export function setFlightCut(material: MeshBasicMaterial | ShaderMaterial, startM: number, fadeM: number, endM: number): void {
  const cut = material.userData.cut as FlightCut
  cut.trailStartM.value = startM
  cut.trailFadeM.value = fadeM
  cut.drawEndM.value = Number.isFinite(endM) ? endM : NO_END
}

// ---------------------------------------------------------------------------
// Trail (« Traînée »)
// ---------------------------------------------------------------------------

/** `trailStartM` when there is no trail: below every distance along a track (they start at 0). */
export const NO_TRAIL = -1
/** Part of the trail, from its start, over which the line and its halo thin out (0..1). */
export const TRAIL_FADE_SHARE = 0.5

/**
 * Store the distance along the track of both ends of every piece (`dist`, one value per point) in the geometry, for
 * the trail cut of `addTrailCut`. The pieces never change once built: draping moves them, not their distances.
 */
export function setTrackDistances(geometry: LineGeometry, dist: Float64Array): void {
  const pieces = dist.length - 1
  const array = new Float32Array(Math.max(0, pieces) * 2)
  for (let i = 0; i < pieces; i++) {
    array[i * 2] = dist[i]
    array[i * 2 + 1] = dist[i + 1]
  }
  const buffer = new InstancedInterleavedBuffer(array, 2, 1)
  geometry.setAttribute('instanceTrackStart', new InterleavedBufferAttribute(buffer, 1, 0))
  geometry.setAttribute('instanceTrackEnd', new InterleavedBufferAttribute(buffer, 1, 1))
}

/**
 * Teach a track line material to skip what lies before `trailStartM` along the track (`setTrailStart`), and to thin
 * out over the next `trailFadeM` metres: the pieces stay in place, only the painting skips them, so the colours by
 * metric and the dashes stored piece by piece still match. The fade scales the width at each piece end rather than the
 * opacity: the line is opaque, and a translucent one would darken where neighbouring pieces overlap at a joint. The
 * whole cross-section shrinks, so a glow keeps bordering its line. In a flight the same offset also follows the depth
 * (`flightWeight` per piece end, `setFlightWeights`; `flightDepthM` = the distance where the width is the user's). `cacheKey`
 * names the patched program (it must differ from the unpatched material's).
 */
export function addTrailCut(material: LineMaterial, cacheKey: string): void {
  material.uniforms.trailStartM = { value: NO_TRAIL }
  material.uniforms.trailFadeM = { value: 0 }
  material.uniforms.flightDepthM = { value: 0 }
  const patch = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer)
    shader.vertexShader = `attribute float instanceTrackStart;\nattribute float instanceTrackEnd;\nattribute float instanceFlightStart;\nattribute float instanceFlightEnd;\nuniform float trailStartM;\nuniform float trailFadeM;\nuniform float flightDepthM;\nvarying float vTrackM;\n${shader.vertexShader
      .replace(
        'void main() {',
        'void main() {\n  vTrackM = ( position.y < 0.5 ) ? instanceTrackStart : instanceTrackEnd;\n  float trailWidth = trailFadeM > 0.0 ? smoothstep( trailStartM, trailStartM + trailFadeM, vTrackM ) : 1.0;',
      )
      // `flightWidthFactor` in GLSL: weight 0 (the ground, and every track without the attribute) leaves the width alone
      .replace(
        'offset *= linewidth;',
        `float flightWeight = ( position.y < 0.5 ) ? instanceFlightStart : instanceFlightEnd;
  float flightDepth = ( position.y < 0.5 ) ? clipStart.w : clipEnd.w;
  float flightWidth = ( flightDepthM > 0.0 && flightWeight > 0.0 ) ? mix( 1.0, clamp( flightDepthM / flightDepth, ${FLIGHT_WIDTH_MIN.toFixed(1)}, ${FLIGHT_WIDTH_MAX.toFixed(1)} ), flightWeight ) : 1.0;
  offset *= linewidth * trailWidth * flightWidth;`,
      )}`
    shader.fragmentShader = `uniform float trailStartM;\nvarying float vTrackM;\n${shader.fragmentShader.replace(
      'void main() {',
      'void main() {\n  if ( vTrackM < trailStartM ) discard;',
    )}`
  }
  material.customProgramCacheKey = () => cacheKey
}

/**
 * Hide what lies before `startM` along the track (NO_TRAIL: nothing) on a material patched by `addTrailCut`, and thin
 * the line out over the `fadeM` metres after it (0: a sharp cut).
 */
export function setTrailStart(material: LineMaterial, startM: number, fadeM = 0): void {
  material.uniforms.trailStartM.value = startM
  material.uniforms.trailFadeM.value = fadeM
}

/** Distance from `camera` to what it looks at (`target`), for the dash scale. */
export function viewDistance(camera: Camera, target: Vector3 | null): number {
  return target ? camera.position.distanceTo(target) : camera.position.length()
}
