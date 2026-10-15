// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExportStore } from '../export/store'
import type { UpdateCheck } from '../platform/updater'
import { UpdatesSection } from './UpdatesSection'

const platform = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(async () => undefined),
  ask: vi.fn(async () => 'yes'),
  storage: { get: () => null, set: () => true, remove: () => undefined, keys: () => [] },
}))
vi.mock('../platform', () => ({ getPlatform: () => platform }))

let host: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(async () => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<UpdatesSection />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.clearAllMocks()
  useExportStore.setState({ phase: 'idle' })
})

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!
const status = () => host.querySelector('[role="status"]')?.textContent ?? null
const check = async (result: UpdateCheck) => {
  platform.checkForUpdate.mockResolvedValueOnce(result)
  await act(async () => button('Rechercher une mise à jour').click())
}
const AVAILABLE: UpdateCheck = { status: 'available', update: { version: '2.1.0', date: '2026-10-20T08:00:00Z', notes: '- export plus rapide' } }

describe('UpdatesSection', () => {
  it('checks nothing until the button is pressed', () => {
    expect(platform.checkForUpdate).not.toHaveBeenCalled()
    expect(status()).toBeNull()
    expect(host.textContent).toContain('Version installée')
    expect(host.textContent).toContain('uniquement quand vous appuyez')
  })

  it.each([
    ['current', { status: 'current' }, 'OpenFlyover est à jour.'],
    ['unavailable', { status: 'unavailable' }, "Les mises à jour ne sont pas disponibles dans cette version de l'application."],
    ['offline', { status: 'offline' }, 'GitHub est injoignable : vérifiez la connexion Internet.'],
    ['error', { status: 'error', message: 'signature invalide' }, 'Échec : signature invalide'],
  ] as const)('says %s', async (_name, result, text) => {
    await check(result)
    expect(status()).toBe(text)
    expect(button('Installer et redémarrer')).toBeUndefined()
  })

  it('announces the version with its notes and offers the installation', async () => {
    await check(AVAILABLE)
    expect(status()).toContain('La version 2.1.0 est disponible.')
    expect(host.textContent).toContain('- export plus rapide')
    expect(button('Installer et redémarrer').hasAttribute('disabled')).toBe(false)
  })

  it('asks first, then installs; a refusal installs nothing', async () => {
    await check(AVAILABLE)
    platform.ask.mockResolvedValueOnce('cancel')
    await act(async () => button('Installer et redémarrer').click())
    expect(platform.installUpdate).not.toHaveBeenCalled()
    await act(async () => button('Installer et redémarrer').click())
    expect(platform.ask).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Installer la mise à jour ?', yes: 'Installer et redémarrer' }))
    expect(platform.installUpdate).toHaveBeenCalledOnce()
  })

  it('shows the failure of an installation', async () => {
    await check(AVAILABLE)
    platform.installUpdate.mockRejectedValueOnce('disk full')
    await act(async () => button('Installer et redémarrer').click())
    expect(status()).toContain('Échec')
  })

  it('does not install while an export runs', async () => {
    await check(AVAILABLE)
    await act(async () => useExportStore.setState({ phase: 'rendering' }))
    expect(button('Installer et redémarrer').hasAttribute('disabled')).toBe(true)
    expect(host.textContent).toContain('Un export est en cours')
  })
})
