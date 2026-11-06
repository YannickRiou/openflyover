// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_FILMS } from '../film/activityFilms'
import { buildTrack } from '../import/stats'
import { setLanguage } from '../i18n'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { ActivityDialog } from './ActivityDialog'
import { proposeActivity, useActivityProposal } from './activityProposal'
import { runImport } from './projectActions'
import { useToastStore } from './toast'

// no tiles to fetch: the elevation step would wait for its timeout
vi.mock('../terrain/elevation', () => ({ completeImportedElevations: async (tracks: unknown[]) => tracks }))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLanguage('fr')
})

const ride = (activityType?: string) =>
  buildTrack({
    name: 'Sortie',
    source: 'gpx',
    activityType,
    segments: [{ points: [{ lon: 6.86, lat: 45.92, ele: 1000 }, { lon: 6.87, lat: 45.93, ele: 1100 }, { lon: 6.88, lat: 45.93, ele: 1150 }] }],
  })

let host: HTMLElement
let root: Root
beforeEach(async () => {
  resetAppStore()
  getSettingsHistory().clear()
  proposeActivity(null)
  useToastStore.setState({ toasts: [] })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<ActivityDialog />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const importRide = (activityType?: string) => act(async () => runImport([{ label: 'sortie.gpx', run: async () => [ride(activityType)] }]))
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement
const radio = (name: string) => [...document.querySelectorAll('label')].find((l) => l.textContent === name) as HTMLLabelElement

describe('activity proposed after the first import', () => {
  it('preselects the activity read from the file, and « Appliquer » sets its film', async () => {
    await importRide('cycling')
    expect(useActivityProposal.getState().figure).toBe('cycliste')
    expect(document.body.textContent).toContain('Quelle activité')
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(17)
    expect((document.querySelector('input[type="radio"][value="cycliste"]') as HTMLInputElement).checked).toBe(true)
    await act(async () => button('Appliquer').click())
    const { settings } = useAppStore.getState()
    expect(settings.marker).toMatchObject({ kind: 'figurine', figure: 'cycliste' })
    expect(settings.flyoverDurationS).toBe(ACTIVITY_FILMS.cycliste.durationS)
    expect(settings.overlay.style).toBe(ACTIVITY_FILMS.cycliste.style)
    expect(useActivityProposal.getState().figure).toBeNull()
    expect(document.body.textContent).not.toContain('Quelle activité')
  })

  it('applies another activity when the person picks one', async () => {
    await importRide('cycling')
    await act(async () => radio('Parapente').click())
    await act(async () => button('Appliquer').click())
    expect(useAppStore.getState().settings.marker.figure).toBe('parapente')
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(ACTIVITY_FILMS.parapente.durationS)
  })

  it('« Passer » keeps today\'s film exactly', async () => {
    await importRide('cycling')
    await act(async () => button('Passer').click())
    expect(useAppStore.getState().settings).toEqual(DEFAULT_SETTINGS)
    expect(useActivityProposal.getState().figure).toBeNull()
  })

  it('is not asked again for a later import into the same project', async () => {
    await importRide()
    expect(useActivityProposal.getState().figure).toBe('randonneur')
    await act(async () => button('Passer').click())
    await importRide('cycling')
    expect(useActivityProposal.getState().figure).toBeNull()
  })
})
