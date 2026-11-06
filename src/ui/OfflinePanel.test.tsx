// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OfflinePanel } from './OfflinePanel'

// a device that stores tiles; the terrain source allowed offline or not, as each test sets it
const terrain = vi.hoisted(() => ({ allowed: true }))
vi.mock('../platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform')>()
  return { ...original, getPlatform: () => ({ ...original.getPlatform(), tileCache: {} }) }
})
vi.mock('../offline/policy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../offline/policy')>()
  return {
    ...original,
    offlinePolicy: (id: string) => (id === 'mapterhorn' ? { ...original.offlinePolicy(id), allowed: terrain.allowed } : original.offlinePolicy(id)),
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  terrain.allowed = true
  document.body.innerHTML = ''
})

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<OfflinePanel />))
  return host
}

describe('OfflinePanel', () => {
  it('hides the corridor width when the terrain may not be stored, and says why', async () => {
    expect((await mount()).textContent).toContain('Largeur du couloir')
    document.body.innerHTML = ''
    terrain.allowed = false
    const host = await mount()
    expect(host.textContent).not.toContain('Largeur du couloir')
    expect(host.textContent).toContain('non téléchargeable')
  })
})
