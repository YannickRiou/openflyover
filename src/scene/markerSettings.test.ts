import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  DEFAULT_MARKER,
  DEFAULT_TRACK_STYLE,
  DEFAULT_TRACK_TAIL,
  figureMotion,
  figureOfActivity,
  isValidMarker,
  isValidTrackStyle,
  isValidTrackTail,
  MARKER_FIGURES,
  MARKER_IMAGE_MAX_CHARS,
  markerMovesWithTime,
  pulsePhase,
  withMarkerDefaults,
} from './markerSettings'
import { MARKER_FIGURE_PATHS } from './markerFigures'
import type { FigureClock } from './markerSettings'

describe('track style and marker settings', () => {
  it('accepts the defaults, rejects unknown choices, out-of-range sizes and anything but a bounded image data URL', () => {
    expect(isValidTrackStyle(DEFAULT_TRACK_STYLE)).toBe(true)
    expect(isValidMarker(DEFAULT_MARKER)).toBe(true)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, dash: 'zigzag' as never })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, width: 40 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: -10 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: 500 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: 100 })).toBe(true)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowIntensity: 0 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowIntensity: 1.5 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowWidth: 200 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowColor: 'red' })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowColor: '#FFD23F', glowIntensity: 1, glowWidth: 64 })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, figure: 'cheval' as never })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, size: 0 })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: 'https://example.org/me.png' })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: 'data:image/png;base64,AAAA' })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: `data:image/png;base64,${'A'.repeat(MARKER_IMAGE_MAX_CHARS)}` })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, color: '', figureColor: '#FFD23F', ballStyle: 'pulsation', shape: 'epingle' })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, color: 'red' })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, ballStyle: 'etoile' as never })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, shape: 'losange' as never })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, label: 'texte', labelText: 'x'.repeat(41) })).toBe(false)
  })

  it('a marker saved before the colours, styles, shapes, label and stick keeps its former look', () => {
    const { settings, invalid } = sanitizeSettings({ marker: { kind: 'figurine', figure: 'randonneur', image: '', size: 2, animated: true } })
    expect(invalid).toEqual([])
    expect(settings.marker).toEqual({ ...DEFAULT_MARKER, kind: 'figurine', figure: 'randonneur', size: 2, animated: true })
    expect(settings.marker).toMatchObject({ color: '#FFFFFF', figureColor: '#1C2A33', ballStyle: 'plat', shape: 'rond', label: 'aucune', stick: false })
    // the 'anneau' style was dropped: such a ball opens plain
    const ringed = sanitizeSettings({ marker: { ...DEFAULT_MARKER, ballStyle: 'anneau' } })
    expect(ringed.invalid).toEqual([])
    expect(ringed.settings.marker.ballStyle).toBe('plat')
  })

  it('projects: older ones get the defaults, a partial marker is completed, an invalid one is reported', () => {
    expect(sanitizeSettings({}).settings.marker).toBe(DEFAULT_SETTINGS.marker)
    expect(withMarkerDefaults({ kind: 'figurine' })).toEqual({ ...DEFAULT_MARKER, kind: 'figurine' })
    const { settings, invalid } = sanitizeSettings({ marker: { kind: 'figurine', figure: 'skieur' }, trackStyle: { width: 'x' } })
    expect(settings.marker).toEqual({ ...DEFAULT_MARKER, kind: 'figurine', figure: 'skieur' })
    expect(invalid).toEqual(['trackStyle'])
    // a track style saved before the smoothing and the glow settings existed: off, default glow (track colour)
    const older = sanitizeSettings({ trackStyle: { width: 6, dash: 'tirets', glow: true, drawOn: true } })
    expect(older.invalid).toEqual([])
    expect(older.settings.trackStyle).toEqual({ ...DEFAULT_TRACK_STYLE, width: 6, dash: 'tirets', glow: true, drawOn: true, smoothingM: 0 })
    expect(older.settings.trackStyle.glowColor).toBe('')
  })

  it('« Traînée »: off in a project saved before it, an out-of-range length falls back to the default', () => {
    expect(isValidTrackTail(DEFAULT_TRACK_TAIL)).toBe(true)
    expect(isValidTrackTail({ enabled: true, lengthM: 50 })).toBe(false)
    expect(isValidTrackTail({ enabled: true, lengthM: 30_000 })).toBe(false)
    expect(sanitizeSettings({ trackStyle: { ...DEFAULT_TRACK_STYLE, drawOn: true } }).settings.trackTail.enabled).toBe(false)
    const saved = sanitizeSettings({ trackTail: { enabled: true, lengthM: 2500 } })
    expect(saved.settings.trackTail).toEqual({ enabled: true, lengthM: 2500 })
    const invalid = sanitizeSettings({ trackTail: { enabled: true, lengthM: -5 } })
    expect(invalid.invalid).toEqual(['trackTail'])
    expect(invalid.settings.trackTail).toBe(DEFAULT_TRACK_TAIL)
  })

  it('has a pictogram for every figure', () => {
    for (const figure of MARKER_FIGURES) expect(MARKER_FIGURE_PATHS[figure].length).toBeGreaterThan(0)
  })
})

