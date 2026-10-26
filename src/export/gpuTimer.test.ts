import { describe, expect, it, vi } from 'vitest'
import { createGpuTimer, waitForGpu } from './gpuTimer'

/** WebGL 2 context with timer queries: each query lasts `ns`, its result ready once `ready` is set. */
function fakeGl({ extension = true } = {}) {
  const state = { ready: new Set<object>(), disjoint: false, deleted: 0, began: 0 }
  const results = new Map<object, number>()
  const gl = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    getExtension: (name: string) => (extension && name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 } : null),
    createQuery: () => ({}),
    deleteQuery: () => void state.deleted++,
    beginQuery: () => void state.began++,
    endQuery: () => undefined,
    getParameter: (p: number) => (p === 11 ? state.disjoint : null),
    getQueryParameter: (query: object, p: number) => (p === 2 ? state.ready.has(query) : results.get(query)),
  }
  return { gl, state, results }
}

describe('createGpuTimer', () => {
  it('is null without timer queries (Safari, WebGL 1)', () => {
    expect(createGpuTimer(fakeGl({ extension: false }).gl)).toBeNull()
    expect(createGpuTimer({})).toBeNull()
    expect(createGpuTimer(null)).toBeNull()
  })

  it('adds up the GPU time of the renders once their results are ready, in order', () => {
    const { gl, state, results } = fakeGl()
    const queries: object[] = []
    gl.createQuery = () => {
      const query = {}
      queries.push(query)
      return query
    }
    const timer = createGpuTimer(gl)!
    for (let i = 0; i < 3; i++) {
      timer.begin()
      timer.begin() // a render inside a render: one query only
      timer.end()
    }
    expect(state.began).toBe(3)
    queries.forEach((q, i) => results.set(q, (i + 1) * 2e6))
    state.ready.add(queries[0])
    state.ready.add(queries[2])
    timer.poll()
    // the second is not ready: the third waits behind it
    expect([timer.totalMs, timer.measured, timer.pending]).toEqual([2, 1, 2])
    state.ready.add(queries[1])
    timer.poll()
    expect([timer.totalMs, timer.measured, timer.pending]).toEqual([12, 3, 0])
    expect(state.deleted).toBe(3)
  })

  it('drops the results in flight across a GPU reset', () => {
    const { gl, state } = fakeGl()
    const timer = createGpuTimer(gl)!
    timer.begin()
    timer.end()
    state.disjoint = true
    timer.poll()
    expect([timer.measured, timer.pending, state.deleted]).toEqual([0, 0, 1])
    timer.begin()
    timer.dispose()
    expect(state.deleted).toBe(2)
  })
})

describe('waitForGpu', () => {
  it('reads one pixel, and never throws', () => {
    const readPixels = vi.fn()
    waitForGpu({ readPixels, RGBA: 6408, UNSIGNED_BYTE: 5121 })
    expect(readPixels).toHaveBeenCalledWith(0, 0, 1, 1, 6408, 5121, expect.any(Uint8Array))
    expect(() =>
      waitForGpu({
        readPixels: () => {
          throw new Error('INVALID_OPERATION')
        },
      }),
    ).not.toThrow()
    expect(() => waitForGpu(null)).not.toThrow()
    expect(() => waitForGpu({})).not.toThrow()
  })
})
