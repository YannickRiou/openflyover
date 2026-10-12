/**
 * « Nettoyer le relief en mer »: removal of the spikes of the elevation data over the sea (present in the source DEMs,
 * e.g. off Corsica, with Mapterhorn and AWS alike) and optional flattening of the sea to 0 m. Pure functions on grids.
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

/** Bring the heights below 0 m to 0 m, in place (nodata stays NaN). */
export function clampSeaToZero(grid: HeightGrid): HeightGrid {
  const { data } = grid
  for (let i = 0; i < data.length; i++) if (data[i] < 0) data[i] = 0
  return grid
}

/** Apply the cleaning chosen by the user; the grid itself is returned when it is off. */
export function cleanDem(grid: HeightGrid, options: DemCleanOptions): HeightGrid {
  if (!options.enabled) return grid
  const cleaned = removeSeaSpikes(grid)
  return options.seaToZero ? clampSeaToZero(cleaned) : cleaned
}