/**
 * A film clock reduced to what the walk reads: `total` seconds, the marker moving at `speedAt(t)` (relative units) and
 * covering the whole track by the end.
 */
function clockOf(total: number, speedAt: (t: number) => number): FigureClock {
  const step = 1 / 600
  const progress = [0]
  for (let i = 1; i <= Math.round(total / step); i++) progress.push(progress[i - 1] + speedAt((i - 0.5) * step) * step)
  const last = progress[progress.length - 1]
  return {
    totalTime: () => total,
    progressAtTime: (t) => {
      const x = Math.min(Math.max(t / step, 0), progress.length - 1)
      const i = Math.min(Math.floor(x), progress.length - 2)
      return (progress[i] + (progress[i + 1] - progress[i]) * (x - i)) / last
    },
  }
}

describe('figureMotion', () => {
  // opening 5 s, flight 5-55 s with a stop 20-24 s and a portion `fast` times faster 38-48 s, closing 5 s
  const film = (fast: number) =>
    clockOf(60, (t) => (t < 5 || t > 55 || (t >= 20 && t < 24) ? 0 : t >= 38 && t < 48 ? fast : 1))
  const clock = film(4)
  /** steps taken (zero crossings of the sway) between two film times, sampled at 240 Hz */
  const steps = (c: FigureClock, from: number, to: number) => {
    let count = 0
    let last = figureMotion(c, from).tilt
    for (let t = from + 1 / 240; t <= to; t += 1 / 240) {
      const tilt = figureMotion(c, t).tilt
      if (last !== 0 && tilt !== 0 && Math.sign(tilt) !== Math.sign(last)) count++
      if (tilt !== 0) last = tilt
    }
    return count
  }
  const peak = (c: FigureClock, from: number, to: number) => {
    let top = 0
    for (let t = from; t <= to; t += 1 / 120) top = Math.max(top, figureMotion(c, t).lift)
    return top
  }

  it('walks while the marker moves, bouncing up to 8% of the badge and swaying both ways', () => {
    expect(peak(clock, 10, 12)).toBeGreaterThan(0.075)
    expect(peak(clock, 10, 12)).toBeLessThanOrEqual(0.08)
    const tilts = Array.from({ length: 120 }, (_, i) => figureMotion(clock, 10 + i / 60).tilt)
    expect(Math.max(...tilts)).toBeGreaterThan(0.07)
    expect(Math.min(...tilts)).toBeLessThan(-0.07)
  })

  it('stands still, upright, in the opening, the closing and the stops', () => {
    for (const t of [0, 2, 4.9, 20.6, 22, 23.9, 56, 58, 60]) {
      const { lift, tilt } = figureMotion(clock, t)
      expect(Math.abs(lift) + Math.abs(tilt), `${t} s`).toBe(0)
    }
  })

  it('eases into the walk and out of it over a fraction of a second, with no snap', () => {
    // 0.2 s after the marker sets off, the walk is half-strength at most; 0.4 s later it is whole
    expect(peak(clock, 24, 24.2)).toBeLessThan(0.05)
    expect(peak(clock, 24.45, 25.45)).toBeGreaterThan(0.075)
    // and it goes on a moment after the marker stops
    expect(peak(clock, 20, 20.2)).toBeGreaterThan(0.05)
    expect(peak(clock, 20.45, 21)).toBe(0)
  })

  it('has a continuous phase: no jump between frames at 30 or 60 fps, across stops and speed changes', () => {
    for (const fps of [30, 60]) {
      let worst = 0
      for (let i = 1; i < 60 * fps; i++) {
        const before = figureMotion(clock, (i - 1) / fps)
        const now = figureMotion(clock, i / fps)
        worst = Math.max(worst, Math.abs(now.lift - before.lift) / 0.08, Math.abs(now.tilt - before.tilt) / ((5 * Math.PI) / 180))
      }
      // a step of the walk lasts 8+ frames: a frame moves the pose by a third of its range at most
      expect(worst, `${fps} fps`).toBeLessThan(0.45)
    }
  })

  it('walks faster when the flight goes faster, within a calm range', () => {
    const calm = steps(clock, 10, 14)
    expect(calm).toBeGreaterThanOrEqual(5)
    expect(steps(clock, 41, 46) / 5).toBeGreaterThan((calm / 4) * 1.2)
    // a portion 12 times faster is capped (3.2 steps per second), never frantic
    const capped = film(12)
    expect(steps(capped, 41, 46)).toBeLessThanOrEqual(3.2 * 5 + 1)
    expect(steps(capped, 41, 46)).toBeGreaterThanOrEqual(3.2 * 5 - 2)
    // and a crawl does not go below its minimum (1.2 steps per second)
    expect(steps(film(0.05), 41, 51)).toBeGreaterThanOrEqual(10)
  })

  it('is the same for any frame rendered alone', () => {
    const alone = figureMotion(film(4), 43.37)
    expect(figureMotion(clock, 30)).toBeDefined()
    expect(figureMotion(clock, 43.37)).toEqual(alone)
  })
})

