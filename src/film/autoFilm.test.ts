import { describe, expect, it } from 'vitest'
import { platformPresetOf } from '../export/schedule'
import { FLYOVER_DURATION_RANGE, findCameraPreset } from '../flyover/cameraSettings'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import { AUTO_FILM_IDS, AUTO_FILM_LABELS, AUTO_FILM_TEMPLATES, autoFilmSettings } from './autoFilm'
import { junctionCardOf } from './junctions'
import { DEFAULT_FILM } from './model'

const single = { days: 1, stages: false }
const total = (s: Settings) => s.film.opening.durationS + s.flyoverDurationS + s.film.closing.durationS

describe('autoFilmSettings', () => {
  it('gives each gabarit the length, format, camera and cards it promises', () => {
    const reel = autoFilmSettings(DEFAULT_SETTINGS, 'reel', single)
    expect(total(reel)).toBe(30)
    expect(platformPresetOf(reel.video)).toBe('vertical')
    expect(findCameraPreset(reel.camera)?.id).toBe('fast-drone')
    expect(reel.overlay).toMatchObject({ enabled: true, style: 'app', title: { enabled: true, showDate: true }, end: { enabled: true, figures: ['distance', 'ascent', 'maxAltitude'] } })
    expect(reel.film).toMatchObject({ autoStops: false, stops: [] })

    const resume = autoFilmSettings(DEFAULT_SETTINGS, 'resume', single)
    expect(total(resume)).toBe(60)
    expect(platformPresetOf(resume.video)).toBe('youtube')
    expect(resume.film).toMatchObject({ autoStops: true, autoMode: 'temps-forts' })
    expect(resume.pacing.enabled).toBe(false)

    const souvenir = autoFilmSettings(DEFAULT_SETTINGS, 'souvenir', single)
    expect(total(souvenir)).toBe(180)
    expect(findCameraPreset(souvenir.camera)?.id).toBe('cinema')
    expect(souvenir.pacing).toMatchObject({ enabled: true, climbs: true, keepDuration: true })
    expect(souvenir.overlay.counters.enabled).toBe(true)
  })

  it('keeps the cards a few seconds past the shots, whatever the length', () => {
    for (const id of AUTO_FILM_IDS) {
      const s = autoFilmSettings(DEFAULT_SETTINGS, id, single)
      expect(s.overlay.title.end * s.flyoverDurationS).toBeCloseTo(3, 0)
      expect((1 - s.overlay.end.start) * s.flyoverDurationS).toBeCloseTo(3, 0)
    }
  })

  it('never touches what the user wrote or placed by hand', () => {
    const own: Settings = {
      ...DEFAULT_SETTINGS,
      overlay: {
        ...DEFAULT_OVERLAY,
        title: { ...DEFAULT_OVERLAY.title, title: 'Mon tour', subtitle: 'Avec Léa', line: 'Été', window: { startS: 0, endS: 4 } },
        end: { ...DEFAULT_OVERLAY.end, title: 'Fin', credits: 'Merci' },
        text: { ...DEFAULT_OVERLAY.text, text: 'Libre' },
      },
      film: { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 'stop-1', atM: 100, durationS: 3, camera: 'fixe' }], texts: [{ id: 'text-1', startS: 1, durationS: 2, text: 'Hop', anchor: 'center', size: 1 }] },
    }
    for (const id of AUTO_FILM_IDS) {
      const s = autoFilmSettings(own, id, single)
      expect(s.overlay.title).toMatchObject({ title: 'Mon tour', subtitle: 'Avec Léa', line: 'Été', window: { startS: 0, endS: 4 } })
      expect(s.overlay.end).toMatchObject({ title: 'Fin', credits: 'Merci' })
      expect(s.overlay.text.text).toBe('Libre')
      expect(s.film.stops).toEqual(own.film.stops)
      expect(s.film.autoStops).toBe(false)
      expect(s.film.texts).toEqual(own.film.texts)
    }
  })

  it('applied again, or after another gabarit, it replaces its own choices only', () => {
    const resume = autoFilmSettings(DEFAULT_SETTINGS, 'resume', single)
    expect(autoFilmSettings(resume, 'resume', single)).toEqual(resume)
    const reel = autoFilmSettings(resume, 'reel', single)
    expect(reel).toEqual(autoFilmSettings(DEFAULT_SETTINGS, 'reel', single))
    expect(autoFilmSettings(reel, 'resume', single)).toEqual(resume)
  })

  it('switches on the day cards of a multi-day track, and the stage cards of a sequence', () => {
    expect(autoFilmSettings(DEFAULT_SETTINGS, 'resume', single).film.dayCards).toBeUndefined()
    expect(autoFilmSettings(DEFAULT_SETTINGS, 'resume', { days: 3, stages: false }).film.dayCards?.enabled).toBe(true)
    expect(autoFilmSettings(DEFAULT_SETTINGS, 'reel', { days: 3, stages: false }).film.dayCards?.enabled).toBe(false)
    const staged = (id: (typeof AUTO_FILM_IDS)[number]) => autoFilmSettings(DEFAULT_SETTINGS, id, { days: 0, stages: true }).film
    expect(junctionCardOf(staged('resume'), null).enabled).toBe(true)
    expect(junctionCardOf(staged('reel'), null).enabled).toBe(false)
  })

  it('stays inside every range, so the project saves and reopens as it is', () => {
    for (const id of AUTO_FILM_IDS) {
      const tpl = AUTO_FILM_TEMPLATES[id]
      expect(tpl.totalS - tpl.openingS - tpl.closingS).toBeGreaterThanOrEqual(FLYOVER_DURATION_RANGE.min)
      expect(AUTO_FILM_LABELS[id]).not.toBe('')
      for (const context of [single, { days: 3, stages: false }, { days: 0, stages: true }]) {
        const settings = autoFilmSettings(DEFAULT_SETTINGS, id, context)
        expect(sanitizeSettings(settings).invalid).toEqual([])
      }
    }
  })
})
