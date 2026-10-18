/**
 * « Nettoyer le relief en mer »: removal of the spikes of the elevation data over the sea (present in the source DEMs,
 * e.g. off Corsica, with Mapterhorn and AWS alike) and optional flattening of the sea to 0 m. Pure functions on grids.
 * Two kinds of spikes: single pixels (`removeSeaSpikes`), and pillars of many pixels standing alone in the sea
 * (`removeSeaPillars`: off Capo Rosso, Mapterhorn holds a blade 1100 m high and ~300 m wide, 1142 pixels at z12, smooth
 * at every zoom, so no pixel steps much from its neighbours).
 */
import type { DemCleanOptions, HeightGrid } from '../core/types'

export const DEFAULT_DEM_CLEAN: DemCleanOptions = { enabled: false, seaToZero: false }

/**
 * A pixel is a spike when it differs from the median of its neighbours by more than this (m). Real relief over a
 * low neighbourhood does not step by 150 m in one pixel (30 m at z12): a cliff or a cape has land neighbours of its own.
 */
export const SPIKE_THRESHOLD_M = 150
/** only spikes standing out of a neighbourhood whose median is below this (m) are touched: mountains are never */
export const SEA_NEIGHBOURHOOD_MAX_M = 20
/**
 * A pillar is an island (pixels above `SEA_NEIGHBOURHOOD_MAX_M`) more than this many times taller than the distance
 * from its innermost pixel to the sea. Real sea stacks stay under 4 (Stac Lee, St Kilda: 172 m for 48 m, 3.6); the
 * spikes of the source data are 6 to 15 at every zoom from 9 on.
 */
export const PILLAR_MIN_STEEPNESS = 5

export function isValidDemClean(v: DemCleanOptions): boolean {
  return typeof v.enabled === 'boolean' && typeof v.seaToZero === 'boolean'
}

/** Project files written before the setting existed, or with a partial object. */
export function withDemCleanDefaults(v: Partial<DemCleanOptions> | undefined): DemCleanOptions {
  return { ...DEFAULT_DEM_CLEAN, ...v }
}

/** Same effect on the decoded grids (`seaToZero` means nothing while the cleaning is off). */
export function sameDemClean(a: DemCleanOptions, b: DemCleanOptions): boolean {
  return a.enabled === b.enabled && (!a.enabled || a.seaToZero === b.seaToZero)
}

/** Median (mean of the two middle values for an even count) of `values[0..n)`, sorted in place; n <= 8. */
function median(values: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = values[i]
    let j = i - 1
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j]
      j--
    }
    values[j + 1] = v
  }
  const mid = n >> 1
  return n % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/**
 * Replace by the median of their 8 neighbours the pixels that stand out of a low neighbourhood: |h - median| above
 * `SPIKE_THRESHOLD_M`, median below `SEA_NEIGHBOURHOOD_MAX_M`, and at most one neighbour within the threshold of h (an
 * isolated spike, not the tip of a cape or a cliff). Reads the original grid, so the result does not depend on the scan
 * order. Nodata (NaN) is left as is and ignored as a neighbour; a pixel with fewer than 3 valid neighbours is kept.
 * Returns a new grid; the input is not modified.
 */
export function removeSeaSpikes(grid: HeightGrid): HeightGrid {
  const { width, height, data } = grid
  const out = Float32Array.from(data)
  const neighbours = new Float32Array(8)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const h = data[y * width + x]
      if (h !== h) continue
      let n = 0
      let similar = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue
          const v = data[yy * width + xx]
          if (v !== v) continue
          neighbours[n++] = v
          if (Math.abs(v - h) <= SPIKE_THRESHOLD_M) similar++
        }
      }
      if (n < 3 || similar > 1) continue
      const m = median(neighbours, n)
      if (m < SEA_NEIGHBOURHOOD_MAX_M && Math.abs(h - m) > SPIKE_THRESHOLD_M) out[y * width + x] = m
    }
  }
  return { width, height, data: out }
}

