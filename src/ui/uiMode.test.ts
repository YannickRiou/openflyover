import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import { PLAIN_DAY } from '../flyover/sun'
import { ambianceHours, ambianceOf } from './uiMode'

const settings = (patch: Record<string, unknown>) => ({ ...DEFAULT_SETTINGS, ...patch }) as typeof DEFAULT_SETTINGS

describe('ambianceOf', () => {
  const noon = ambianceHours(PLAIN_DAY).sunny as number

  it('« Météo du jour » is the clouds of the weather at the recorded time, with the weather acting on the scene', () => {
    expect(ambianceOf(settings({ clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'meteo' }, sunFromTrack: true }), PLAIN_DAY)).toBe('weather')
  })

  it('« Grand beau » is no clouds at noon and no weather on the scene: a veil or a haze of the day would not be a clear sky', () => {
    const sunny = { clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'aucun' }, sunFromTrack: false, sunHour: noon }
    expect(ambianceOf(settings({ ...sunny, weatherScene: { enabled: false, strength: 1 } }), PLAIN_DAY)).toBe('sunny')
    expect(ambianceOf(settings({ ...sunny, weatherScene: { enabled: true, strength: 1 } }), PLAIN_DAY)).toBeUndefined()
  })

  it('« Météo du jour » is not lit once the weather no longer acts on the scene', () => {
    expect(ambianceOf(settings({ clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'meteo' }, sunFromTrack: true, weatherScene: { enabled: false, strength: 1 } }), PLAIN_DAY)).toBeUndefined()
  })
})
