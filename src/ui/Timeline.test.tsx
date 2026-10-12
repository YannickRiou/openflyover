// @vitest-environment jsdom
import { Profiler, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useExportStore } from '../export/store'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { Timeline } from './Timeline'

describe('Timeline', () => {
  it('does not render again when the export moves the playhead, and follows it again afterwards', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    let commits = 0
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <Profiler id="timeline" onRender={() => commits++}>
          <Timeline />
        </Profiler>,
      ),
    )
    const time = () => host.querySelector('.film-tl__time strong')?.textContent
    const start = time()
    expect(start).toMatch(/^\d\d:\d\d,\d$/)

    await act(async () => useExportStore.setState({ phase: 'rendering' }))
    const before = commits
    for (const p of [0.2, 0.4, 0.6]) await act(async () => useAppStore.getState().setProgress(p))
    expect(commits).toBe(before)
    expect(time()).toBe(start)

    await act(async () => useExportStore.setState({ phase: 'done' }))
    expect(time()).not.toBe(start)
    act(() => root.unmount())
  })
})