/**
 * Lower to the surrounding sea the islands that are too steep to be real: highest pixel above `SPIKE_THRESHOLD_M` and
 * above `PILLAR_MIN_STEEPNESS` times the distance (m) from the innermost pixel to the sea (to the nearest sea pixel,
 * less half a pixel for the shore between them). An island is a group of 8-connected pixels above
 * `SEA_NEIGHBOURHOOD_MAX_M`; the tile edge does not count as sea, so the mainland and the big islands are far too wide.
 * A pillar cut by the tile edge is judged on its part in the tile: a lower piece of it may stay. Nodata (NaN) is
 * neither land nor sea and stays NaN. Reads the original grid; returns it when nothing is removed, else a new grid.
 */
export function removeSeaPillars(grid: HeightGrid, metresPerPixel: number): HeightGrid {
  const { width, height, data } = grid
  const count = width * height
  let hasSea = false
  let hasHigh = false
  for (let i = 0; i < count; i++) {
    if (data[i] <= SEA_NEIGHBOURHOOD_MAX_M) hasSea = true
    else if (data[i] > SPIKE_THRESHOLD_M) hasHigh = true
  }
  if (!hasSea || !hasHigh) return grid

  // distance (pixels) to the nearest sea pixel, two-pass chamfer (1, sqrt 2): at most 8 % above the true distance
  const dist = new Float32Array(count)
  for (let i = 0; i < count; i++) dist[i] = data[i] <= SEA_NEIGHBOURHOOD_MAX_M ? 0 : Infinity
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 1 : -1
    for (let y = pass === 0 ? 0 : height - 1; y >= 0 && y < height; y += step) {
      const yy = y - step
      for (let x = pass === 0 ? 0 : width - 1; x >= 0 && x < width; x += step) {
        const i = y * width + x
        let d = dist[i]
        if (d === 0) continue
        const xx = x - step
        if (xx >= 0 && xx < width) d = Math.min(d, dist[i - step] + 1)
        if (yy >= 0 && yy < height) {
          const up = yy * width + x
          d = Math.min(d, dist[up] + 1)
          if (xx >= 0 && xx < width) d = Math.min(d, dist[up - step] + Math.SQRT2)
          if (x + step >= 0 && x + step < width) d = Math.min(d, dist[up + step] + Math.SQRT2)
        }
        dist[i] = d
      }
    }
  }

  let out: Float32Array | undefined
  const seen = new Uint8Array(count)
  const members = new Int32Array(count)
  for (let start = 0; start < count; start++) {
    if (seen[start] || !(data[start] > SEA_NEIGHBOURHOOD_MAX_M)) continue
    // flood fill of one island: `members` is the queue and, once done, the list of its pixels
    seen[start] = 1
    members[0] = start
    let size = 1
    let top = -Infinity
    let inner = 0
    let seaSum = 0
    let seaCount = 0
    for (let head = 0; head < size; head++) {
      const i = members[head]
      top = Math.max(top, data[i])
      inner = Math.max(inner, dist[i])
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const j = yy * width + xx
          const v = data[j]
          if (v <= SEA_NEIGHBOURHOOD_MAX_M) {
            seaSum += v
            seaCount++
          } else if (v > SEA_NEIGHBOURHOOD_MAX_M && !seen[j]) {
            seen[j] = 1
            members[size++] = j
          }
        }
      }
    }
    if (seaCount === 0 || top <= SPIKE_THRESHOLD_M) continue
    if (top <= PILLAR_MIN_STEEPNESS * (inner - 0.5) * metresPerPixel) continue
    out ??= Float32Array.from(data)
    const sea = seaSum / seaCount
    for (let k = 0; k < size; k++) out[members[k]] = sea
  }
  return out ? { width, height, data: out } : grid
}

/** Bring the heights below 0 m to 0 m, in place (nodata stays NaN). */
export function clampSeaToZero(grid: HeightGrid): HeightGrid {
  const { data } = grid
  for (let i = 0; i < data.length; i++) if (data[i] < 0) data[i] = 0
  return grid
}

/**
 * Apply the cleaning chosen by the user; the grid itself is returned when it is off. The pillars are looked for only
 * when the ground width of the tile (m) is given.
 */
export function cleanDem(grid: HeightGrid, options: DemCleanOptions, tileWidthM?: number): HeightGrid {
  if (!options.enabled) return grid
  let cleaned = removeSeaSpikes(grid)
  if (tileWidthM !== undefined) cleaned = removeSeaPillars(cleaned, tileWidthM / grid.width)
  return options.seaToZero ? clampSeaToZero(cleaned) : cleaned
}
