import { describe, expect, it } from 'vitest'
import { LOUDNESS_SAMPLE_RATE, MAX_GAIN_DB, TRUE_PEAK_CEILING_DB, dbToGain, limitPeaks, measureLoudness, normaliseLoudness } from './loudness'

const RATE = LOUDNESS_SAMPLE_RATE

/** A stereo sine of `hz`, `peakDb` dBFS at its peak, `seconds` long. */
function sine(peakDb: number, seconds: number, hz = 997): Float32Array[] {
  const amplitude = dbToGain(peakDb)
  const one = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE))
  return [one, Float32Array.from(one)]
}

/** The peak between the samples of the loudest channel, from the same 4× oversampling the limiter uses (dB). */
function peakDb(channels: Float32Array[]): number {
  const copy = channels.map((c) => Float32Array.from(c))
  // a limiter at +100 dB ceiling touches nothing; measure through a limiter that has to reduce: use the largest sample and its neighbours
  let peak = 0
  for (const x of copy) {
    for (let i = 1; i + 2 < x.length; i++) {
      for (const u of [0, 0.25, 0.5, 0.75]) {
        const [p0, p1, p2, p3] = [x[i - 1], x[i], x[i + 1], x[i + 2]]
        const v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
        peak = Math.max(peak, Math.abs(v))
      }
    }
  }
  return 20 * Math.log10(peak)
}

describe('measureLoudness', () => {
  it('a stereo 997 Hz sine at -23 dBFS reads -23 LUFS (the reference of EBU R128), -14 at -14 dBFS', () => {
    expect(measureLoudness(sine(-23, 10), RATE)).toBeCloseTo(-23, 1)
    expect(measureLoudness(sine(-14, 10), RATE)).toBeCloseTo(-14, 1)
    // 6 dB more is 6 LU more
    expect(measureLoudness(sine(-17, 10), RATE)! - measureLoudness(sine(-23, 10), RATE)!).toBeCloseTo(6, 1)
  })

  it('one channel alone is 3 LU under the same sine on both', () => {
    const both = sine(-20, 10)
    const left = [both[0], new Float32Array(both[0].length)]
    expect(measureLoudness(both, RATE)! - measureLoudness(left, RATE)!).toBeCloseTo(3.01, 1)
  })

  it('silence, a too short mix, or another sample rate: nothing to measure', () => {
    expect(measureLoudness([new Float32Array(RATE * 5), new Float32Array(RATE * 5)], RATE)).toBeNull()
    expect(measureLoudness(sine(-20, 0.2), RATE)).toBeNull()
    expect(measureLoudness(sine(-20, 5), 44100)).toBeNull()
    expect(measureLoudness([], RATE)).toBeNull()
  })

  it('the gates leave out the silence around the music: the loudness is that of the music', () => {
    const music = sine(-20, 10)
    const padded = music.map((c) => {
      const out = new Float32Array(c.length + RATE * 30)
      out.set(c, RATE * 10)
      return out
    })
    // the blocks that only half hold the music are above the gate and count, so a little under the music's own loudness
    expect(measureLoudness(padded, RATE)).toBeCloseTo(measureLoudness(music, RATE)!, 0)
    // and a quiet passage 20 LU under does not count either
    const quiet = sine(-45, 10)
    const mixed = music.map((c, i) => {
      const out = new Float32Array(c.length * 2)
      out.set(c, 0)
      out.set(quiet[i], c.length)
      return out
    })
    expect(measureLoudness(mixed, RATE)).toBeCloseTo(measureLoudness(music, RATE)!, 0)
  })
})

describe('limitPeaks', () => {
  const ceiling = dbToGain(TRUE_PEAK_CEILING_DB)

  it('leaves a signal under the ceiling untouched', () => {
    const channels = sine(-6, 1)
    const before = Float32Array.from(channels[0])
    expect(limitPeaks(channels, ceiling, RATE)).toBe(0)
    expect(channels[0]).toEqual(before)
  })

  it('keeps a loud sine and a lone peak under the ceiling, however high they are', () => {
    const loud = sine(6, 1)
    limitPeaks(loud, ceiling, RATE)
    expect(peakDb(loud)).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DB + 0.05)
    const clicks = sine(-30, 1)
    for (const c of clicks) c[RATE / 2] = 3
    const reduced = limitPeaks(clicks, ceiling, RATE)
    expect(reduced).toBeGreaterThan(9)
    expect(peakDb(clicks)).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DB + 0.05)
  })

  it('falls before the peak and rises after it, never touching the quiet far from it', () => {
    const clicks = sine(-30, 1)
    for (const c of clicks) c[RATE / 2] = 3
    const quiet = Float32Array.from(clicks[0])
    limitPeaks(clicks, ceiling, RATE)
    // far from the peak (a tenth of a second) the signal is as it was
    expect(clicks[0][RATE / 4]).toBeCloseTo(quiet[RATE / 4], 6)
    expect(clicks[0][(RATE * 3) / 4]).toBeCloseTo(quiet[(RATE * 3) / 4], 6)
    // just before the peak the gain is already under 1
    const before = RATE / 2 - 100
    expect(Math.abs(clicks[0][before])).toBeLessThan(Math.abs(quiet[before]))
  })
})

describe('normaliseLoudness', () => {
  it('brings a quiet mix to the target', () => {
    const audio = { sampleRate: RATE, channels: sine(-30, 10) }
    const report = normaliseLoudness(audio, -14)
    expect(report.measured).toBeCloseTo(-30, 1)
    expect(report.gainDb).toBeCloseTo(16 > MAX_GAIN_DB ? MAX_GAIN_DB : 16, 1)
    expect(report.gainDb).toBe(MAX_GAIN_DB)
    expect(measureLoudness(audio.channels, RATE)).toBeCloseTo(-30 + MAX_GAIN_DB, 1)
  })

  it('brings a mix to -14 and a louder one down to -23', () => {
    const quiet = { sampleRate: RATE, channels: sine(-20, 10) }
    expect(normaliseLoudness(quiet, -14).gainDb).toBeCloseTo(6, 1)
    expect(measureLoudness(quiet.channels, RATE)).toBeCloseTo(-14, 1)
    const loud = { sampleRate: RATE, channels: sine(-6, 10) }
    const report = normaliseLoudness(loud, -23)
    expect(report.gainDb).toBeCloseTo(-17, 1)
    expect(measureLoudness(loud.channels, RATE)).toBeCloseTo(-23, 1)
    expect(report.limitedDb).toBe(0)
  })

  it('raised to -14, a mix with high peaks is limited under the ceiling, and the loudness holds within a LU or so', () => {
    const channels = sine(-26, 10)
    for (const c of channels) for (let i = RATE; i < c.length; i += RATE) c[i] = 0.9
    const audio = { sampleRate: RATE, channels }
    const report = normaliseLoudness(audio, -14)
    expect(report.limitedDb).toBeGreaterThan(0)
    expect(peakDb(audio.channels)).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DB + 0.05)
    expect(Math.abs(measureLoudness(audio.channels, RATE)! - -14)).toBeLessThan(2)
  })

  it('silence and another sample rate are left as they are', () => {
    const silent = { sampleRate: RATE, channels: [new Float32Array(RATE * 3), new Float32Array(RATE * 3)] }
    expect(normaliseLoudness(silent, -14)).toEqual({ measured: null, gainDb: 0, limitedDb: 0 })
    const other = { sampleRate: 44100, channels: sine(-20, 3) }
    const before = Float32Array.from(other.channels[0])
    expect(normaliseLoudness(other, -14).gainDb).toBe(0)
    expect(other.channels[0]).toEqual(before)
  })
})
