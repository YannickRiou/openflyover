// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoEncoderKind } from '../platform/platform'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { ExportPanel } from './ExportPanel'
import { setPreferences } from './preferences'

// the video encoder and the folder picker of the device, as each test sets them
const device = vi.hoisted(() => ({ videoEncoder: 'webcodecs' as VideoEncoderKind, folders: true }))
vi.mock('../platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform')>()
  return {
    ...original,
    getPlatform: () => {
      const web = original.getPlatform()
      return {
        ...web,
        capabilities: { ...web.capabilities, videoEncoder: device.videoEncoder, isDesktop: device.folders, canStreamToDisk: device.folders },
      }
    },
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  setPreferences({ uiMode: 'expert' })
  useAppStore.setState({ settings: DEFAULT_SETTINGS })
})

afterEach(() => {
  device.videoEncoder = 'webcodecs'
  device.folders = true
  document.body.innerHTML = ''
})

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<ExportPanel />))
  // the « Vidéo » mode: the section shown
  const video = () => host.querySelector<HTMLElement>('section:not([hidden])')!
  const radio = (label: string, within: HTMLElement = video()) =>
    [...within.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.labels?.[0]?.textContent === label)
  // the output of the film (« Sortie »), apart from the mode switch, whose « Vidéo » has the same name
  const output = (label: string) => radio(label, video().querySelector<HTMLElement>('[role="radiogroup"][aria-label="Sortie"]')!)
  const rows = () => [...video().querySelectorAll('[data-testid="setting-row-label"]')].map((r) => r.textContent)
  return { host, video, radio, output, rows }
}

const setVideo = (patch: Partial<typeof DEFAULT_SETTINGS.video>) =>
  act(async () => useAppStore.getState().setSetting('video', { ...useAppStore.getState().settings.video, ...patch }))

describe('ExportPanel, « Vidéo »: what each output sets', () => {
  it('one radio group « Vidéo » / « Séquence d’images PNG » / « Habillage seul », one choice at a time', async () => {
    const { output } = await mount()
    expect(output('Vidéo')!.checked).toBe(true)
    await act(async () => output('Séquence d’images PNG')!.click())
    expect(output('Séquence d’images PNG')!.checked).toBe(true)
    await act(async () => output('Habillage seul (fond transparent)')!.click())
    expect(output('Habillage seul (fond transparent)')!.checked).toBe(true)
    expect(output('Séquence d’images PNG')!.checked).toBe(false)
    await act(async () => output('Vidéo')!.click())
    expect(output('Vidéo')!.checked).toBe(true)
    expect(output('Habillage seul (fond transparent)')!.checked).toBe(false)
  })

  it('without a folder picker, « Séquence d’images PNG » is disabled and a sentence says why', async () => {
    device.folders = false
    const { output, video } = await mount()
    expect(output('Séquence d’images PNG')!.disabled).toBe(true)
    expect(video().textContent).toContain('Choisir un dossier n’est pas possible dans ce navigateur')
  })

  it('« Habillage seul » hides the codec (always VP9) but keeps the bitrate and the quality that sets it', async () => {
    const { radio, output, rows, video } = await mount()
    expect(rows()).toContain('Codec')
    await act(async () => output('Habillage seul (fond transparent)')!.click())
    expect(rows()).not.toContain('Codec')
    expect(radio('Selon la qualité')!.disabled).toBe(false)
    expect(radio('Standard')).toBeDefined()
    expect(video().textContent).toContain('la qualité ne règle que le débit vidéo')
    // a bitrate set by hand: its slider shows, the quality then sets nothing
    await setVideo({ manualBitrate: true })
    expect(video().textContent).toContain('Débit manuel')
    expect(radio('Standard')).toBeUndefined()
    expect(video().textContent).toContain('la qualité de rendu ne compte pas')
  })

  it('without any video encoder, hides « Encodage » and keeps the alert', async () => {
    device.videoEncoder = null
    const { video } = await mount()
    expect(video().textContent).not.toContain('Encodage')
    expect(video().querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('ExportPanel, « Plusieurs formats »', () => {
  it('« Un film par trace » disabled says why in a visible sentence', async () => {
    device.folders = false
    const { host, radio } = await mount()
    await act(async () => radio('Plusieurs formats')!.click())
    const batch = host.querySelector<HTMLElement>('section:not([hidden])')!
    expect(radio('Un film par trace', batch)!.disabled).toBe(true)
    expect(batch.textContent).toContain('Un film par trace » écrit dans un dossier')
  })
})
