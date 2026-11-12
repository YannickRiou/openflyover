import { describe, expect, it } from 'vitest'
import { dataSaverOn, preloadTiles } from './tilePreload'

describe('dataSaverOn', () => {
  it('is the browser\'s data saver, false where the browser does not tell (Safari) or reads fail', () => {
    expect(dataSaverOn({ navigator: { connection: { saveData: true } } })).toBe(true)
    expect(dataSaverOn({ navigator: { connection: { saveData: false } } })).toBe(false)
    expect(dataSaverOn({ navigator: {} })).toBe(false)
    expect(dataSaverOn({})).toBe(false)
    expect(dataSaverOn({ navigator: { get connection(): never { throw new Error('denied') } } })).toBe(false)
  })
})

describe('preloadTiles', () => {
  it('fetches every tile a few at a time, skips those of an offline pack, and only counts the failures', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://t/${i}`)
    let running = 0
    let most = 0
    const fetched: string[] = []
    const progress: number[] = []
    const result = await preloadTiles(urls, {
      download: async (url) => {
        running++
        most = Math.max(most, running)
        await new Promise((r) => setTimeout(r, 1))
        running--
        if (url.endsWith('/7')) throw new Error('404')
        fetched.push(url)
      },
      stored: { covers: (url) => url.endsWith('/3'), get: async () => new Blob(['x']) },
      isCanceled: () => false,
      onProgress: (done) => progress.push(done),
      concurrency: 4,
    })
    expect(result).toMatchObject({ done: 20, failed: 1, failedUrls: ['https://t/7'], retried: 1, recovered: 0 })
    expect(most).toBe(4)
    expect(fetched).toHaveLength(18)
    expect(fetched).not.toContain('https://t/3')
    expect(progress.at(-1)).toBe(20)
  })

  it('keeps a server within its own limit, the others taking the free places', async () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://${i % 2 ? 'slow' : 'fast'}/${i}`)
    const running = { slow: 0, fast: 0 }
    const most = { slow: 0, fast: 0, all: 0 }
    const result = await preloadTiles(urls, {
      download: async (url) => {
        const host = url.includes('slow') ? 'slow' : 'fast'
        running[host]++
        most[host] = Math.max(most[host], running[host])
        most.all = Math.max(most.all, running.slow + running.fast)
        await new Promise((r) => setTimeout(r, host === 'slow' ? 5 : 1))
        running[host]--
      },
      isCanceled: () => false,
      concurrency: 6,
      maxRequestsOf: (url) => (url.includes('slow') ? 2 : Infinity),
    })
    expect(result).toMatchObject({ done: 40, failed: 0, retried: 0 })
    expect(most.slow).toBe(2)
    expect(most.fast).toBe(4)
    expect(most.all).toBe(6)
  })

  it('asks the latest photos for a dated tile that fails, and counts a failure only when both fail', async () => {
    const urls = ['https://dated/1', 'https://dated/2', 'https://dated/3', 'https://plain/4']
    const asked: string[] = []
    const result = await preloadTiles(urls, {
      download: async (url) => {
        asked.push(url)
        // dated tiles 1 and 3 do not exist, and neither does the latest photo of 3
        if (url === 'https://dated/1' || url === 'https://dated/3' || url === 'https://latest/3') throw new Error('404')
      },
      fallbackOf: (url) => (url.startsWith('https://dated/') ? url.replace('dated', 'latest') : undefined),
      isCanceled: () => false,
      concurrency: 1,
    })
    expect(asked).toContain('https://latest/1')
    expect(asked).not.toContain('https://latest/2')
    expect(result.failedUrls).toEqual(['https://dated/3'])
  })

  it('asks once more at the end for the tiles that failed, and reports those that still fail', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://t/${i}`)
    const calls = new Map<string, number>()
    const result = await preloadTiles(urls, {
      download: async (url) => {
        const n = (calls.get(url) ?? 0) + 1
        calls.set(url, n)
        // 1 fails once (a hiccup), 4 always
        if ((url.endsWith('/1') && n === 1) || url.endsWith('/4')) throw new Error('503')
      },
      isCanceled: () => false,
      concurrency: 2,
    })
    expect(calls.get('https://t/1')).toBe(2)
    expect(calls.get('https://t/4')).toBe(2)
    expect(calls.get('https://t/0')).toBe(1)
    expect(result).toMatchObject({ done: 6, retried: 2, recovered: 1, failed: 1, failedUrls: ['https://t/4'] })
  })

  it('does not retry once the export is canceled', async () => {
    let calls = 0
    const result = await preloadTiles(['https://t/1'], {
      download: async () => {
        calls++
        throw new Error('503')
      },
      isCanceled: () => calls >= 1,
    })
    expect(calls).toBe(1)
    expect(result.retried).toBe(0)
  })

  it('stops asking once the export is canceled', async () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://t/${i}`)
    let calls = 0
    const result = await preloadTiles(urls, { download: async () => void calls++, isCanceled: () => calls >= 5, concurrency: 1 })
    expect(calls).toBe(5)
    expect(result.done).toBe(5)
  })

  it('passes over the tiles the render is already past', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://t/${i}`)
    const fetched: string[] = []
    const result = await preloadTiles(urls, { download: async (url) => void fetched.push(url), isCanceled: () => false, skip: (url) => Number(url.slice(10)) < 4 })
    expect(fetched).toEqual(urls.slice(4))
    expect(result.done).toBe(10)
  })
})
