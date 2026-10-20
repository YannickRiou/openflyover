/**
 * Loudness of the exported soundtrack (« Normaliser le volume »): the integrated loudness of the mix as ITU-R BS.1770-4
 * measures it (K-weighting, 400 ms blocks with 75 % overlap, absolute gate at -70 LUFS, relative gate 10 LU under), the
 * gain that brings it to the target (YouTube and most platforms play at -14 LUFS, EBU R128 asks -23), and a look-ahead
 * limiter that keeps the result under a true-peak ceiling (-1 dBTP) so the gain never clips. Pure functions over the
 * float samples of `MixedAudio` (48 kHz, the only rate the filter coefficients are given for); no DOM, no Web Audio.
 */

/** The only sample rate of the soundtrack mix (film/audio.ts `MIX_SAMPLE_RATE`). */
export const LOUDNESS_SAMPLE_RATE = 48000

/** Targets offered, LUFS: the web's, a calmer one, and the broadcast one. */
export const LOUDNESS_TARGETS_LUFS = [-14, -16, -23] as const
export const DEFAULT_LOUDNESS_LUFS = -14
/** True-peak ceiling of the limiter, dB. */
export const TRUE_PEAK_CEILING_DB = -1
/** The most the gain may raise a quiet mix, dB (more would mostly lift the noise). */
export const MAX_GAIN_DB = 15
/** Look-ahead of the limiter, seconds. */
const LOOKAHEAD_S = 0.005

/** K-weighting at 48 kHz (BS.1770-4): a high shelf, then a high-pass; each as `[b0, b1, b2, a1, a2]`. */
const K_STAGES: readonly (readonly [number, number, number, number, number])[] = [
  [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
  [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621],
]

/** `samples` through the K-weighting filter (a new array). */
function kWeighted(samples: Float32Array): Float64Array {
  let current: Float64Array = Float64Array.from(samples)
  for (const [b0, b1, b2, a1, a2] of K_STAGES) {
    const out = new Float64Array(current.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < current.length; i++) {
      const x = current[i]
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      out[i] = y
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
    }
    current = out
  }
  return current
}

/** Loudness of a mean square, LUFS. */
const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare)

/**
 * Integrated loudness of the channels (all weighted 1: left and right), LUFS; null when nothing is above the -70 LUFS
 * gate (silence) or the samples are not at 48 kHz.
 */
export function measureLoudness(channels: readonly Float32Array[], sampleRate: number = LOUDNESS_SAMPLE_RATE): number | null {
  if (sampleRate !== LOUDNESS_SAMPLE_RATE || channels.length === 0) return null
  const block = Math.round(0.4 * sampleRate)
  const step = Math.round(0.1 * sampleRate)
  const length = Math.min(...channels.map((c) => c.length))
  if (length < block) return null
  // squared K-weighted samples, summed over the channels, and their running sum to read any block in O(1)
  const weighted = channels.map(kWeighted)
  const prefix = new Float64Array(length + 1)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const channel of weighted) sum += channel[i] * channel[i]
    prefix[i + 1] = prefix[i] + sum
  }
  const blocks: number[] = []
  for (let start = 0; start + block <= length; start += step) blocks.push((prefix[start + block] - prefix[start]) / block)
  const audible = blocks.filter((z) => lufs(z) > -70)
  if (audible.length === 0) return null
  const mean = (zs: number[]) => zs.reduce((a, b) => a + b, 0) / zs.length
  const relative = lufs(mean(audible)) - 10
  const kept = audible.filter((z) => lufs(z) > relative)
  return kept.length === 0 ? null : lufs(mean(kept))
}

/** dB to a linear gain. */
export const dbToGain = (db: number) => 10 ** (db / 20)

/**
 * Peak of the signal between its samples, estimated on a 4× oversampling (Catmull-Rom through the four nearest samples):
 * what a converter would draw (the true peak), per sample index (the largest over the interval that starts there).
 */
