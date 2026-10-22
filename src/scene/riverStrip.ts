/**
 * Ribbon mesh of a river, canal or stream mapped only as a line (osm/water.ts `WaterLine`): the polyline resampled every
 * `stepM` metres (so the ribbon follows its valley when it is draped), and at each sample three vertices, the left bank,
 * the middle and the right bank. The opacity fades from `CENTRE_FADE` in the middle to `EDGE_FADE` on the banks.
 * Triangles are counter-clockwise in lon / lat, like the lakes' (seen from above, front face up).
 *
 * Pure.
 */
import type { WaterMesh } from './waterMesh'

const M_PER_DEG = 111_320

/** Longest piece of ribbon between two samples (metres): the relief is sampled at each. */
export const STRIP_STEP_M = 60
/** Opacity factor in the middle of the ribbon, and on its banks. */
export const CENTRE_FADE = 1
export const EDGE_FADE = 0
/** Corners are mitred up to this many half-widths (a hairpin does not spike). */
const MAX_MITRE = 2

type Pt = [number, number]

const unit = (a: Pt, b: Pt): Pt => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [0, 0]
}

/** The line in local metres, with a sample at least every `stepM` and none twice. */
function resample(points: readonly Pt[], stepM: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i === 0) {
      out.push(p)
      continue
    }
    const a = points[i - 1]
    const length = Math.hypot(p[0] - a[0], p[1] - a[1])
    if (length === 0) continue
    const n = Math.ceil(length / stepM)
    for (let k = 1; k <= n; k++) out.push([a[0] + ((p[0] - a[0]) * k) / n, a[1] + ((p[1] - a[1]) * k) / n])
  }
  return out
}

/** Ribbon of `widthM` metres along `line` ([lon, lat] points); empty when the line has no length. */
export function buildRiverStrip(line: readonly Pt[], widthM: number, stepM = STRIP_STEP_M): WaterMesh {
  const lon0 = line.length > 0 ? line[0][0] : 0
  const lat0 = line.length > 0 ? line[0][1] : 0
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG
  const samples = resample(
    line.map(([lon, lat]): Pt => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG]),
    stepM,
  )
  const n = samples.length
  if (n < 2) return { lonLat: new Float64Array(0), fade: new Float32Array(0), index: new Uint32Array(0) }
  const lonLat = new Float64Array(n * 6)
  const fade = new Float32Array(n * 3)
  const half = widthM / 2
  const put = (v: number, x: number, y: number, f: number) => {
    lonLat[2 * v] = lon0 + x / kx
    lonLat[2 * v + 1] = lat0 + y / M_PER_DEG
    fade[v] = f
  }
  for (let i = 0; i < n; i++) {
    const before = i > 0 ? unit(samples[i - 1], samples[i]) : unit(samples[i], samples[i + 1])
    const after = i + 1 < n ? unit(samples[i], samples[i + 1]) : before
    const sum: Pt = [before[0] + after[0], before[1] + after[1]]
    const len = Math.hypot(sum[0], sum[1])
    // the left normal of the mean direction, widened at a bend so the bank stays half a width from the line
    const tangent: Pt = len > 0 ? [sum[0] / len, sum[1] / len] : after
    const left: Pt = [-tangent[1], tangent[0]]
    const mitre = Math.min(MAX_MITRE, 1 / Math.max(1 / MAX_MITRE, left[0] * -after[1] + left[1] * after[0]))
    const [x, y] = samples[i]
    put(3 * i, x + left[0] * half * mitre, y + left[1] * half * mitre, EDGE_FADE)
    put(3 * i + 1, x, y, CENTRE_FADE)
    put(3 * i + 2, x - left[0] * half * mitre, y - left[1] * half * mitre, EDGE_FADE)
  }
  const index: number[] = []
  for (let i = 0; i + 1 < n; i++) {
    const [l0, c0, r0, l1, c1, r1] = [3 * i, 3 * i + 1, 3 * i + 2, 3 * i + 3, 3 * i + 4, 3 * i + 5]
    index.push(l0, c0, c1, l0, c1, l1, c0, r0, r1, c0, r1, c1)
  }
  return { lonLat, fade, index: Uint32Array.from(index) }
}

/**
 * Height of each sample of a ribbon from the heights of its middle vertices (NaN where the relief is not loaded yet):
 * a gap takes the height of the nearest known sample along the line. null when none is known.
 */
export function stripHeights(middle: ArrayLike<number>): Float64Array | null {
  const out = Float64Array.from(middle)
  let last = Number.NaN
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) out[i] = last
    else last = out[i]
  }
  last = Number.NaN
  for (let i = out.length - 1; i >= 0; i--) {
    if (Number.isNaN(out[i])) out[i] = last
    else last = out[i]
  }
  return out.length > 0 && !Number.isNaN(out[0]) ? out : null
}
