import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, FLYOVER_DURATION_RANGE, isValidCamera } from '../flyover/cameraSettings'
import { OVERLAY_STYLES } from '../overlay/settings'
import { MARKER_FIGURES } from '../scene/markerSettings'
import { DEFAULT_SETTINGS } from '../state/store'
import { ACTIVITY_FILMS, activityFilmSettings } from './activityFilms'

describe('activity films', () => {
  it('give every marker figure a film made of existing values', () => {
    expect(Object.keys(ACTIVITY_FILMS).sort()).toEqual([...MARKER_FIGURES].sort())
    for (const figure of MARKER_FIGURES) {
      const film = ACTIVITY_FILMS[figure]
      expect(CAMERA_PRESETS.map((p) => p.id)).toContain(film.camera)
      expect(OVERLAY_STYLES).toContain(film.style)
      expect(film.durationS).toBeGreaterThanOrEqual(FLYOVER_DURATION_RANGE.min)
      expect(film.durationS).toBeLessThanOrEqual(FLYOVER_DURATION_RANGE.max)
      expect(isValidCamera(activityFilmSettings(DEFAULT_SETTINGS, figure).camera)).toBe(true)
    }
  })

  it('set the camera, the marker, the overlay style and the duration, and nothing else', () => {
    const next = activityFilmSettings(DEFAULT_SETTINGS, 'parapente')
    expect(next.camera).toEqual(CAMERA_PRESETS.find((p) => p.id === 'glider')!.camera)
    expect(next.marker).toMatchObject({ kind: 'figurine', figure: 'parapente' })
    expect(next.overlay.style).toBe('cinema')
    expect(next.flyoverDurationS).toBe(75)
    expect({ ...next, camera: 0, marker: 0, overlay: 0, flyoverDurationS: 0 }).toEqual({ ...DEFAULT_SETTINGS, camera: 0, marker: 0, overlay: 0, flyoverDurationS: 0 })
  })

  it('keep the video format and the texts of the overlay', () => {
    const base = { ...DEFAULT_SETTINGS, overlay: { ...DEFAULT_SETTINGS.overlay, title: { ...DEFAULT_SETTINGS.overlay.title, title: 'Mon titre' } } }
    const next = activityFilmSettings(base, 'moto')
    expect(next.video).toBe(base.video)
    expect(next.overlay.title.title).toBe('Mon titre')
  })
})