describe('pulsePhase', () => {
  it('pulses every 1.5 s of film, a function of the film time alone', () => {
    expect(pulsePhase(0)).toBe(0)
    expect(pulsePhase(0.76)).toBeCloseTo(0.5, 1)
    expect(pulsePhase(1.5 + 0.76)).toBe(pulsePhase(0.76))
    expect(pulsePhase(1.49)).toBeLessThan(1)
  })

  it('tells the export when the marker moves with the film time', () => {
    expect(markerMovesWithTime(DEFAULT_MARKER)).toBe(false)
    expect(markerMovesWithTime({ ...DEFAULT_MARKER, ballStyle: 'pulsation' })).toBe(true)
    expect(markerMovesWithTime({ ...DEFAULT_MARKER, kind: 'figurine', animated: true })).toBe(true)
    // a figure turns round after the track changes direction, walking or not
    expect(markerMovesWithTime({ ...DEFAULT_MARKER, kind: 'figurine' })).toBe(true)
  })
})

describe('figureOfActivity', () => {
  it('reads GPX types, FIT sports and Strava sports, the hiker when unknown', () => {
    expect(figureOfActivity(undefined)).toBe('randonneur')
    expect(figureOfActivity('hiking')).toBe('randonneur')
    expect(figureOfActivity('running')).toBe('coureur')
    expect(figureOfActivity('trail_running')).toBe('traileur')
    expect(figureOfActivity('cycling')).toBe('cycliste')
    expect(figureOfActivity('Vélo')).toBe('cycliste')
    expect(figureOfActivity('eBiking')).toBe('vae')
    expect(figureOfActivity('e_biking')).toBe('vae')
    expect(figureOfActivity('single_bike')).toBe('cycliste')
    expect(figureOfActivity('mountain_biking')).toBe('vtt')
    expect(figureOfActivity('motorcycling')).toBe('moto')
    expect(figureOfActivity('swimming')).toBe('nageur')
    expect(figureOfActivity('kayaking')).toBe('kayak')
    expect(figureOfActivity('standUpPaddleboarding')).toBe('kayak')
    expect(figureOfActivity('backcountry_skiing')).toBe('ski-rando')
    expect(figureOfActivity('alpineSkiing')).toBe('skieur')
    expect(figureOfActivity('cross_country_skiing')).toBe('skieur')
    expect(figureOfActivity('horsebackRiding')).toBe('cavalier')
    expect(figureOfActivity('mountaineering')).toBe('alpiniste')
    expect(figureOfActivity('hangGliding')).toBe('parapente')
    // a person under a wing on its lines: FIT 'kitesurfing', Strava « Kitesurf »
    expect(figureOfActivity('kitesurfing')).toBe('parapente')
    expect(figureOfActivity('kitesurf')).toBe('parapente')
    expect(figureOfActivity('kiteboarding')).toBe('parapente')
    expect(figureOfActivity('flying')).toBe('avion')
    expect(figureOfActivity('driving')).toBe('voiture')
  })
})
