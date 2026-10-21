// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { findImageryDates } from '../terrain/imageryDates'
import { GradingPanel } from './GradingPanel'
import { LightSettings, MapSettings } from './SettingsPanel'

vi.mock('../terrain/imageryDates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terrain/imageryDates')>()),
  findImageryDates: vi.fn(),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('« Date des photos »', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  it('an Esri date chosen before its list was found shows its day once found again, never the number of its release', async () => {
    const points = [
      { lon: 6.86, lat: 45.92 },
      { lon: 6.87, lat: 45.93 },
    ]
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    const { settings, setSetting } = useAppStore.getState()
    setSetting('imagerySourceId', 'arcgis-world-imagery')
    setSetting('imageryDate', 'esri:13968')
    let resolve: (dates: Awaited<ReturnType<typeof findImageryDates>>) => void = () => {}
    vi.mocked(findImageryDates).mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<MapSettings />))
    expect(host.textContent).not.toContain('13968')
    expect(host.textContent).toContain('Photos plus anciennes')
    expect(findImageryDates).toHaveBeenCalledTimes(1)
    const date = { value: 'esri:13968', timeMs: Date.UTC(2021, 0, 12), taken: true, kind: 'esri' as const }
    await act(async () => resolve({ latest: { ...date, value: '' }, dates: [date] }))
    expect(host.textContent).toContain('12 janvier 2021')
    act(() => root.unmount())
    setSetting('imagerySourceId', settings.imagerySourceId)
    setSetting('imageryDate', '')
  })
})

describe('« Ombres des nuages »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('greyed out, with the reason, when there are no clouds in volume', async () => {
    const { settings, setSetting } = useAppStore.getState()
    setSetting('atmosphere', true)
    setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<LightSettings />))
    const box = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.closest('label')?.textContent?.includes('Ombres des nuages'))!
    expect(box.disabled).toBe(true)
    expect(host.textContent).toContain('pas de nuages en volume')
    await act(async () => setSetting('clouds', { ...settings.clouds, mode: 'manuel' }))
    expect(box.disabled).toBe(false)
    act(() => root.unmount())
    setSetting('clouds', settings.clouds)
    setSetting('atmosphere', settings.atmosphere)
  })
})

describe('« Couleurs »: a grading preset with keys', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  it('a value driven by keys gets the preset’s on its key at the marker, the others the setting', async () => {
    const points = [
      { lon: 6.86, lat: 45.92 },
      { lon: 6.87, lat: 45.93 },
    ]
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    const { settings, setSetting } = useAppStore.getState()
    setSetting('film', { ...settings.film, paramKeys: [{ id: 'param-1', param: 'contrast', atM: 0, value: -0.5 }] })
    useAppStore.getState().setProgress(0, null)
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<GradingPanel />))
    const chip = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.closest('label')?.textContent === 'Contrasté')!
    await act(async () => chip.click())
    const after = useAppStore.getState().settings
    expect(after.film.paramKeys.find((k) => k.param === 'contrast')?.value).toBe(0.4)
    expect(after.grading).toMatchObject({ preset: 'contraste', saturation: 0.1, vignette: 0.25 })
    act(() => root.unmount())
    setSetting('film', settings.film)
    setSetting('grading', settings.grading)
  })
})
