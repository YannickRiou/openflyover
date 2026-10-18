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

describe('figureMotion', () => {
  it('bounces twice a second and sways both ways, a function of the film time alone', () => {
    expect(figureMotion(0)).toEqual({ lift: 0, tilt: 0 })
    // a quarter step: top of the bounce, leaning forward
    const top = figureMotion(0.25)
    expect(top.lift).toBeCloseTo(0.08, 6)
    expect(top.tilt).toBeGreaterThan(0)
    expect(figureMotion(0.75).tilt).toBeLessThan(0)
    expect(figureMotion(0.5).lift).toBeCloseTo(0, 6)
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
    expect(markerMovesWithTime({ ...DEFAULT_MARKER, kind: 'figurine', ballStyle: 'pulsation' })).toBe(false)
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
    expect(figureOfActivity('flying')).toBe('avion')
    expect(figureOfActivity('driving')).toBe('voiture')
  })
})
