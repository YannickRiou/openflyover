// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '../i18n'
import { setForestStatus } from '../scene/forestStatus'
import { setPerfProbe } from '../scene/perfProbe'
import { setWaterStatus } from '../scene/waterStatus'
import { useAppStore } from '../state/store'
import { AboutDialog } from './AboutDialog'
import { StatusBar } from './StatusBar'

let host: HTMLElement
let root: Root

const bar = () => host.querySelector('footer')!.textContent ?? ''
const stats = (visibleTiles: number, pendingVisibleTiles: number, failedTiles = 0) =>
  useAppStore.getState().setTerrainStats({ visibleTiles, loadedTiles: visibleTiles, pendingTiles: pendingVisibleTiles, failedTiles, pendingVisibleTiles })
/** Changes the stores the bar listens to, then lets the display delay of a load and the performance tick go by. */
async function change(update: () => void, ms = 600) {
  await act(async () => {
    update()
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  setLanguage('fr')
  setPerfProbe({ onFrame: () => () => {}, memory: () => ({ textures: 4, geometries: 3 }) })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<StatusBar />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setPerfProbe(undefined)
  setWaterStatus('idle')
  setForestStatus('idle')
  stats(0, 0)
  vi.useRealTimers()
})

describe('StatusBar', () => {
  it('says what loads in one indicator for the map and one for the other layers', async () => {
    await change(() => {
      stats(10, 10)
      setWaterStatus('loading')
      setForestStatus('queued')
    })
    expect(bar()).toContain('Chargement de la carte… 50')
    expect(bar().match(/Chargement\u202f:/g)).toHaveLength(1)
    expect(bar()).toContain('Chargement\u202f: Eau, Forêts')
  })

  it('says nothing once all is loaded, and keeps the technical figures out of the bar', async () => {
    await change(() => {
      stats(40, 0)
      setWaterStatus('ready')
      setForestStatus('ready')
    }, 1500)
    expect(bar()).not.toMatch(/Chargement|Carte|Eau|Forêts|tuiles|JS|i\/s|textures/)
  })

  it('keeps a failure in words on the bar, loaded or not', async () => {
    await change(() => {
      stats(40, 0, 2)
      setForestStatus('error')
    })
    expect(bar()).toContain('2 tuiles en erreur')
    expect(bar()).toContain('Échec du chargement\u202f: Forêts')
  })

  it('never shows the technical figures: they are in « À propos et mises à jour »', async () => {
    await change(() => stats(40, 0), 1500)
    expect(bar()).not.toContain('tuiles')
    expect(host.querySelector('button[aria-label^="Sources et licences"]')).toBeNull()
    await act(async () => root.render(<AboutDialog open onClose={() => {}} />))
    await change(() => {}, 1500)
    expect(document.body.textContent).toContain('Performances')
    expect(document.body.textContent).toContain('40 tuiles')
  })
})
