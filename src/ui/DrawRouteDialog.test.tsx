// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ImportJob } from './importFlow'
import { DrawRouteDialog } from './DrawRouteDialog'

const imported = vi.hoisted(() => ({ jobs: [] as ImportJob[] }))
vi.mock('./projectActions', () => ({
  runImport: async (jobs: ImportJob[]) => {
    imported.jobs.push(...jobs)
  },
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // no canvas in jsdom: the map draws nothing, the points and the button are what is tested
  HTMLCanvasElement.prototype.getContext = () => null
})

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  imported.jobs.length = 0
  vi.unstubAllGlobals()
})

async function openDialog() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<DrawRouteDialog open onClose={() => {}} />))
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

async function clickMap(x: number, y: number) {
  const map = document.querySelector('[data-testid="draw-map"]')!
  await act(async () => {
    map.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
  })
}

describe('DrawRouteDialog', () => {
  it('creates a track from the routed line between two clicks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ geometry: { type: 'LineString', coordinates: [[2.3, 48.8], [2.31, 48.81], [2.32, 48.82]] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await openDialog()
    expect(button('Créer la trace')?.hasAttribute('disabled')).toBe(true)

    await clickMap(100, 100)
    await clickMap(300, 200)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('data.geopf.fr')
    expect(button('Créer la trace')?.hasAttribute('disabled')).toBe(false)
    await act(async () => button('Créer la trace')!.click())

    expect(imported.jobs).toHaveLength(1)
    const [track] = await imported.jobs[0].run(0)
    expect(track.segments[0].points).toHaveLength(3)
    expect(track.activityType).toBe('hiking')
    expect(track.source).toBe('gpx')
  })

  it('keeps a straight line when no service finds a path, and says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await openDialog()
    await clickMap(100, 100)
    await clickMap(300, 200)

    expect(document.body.textContent).toContain('reste en ligne droite')
    await act(async () => button('Créer la trace')!.click())
    const [track] = await imported.jobs[0].run(0)
    expect(track.segments[0].points).toHaveLength(2)
  })

  it('does not ask a service in « Ligne droite » mode, and undoes the last point', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await openDialog()
    await act(async () => button('Ligne droite')!.click())
    await clickMap(100, 100)
    await clickMap(300, 200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button('Créer la trace')?.hasAttribute('disabled')).toBe(false)

    await act(async () => button('Annuler le dernier point')!.click())
    expect(button('Créer la trace')?.hasAttribute('disabled')).toBe(true)
  })
})
