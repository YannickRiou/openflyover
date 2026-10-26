// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { resetAppStore, useAppStore } from '../state/store'
import { OverlayCanvas } from './OverlayCanvas'

let root: Root | null = null

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { get: () => 390 })
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { get: () => 844 })
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_, key) => () => (key === 'measureText' ? { width: 10 } : key === 'getTransform' ? { a: 1, b: 0 } : undefined), set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  vi.stubGlobal('devicePixelRatio', 3)
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  resetAppStore()
})

describe('live overlay canvas', () => {
  it('is no sharper than the 3D view: pixel ratio 3 gives 2', async () => {
    const points: TrackPoint[] = Array.from({ length: 10 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.001, ele: 1000 + i }))
    useAppStore.getState().addTracks([buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })])
    const host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    await act(async () => root!.render(<OverlayCanvas />))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    const canvas = host.querySelector('canvas')!
    expect(canvas.width).toBe(780)
    expect(canvas.height).toBe(1688)
  })
})
