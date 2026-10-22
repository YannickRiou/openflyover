// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { resetAppStore, useAppStore } from '../state/store'
import { TrackToolsButton } from './TrackTools'
import { useToastStore } from './toast'

const saved = vi.hoisted(() => ({ blobs: [] as Blob[], names: [] as string[] }))
vi.mock('../platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform')>()),
  getPlatform: () => ({
    saveDocument: async (produce: () => Promise<Blob>, options: { fileName: string }) => {
      saved.blobs.push(await produce())
      saved.names.push(options.fileName)
      return { saved: true, fileName: options.fileName }
    },
  }),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = () => null
})

const T0 = Date.UTC(2026, 6, 12, 8, 0, 0)

function walk(timed: boolean): Track {
  const points: TrackPoint[] = Array.from({ length: 40 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.0001, ele: 1000 + i, ...(timed ? { time: T0 + i * 10_000 } : {}) }))
  return { ...buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }
}

/** The card's button, the window it opens (a portal: searched in the whole page) and what is in it. */
async function mount(track: Track) {
  useAppStore.getState().replaceTracks([track])
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  // like the track list: the card shows the track now in the store
  const render = () => root.render(<TrackToolsButton track={useAppStore.getState().tracks[0]} busy={false} />)
  await act(async () => render())
  const unsubscribe = useAppStore.subscribe(() => act(() => render()))
  const page = document.body
  const open = () => act(async () => host.querySelector<HTMLButtonElement>('[data-testid="track-tools-open"]')!.click())
  const tool = (id: string) => page.querySelector<HTMLButtonElement>(`[data-testid="track-tool-${id}"]`)!
  const pick = (id: string) => act(async () => tool(id).click())
  const button = (label: string) => [...page.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
  return { host, root, page, open, tool, pick, button, stop: () => (unsubscribe(), act(() => root.unmount())) }
}

describe('TrackTools', () => {
  afterEach(() => {
    resetAppStore()
    useToastStore.setState({ toasts: [] })
    document.body.innerHTML = ''
    saved.blobs.length = 0
    saved.names.length = 0
  })

  it('is one line in the track card; the tools are in the window it opens', async () => {
    const { host, page, open, tool, stop } = await mount(walk(true))
    expect(host.textContent).toBe('Outils de la trace…')
    expect(page.querySelector('[data-testid="track-tools-window"]')).toBeNull()
    await open()
    expect(page.querySelector('[data-testid="track-tools-window"]')).not.toBeNull()
    expect(page.querySelector('[data-testid="track-tools-preview"] [data-testid="track-preview"]')).not.toBeNull()
    for (const id of ['trim', 'cut', 'spikes', 'pauses', 'simplify', 'reverse', 'shift']) expect(tool(id), id).not.toBeNull()
    stop()
  })

  it('greys the tools that need times on a track without any, and says why', async () => {
    const { page, open, tool, stop } = await mount(walk(false))
    await open()
    expect(tool('pauses').disabled).toBe(true)
    expect(tool('shift').disabled).toBe(true)
    expect(tool('trim').disabled).toBe(false)
    expect(page.textContent).toContain('Cette trace n’a pas d’heure')
    stop()
  })

  it('shows each tool in turn with its preview and the figures before and after', async () => {
    const { page, open, pick, stop } = await mount(walk(true))
    await open()
    for (const id of ['trim', 'cut', 'spikes', 'pauses', 'simplify', 'reverse', 'shift']) {
      await pick(id)
      expect(page.querySelector(`[data-testid="track-tool-dialog"][data-tool="${id}"]`), id).not.toBeNull()
      expect(page.querySelectorAll('[data-testid="track-preview"]'), id).toHaveLength(1)
      expect(page.querySelector('[data-testid="track-tool-figures"]')!.textContent, id).toContain('Distance')
    }
    stop()
  })

  it('applies a reverse in one step with « Annuler » in the message and in the window, and undoes it', async () => {
    const track = walk(true)
    const { page, open, pick, button, stop } = await mount(track)
    await open()
    await pick('reverse')
    await act(async () => button('Appliquer').click())
    const reversed = useAppStore.getState().tracks[0]
    expect(reversed.id).toBe(track.id)
    expect(reversed.segments[0].points[0].lat).toBe(track.segments[0].points[39].lat)
    expect(reversed.segments[0].points[0].time).toBe(T0)
    const [toast] = useToastStore.getState().toasts
    expect(toast.text).toContain('Inverser le sens')
    expect(toast.action?.label).toBe('Annuler')
    // the page's messages are under the window: the window offers « Annuler » itself
    const inWindow = page.querySelector('[data-testid="track-tools-applied"]')!
    expect(inWindow.textContent).toContain('Inverser le sens')
    await act(async () => [...inWindow.querySelectorAll('button')].find((b) => b.textContent === 'Annuler')!.click())
    expect(useAppStore.getState().tracks[0]).toBe(track)
    expect(page.querySelector('[data-testid="track-tools-applied"]')).toBeNull()
    stop()
  })

  it('a tool that changes nothing says so and cannot be applied', async () => {
    const track = walk(true)
    const { page, open, pick, button, stop } = await mount(track)
    await open()
    await pick('spikes')
    expect(page.textContent).toContain('Rien à modifier avec ces réglages.')
    expect(button('Appliquer').hasAttribute('disabled')).toBe(true)
    expect(useAppStore.getState().tracks[0]).toBe(track)
    expect(useToastStore.getState().toasts).toEqual([])
    await act(async () => button('Fermer').click())
    expect(page.querySelector('[data-testid="track-tools-window"]')).toBeNull()
    stop()
  })

  it('simplifies a straight track and shows the points before → after, then keeps working on the new track', async () => {
    const { page, open, pick, button, stop } = await mount(walk(true))
    await open()
    await pick('simplify')
    expect(page.querySelector('[data-testid="track-tool-figures"]')!.textContent).toContain('40 → 2')
    await act(async () => button('Appliquer').click())
    expect(useAppStore.getState().tracks[0].segments[0].points).toHaveLength(2)
    // the tool starts again from the new track: nothing more to simplify
    expect(page.textContent).toContain('Rien à modifier avec ces réglages.')
    stop()
  })

  it('exports the track as a GPX file named after it', async () => {
    const { open, tool, stop } = await mount(walk(true))
    await open()
    await act(async () => tool('gpx').click())
    expect(saved.names).toEqual(['Sortie.gpx'])
    expect(await saved.blobs[0].text()).toContain('<gpx version="1.1"')
    expect(useToastStore.getState().toasts[0].text).toContain('Sortie.gpx')
    stop()
  })
})
