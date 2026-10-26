import { describe, expect, it } from 'vitest'
import { LANGUAGES, setLanguage, t } from '../i18n'
import { platformPresetOf } from '../export/schedule'
import { FLYOVER_DURATION_RANGE, findCameraPreset } from '../flyover/cameraSettings'
import { CARD_FADE_OUT, DEFAULT_OVERLAY } from '../overlay/settings'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import { AUTO_FILM_IDS, AUTO_FILM_LABELS, AUTO_FILM_TEMPLATES, autoFilmFacts, autoFilmSettings } from './autoFilm'
import { junctionCardOf } from './junctions'
import { DEFAULT_FILM } from './model'

const single = { days: 1, stages: false }
const total = (s: Settings) => s.film.opening.durationS + s.flyoverDurationS + s.film.closing.durationS

describe('autoFilmSettings', () => {
  it('gives each gabarit the length, format, camera and cards it promises', () => {
    const reel = autoFilmSettings(DEFAULT_SETTINGS, 'reel', single)
    expect(total(reel)).toBe(30)
    expect(platformPresetOf(reel.video)).toBe('vertical')
    expect(findCameraPreset(reel.camera)?.id).toBe('cinema')
    expect(reel.overlay).toMatchObject({ enabled: true, style: 'app', title: { enabled: true, showDate: true }, end: { enabled: true, figures: ['distance', 'ascent', 'maxAltitude'] } })
    expect(reel.film).toMatchObject({ autoStops: false, stops: [] })
    expect(reel.film.autoStopsPlaces).toBeUndefined()

    const resume = autoFilmSettings(DEFAULT_SETTINGS, 'resume', single)
    expect(total(resume)).toBe(60)
    expect(platformPresetOf(resume.video)).toBe('youtube')
    expect(resume.film).toMatchObject({ autoStops: true })
    expect(resume.film.autoStopsPlaces).toBeUndefined()
    expect(resume.pacing).toEqual({ ...DEFAULT_SETTINGS.pacing, keepDuration: true })

    const souvenir = autoFilmSettings(DEFAULT_SETTINGS, 'souvenir', single)
    expect(total(souvenir)).toBe(180)
    expect(findCameraPreset(souvenir.camera)?.id).toBe('cinema')
    expect(souvenir.pacing).toMatchObject({ keepDuration: true })
    // « Souvenir » alone also stops at the places passed; another gabarit afterwards takes it back; stops placed by hand are never touched
    expect(souvenir.film).toMatchObject({ autoStops: true, autoStopsPlaces: true })
    expect(autoFilmSettings(souvenir, 'resume', single).film.autoStopsPlaces).toBeUndefined()
    const byHand = { ...DEFAULT_SETTINGS, film: { ...DEFAULT_SETTINGS.film, autoStops: false, stops: [{ id: 'stop-1', atM: 10, durationS: 4, camera: 'orbite' as const }] } }
    expect(autoFilmSettings(byHand, 'souvenir', single).film).toMatchObject({ autoStops: false, stops: byHand.film.stops })
    expect(autoFilmSettings(byHand, 'souvenir', single).film.autoStopsPlaces).toBeUndefined()
    expect(souvenir.overlay.counters.enabled).toBe(true)
  })

  it('keeps the cards fully readable a few seconds past the shots, whatever the length', () => {
    for (const id of AUTO_FILM_IDS) {
      const s = autoFilmSettings(DEFAULT_SETTINGS, id, single)
      expect(Math.abs((s.overlay.title.end - CARD_FADE_OUT) * s.flyoverDurationS - 3)).toBeLessThan(0.05)
      expect(Math.abs((1 - s.overlay.end.start) * s.flyoverDurationS - 3)).toBeLessThan(0.05)
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
      film: {
        ...DEFAULT_FILM,
        autoStops: false,
        stops: [{ id: 'stop-1', atM: 100, durationS: 3, camera: 'fixe' }],
        // a text of the user, and a card of a version that baked the days into the texts, perhaps edited since
        texts: [
          { id: 'text-1', startS: 1, durationS: 2, text: 'Hop', anchor: 'center', size: 1 },
          { id: 'day-1', startS: 5, durationS: 3, text: 'Jour 1, ma version', anchor: 'center', size: 1 },
        ],
        stageDurations: { 'track-1': 40 },
        opening: { style: 'situation', durationS: 9, transition: 'fondu-noir', highlight: true, holdS: 2 },
        closing: { style: 'balayage', durationS: 5, transition: 'coupe' },
      },
    }
    for (const id of AUTO_FILM_IDS) {
      const s = autoFilmSettings(own, id, { days: 3, stages: false })
      expect(s.film.opening).toEqual({ ...own.film.opening, durationS: AUTO_FILM_TEMPLATES[id].openingS })
      expect(s.film.closing).toEqual({ ...own.film.closing, durationS: AUTO_FILM_TEMPLATES[id].closingS })
      expect(s.film.stageDurations).toEqual({ 'track-1': 40 })
      expect(s.overlay.title).toMatchObject({ title: 'Mon tour', subtitle: 'Avec Léa', line: 'Été', window: { startS: 0, endS: 4 } })
      expect(s.overlay.end).toMatchObject({ title: 'Fin', credits: 'Merci' })
      expect(s.overlay.text.text).toBe('Libre')
      expect(s.film.stops).toEqual(own.film.stops)
      expect(s.film.autoStops).toBe(false)
      expect(s.film.texts).toEqual(own.film.texts)
    }
  })

  it('gives a film without opening or closing shot a « Descente » of the gabarit\'s length', () => {
    const none = { ...DEFAULT_SETTINGS, film: { ...DEFAULT_FILM, opening: { style: 'aucune' as const, durationS: 6 }, closing: { style: 'aucune' as const, durationS: 5 } } }
    const s = autoFilmSettings(none, 'reel', single)
    expect(s.film.opening).toEqual({ style: 'descente', durationS: 3 })
    expect(s.film.closing).toEqual({ style: 'descente', durationS: 3 })
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

describe('autoFilmFacts', () => {
  it('lists the short facts that match what the gabarit sets', () => {
    expect(autoFilmFacts(AUTO_FILM_TEMPLATES.reel).map((f) => f.key)).toEqual(['titleEnd', 'noStops'])
    expect(autoFilmFacts(AUTO_FILM_TEMPLATES.reel)[0].values).toEqual({ figures: 3 })
    expect(autoFilmFacts(AUTO_FILM_TEMPLATES.resume).map((f) => f.key)).toEqual(['titleEnd', 'stops', 'countersCards'])
    expect(autoFilmFacts(AUTO_FILM_TEMPLATES.souvenir).map((f) => f.key)).toEqual(['titleEnd', 'stopsPlaces', 'countersCards'])
  })

  it('has a string in the five languages for each fact', () => {
    for (const language of LANGUAGES) {
      setLanguage(language.code)
      for (const id of AUTO_FILM_IDS) {
        for (const { key, values } of autoFilmFacts(AUTO_FILM_TEMPLATES[id])) {
          const text = t(`film.auto.fact.${key}`, values)
          expect(text).not.toBe('')
          expect(text).not.toContain('{')
        }
      }
    }
    setLanguage('fr')
  })
})