function truePeaks(channels: readonly Float32Array[], length: number): Float32Array {
  const peaks = new Float32Array(length)
  for (const x of channels) {
    for (let i = 0; i < length; i++) {
      const p0 = x[Math.max(0, i - 1)]
      const p1 = x[i]
      const p2 = x[Math.min(length - 1, i + 1)]
      const p3 = x[Math.min(length - 1, i + 2)]
      let peak = Math.abs(p1)
      for (const u of [0.25, 0.5, 0.75]) {
        const u2 = u * u
        const u3 = u2 * u
        const v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
        peak = Math.max(peak, Math.abs(v))
      }
      if (peak > peaks[i]) peaks[i] = peak
    }
  }
  return peaks
}

/**
 * The channels multiplied by a look-ahead limiter's gain, in place: the gain every sample needs to stay under `ceiling`
 * (linear), taken as the minimum over the next LOOKAHEAD_S, then averaged over as long (so it falls before a peak and
 * rises after it without a click, and never above what the sample itself needs). The peak is the 4× oversampled one.
 * Returns the deepest reduction applied, dB (0 when nothing was limited).
 */
export function limitPeaks(channels: readonly Float32Array[], ceiling: number, sampleRate: number = LOUDNESS_SAMPLE_RATE): number {
  const length = Math.min(...channels.map((c) => c.length))
  const window = Math.max(1, Math.round(LOOKAHEAD_S * sampleRate))
  const peaks = truePeaks(channels, length)
  const needed = new Float32Array(length)
  let limited = false
  for (let i = 0; i < length; i++) {
    needed[i] = peaks[i] > ceiling ? ceiling / peaks[i] : 1
    if (needed[i] < 1) limited = true
  }
  if (!limited) return 0
  // minimum of `needed` over [i, i + window) by a monotone deque, then the mean of the last `window` of those minima
  const minima = new Float32Array(length)
  const deque = new Int32Array(length)
  let head = 0
  let tail = 0
  for (let i = length - 1; i >= 0; i--) {
    while (tail > head && needed[deque[tail - 1]] >= needed[i]) tail--
    deque[tail++] = i
    while (deque[head] >= i + window) head++
    minima[i] = needed[deque[head]]
  }
  let deepest = 1
  let sum = 0
  for (let i = 0; i < length; i++) {
    sum += minima[i]
    if (i >= window) sum -= minima[i - window]
    const count = Math.min(i + 1, window)
    // before the first full window the missing minima are the first one (never above what the sample itself needs)
    const gain = (sum + (window - count) * minima[0]) / window
    deepest = Math.min(deepest, gain)
    for (const channel of channels) channel[i] *= gain
  }
  return -20 * Math.log10(deepest)
}

/** What `normaliseLoudness` did. */
export interface LoudnessReport {
  /** loudness before, LUFS (null: silence, nothing done) */
  measured: number | null
  /** gain applied to reach the target, dB */
  gainDb: number
  /** deepest reduction of the limiter, dB */
  limitedDb: number
}

/**
 * The mix brought to `targetLufs` in place: its integrated loudness measured, the gain to the target applied (at most
 * MAX_GAIN_DB up, any amount down), then the limiter under TRUE_PEAK_CEILING_DB. A silent mix, or one that is not at 48 kHz,
 * is left as it is.
 */
export function normaliseLoudness(audio: { sampleRate: number; channels: Float32Array[] }, targetLufs: number): LoudnessReport {
  const measured = measureLoudness(audio.channels, audio.sampleRate)
  if (measured === null) return { measured: null, gainDb: 0, limitedDb: 0 }
  const gainDb = Math.min(MAX_GAIN_DB, targetLufs - measured)
  const gain = dbToGain(gainDb)
  for (const channel of audio.channels) for (let i = 0; i < channel.length; i++) channel[i] *= gain
  return { measured, gainDb, limitedDb: limitPeaks(audio.channels, dbToGain(TRUE_PEAK_CEILING_DB), audio.sampleRate) }
}
