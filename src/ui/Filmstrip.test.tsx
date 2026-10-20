// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { MediaAsset } from '../film/media'
import { filmstripTimes, readFilmstrip } from '../film/video'
import { FILMSTRIP_TILE_PX, Filmstrip, filmstripCount } from './Filmstrip'

vi.mock('../film/video', async (original) => ({
  ...(await original<typeof import('../film/video')>()),
  readFilmstrip: vi.fn(async (_asset: MediaAsset, _from: number, _to: number, count: number) => Array.from({ length: count }, (_, i) => `data:image/jpeg;base64,${i}`)),
}))

describe('filmstrip', () => {
  it('times: the middle of each equal part of the stretch', () => {
    expect(filmstripTimes(0, 10, 4)).toEqual([1.25, 3.75, 6.25, 8.75])
    expect(filmstripTimes(2, 4, 1)).toEqual([3])
    expect(filmstripTimes(5, 5, 2)).toEqual([5, 5])
    expect(filmstripTimes(0, 8, 0)).toEqual([4])
  })

  it('the count of tiles: the largest step that fits, none for a narrow block', () => {
    expect(filmstripCount(FILMSTRIP_TILE_PX * 2 - 1)).toBe(0)
    expect(filmstripCount(FILMSTRIP_TILE_PX * 2)).toBe(2)
    expect(filmstripCount(FILMSTRIP_TILE_PX * 5)).toBe(4)
    expect(filmstripCount(FILMSTRIP_TILE_PX * 9)).toBe(8)
    expect(filmstripCount(FILMSTRIP_TILE_PX * 100)).toBe(12)
    expect(filmstripCount(0)).toBe(0)
  })

  it('draws the frames behind the block once read, once per clip, stretch and count; nothing for a narrow block or no clip', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const asset: MediaAsset = { data: 'data:video/mp4;base64,AA==', width: 1920, height: 1080, durationS: 20 }
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<Filmstrip asset={asset} inS={0} outS={20} count={4} />))
    expect(host.querySelectorAll('[data-testid="filmstrip"] img')).toHaveLength(4)
    expect(readFilmstrip).toHaveBeenCalledTimes(1)
    // the same clip, stretch and count again: from the cache
    await act(async () => root.render(<Filmstrip asset={asset} inS={0} outS={20} count={4} />))
    await act(async () => root.render(<Filmstrip asset={asset} inS={0} outS={20} count={8} />))
    expect(host.querySelectorAll('[data-testid="filmstrip"] img')).toHaveLength(8)
    expect(readFilmstrip).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<Filmstrip asset={asset} inS={0} outS={20} count={0} />))
    expect(host.querySelector('[data-testid="filmstrip"]')).toBeNull()
    await act(async () => root.render(<Filmstrip asset={undefined} inS={0} outS={20} count={4} />))
    expect(host.querySelector('[data-testid="filmstrip"]')).toBeNull()
    act(() => root.unmount())
  })
})
