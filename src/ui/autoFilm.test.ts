import { beforeEach, describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { applyAutoFilm } from './autoFilm'
import { useToastStore } from './toast'

const rando = () =>
  buildTrack({
    name: 'Rando',
    source: 'gpx',
    segments: [{ points: [{ lon: 6.86, lat: 45.92, ele: 1000 }, { lon: 6.87, lat: 45.93, ele: 1100 }, { lon: 6.88, lat: 45.93, ele: 1150 }] }],
  })

beforeEach(() => {
  resetAppStore()
  getSettingsHistory().clear()
  useToastStore.setState({ toasts: [] })
})

describe('applyAutoFilm', () => {
  it('does nothing without a track', () => {
    expect(applyAutoFilm('reel')).toBe(false)
    expect(useAppStore.getState().settings).toEqual(DEFAULT_SETTINGS)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('sets the film in one undo step, and « Annuler » in the message puts everything back', () => {
    useAppStore.getState().addTracks([rando()])
    getSettingsHistory().clear()
    const before = useAppStore.getState().settings
    expect(applyAutoFilm('reel')).toBe(true)
    const { settings } = useAppStore.getState()
    expect(settings.flyoverDurationS).toBe(24)
    expect(settings.video.aspect).toBe('9:16')
    expect(settings.overlay.title.enabled).toBe(true)

    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ kind: 'success' })
    expect(toast.text).toContain('Reel 30 s')
    toast.action?.run()
    expect(useAppStore.getState().settings).toEqual(before)
  })

  it('the message does not undo a later change', () => {
    useAppStore.getState().addTracks([rando()])
    applyAutoFilm('resume')
    const [toast] = useToastStore.getState().toasts
    useAppStore.getState().setSetting('exaggeration', 2)
    toast.action?.run()
    expect(useAppStore.getState().settings.exaggeration).toBe(2)
  })
})
