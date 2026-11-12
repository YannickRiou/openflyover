/**
 * Tiles of the film fetched before its first frame (#401): the terrain and imagery tiles the flyover needs are asked
 * for at full speed, in the order the film needs them, so that the render waits for the graphics card rather than for
 * the network. They only go into the browser's HTTP cache (every source sends `Cache-Control`; Esri may not go into an
 * offline pack, `offline/policy.ts`): nothing is stored apart, and the render still asks the engine for each tile, so a
 * tile the cache dropped is simply fetched again. The list comes from the camera of the film (`filmTilePlan.ts`), cut at
 * a size the device's cache can hold. A dated tile that is missing is asked for from the latest photos, as the engine
 * draws it, and the tiles that failed are asked once more at the end.
 */
import type { DeviceKind } from '../core/deviceBudget'
import type { StoredTileReader } from '../terrain/fetch'

/** requests at once, all servers together (each one within its own `maxRequests`, see `preloadTiles`) */
export const PRELOAD_CONCURRENCY = 24
/** requests at once of the preload that runs alongside the render (the render's own requests come first) */
export const PRELOAD_ALONGSIDE_CONCURRENCY = 12
/** most bytes fetched ahead (estimated): about what the HTTP cache of the device keeps without dropping the first ones */
export const PRELOAD_MAX_BYTES: Record<DeviceKind, number> = { phone: 250e6, tablet: 400e6, desktop: 1e9 }

/**
 * The browser's data saver is on (`navigator.connection.saveData`: Android Chrome, Edge): the tiles are then fetched by
 * the frames that need them, not ahead. Safari, hence an iPhone and Chrome on it, does not tell.
 */
type DataSaverScope = { navigator?: { connection?: { saveData?: boolean } } }

export function dataSaverOn(scope: DataSaverScope = globalThis as DataSaverScope): boolean {
  try {
    return scope.navigator?.connection?.saveData === true
  } catch {
    return false
  }
}

export interface PreloadDeps {
  /** fetch a tile (into the HTTP cache); a failure is retried once at the end, then only counted: the render will ask again */
  download(url: string): Promise<unknown>
  /** offline packs: a tile they hold is not fetched */
  stored?: StoredTileReader | null
  isCanceled(): boolean
  onProgress?(done: number, total: number): void
  concurrency?: number
  /** most requests at once to the server of a URL (`maxRequestsFor`); none: no limit but `concurrency` */
  maxRequestsOf?(url: string): number
  /**
   * The same tile of the latest photos for a tile of dated photos (`FilmTiles.fallbacks`): fetched when the dated tile
   * fails (the year did not fly there: a 404, or a network error where the archive hides its 404), as the engine draws it.
   * It takes the place of the dated tile, whatever its server.
   */
  fallbackOf?(url: string): string | undefined
  /** this URL is no longer worth fetching (the render is past the time it is needed): passed over */
  skip?(url: string): boolean
}

export interface PreloadResult {
  done: number
  /** tiles that failed after the second try, and their URLs (for the breadcrumb) */
  failed: number
  failedUrls: string[]
  /** tiles that failed once and were asked for again, and how many of them came the second time */
  retried: number
  recovered: number
}

/**
 * Fetch `urls`, `concurrency` at a time, in their order, until the end or a cancel; then once more those that failed. A
 * server at its `maxRequestsOf` is skipped meanwhile: its requests would only wait for the browser's connections (6 to an
 * HTTP/1.1 server), holding places the other servers' tiles could use (the relief behind Esri's imagery).
 */
export async function preloadTiles(urls: readonly string[], deps: PreloadDeps): Promise<PreloadResult> {
  const first = await preloadPass(urls, deps, true)
  if (first.failedUrls.length === 0 || deps.isCanceled()) {
    return { done: first.done, failed: first.failedUrls.length, failedUrls: first.failedUrls, retried: 0, recovered: 0 }
  }
  const second = await preloadPass(first.failedUrls, deps, false)
  return {
    done: first.done,
    failed: second.failedUrls.length,
    failedUrls: second.failedUrls,
    retried: first.failedUrls.length,
    recovered: first.failedUrls.length - second.failedUrls.length,
  }
}

async function preloadPass(urls: readonly string[], deps: PreloadDeps, report: boolean): Promise<{ done: number; failedUrls: string[] }> {
  const limit = Math.max(1, deps.concurrency ?? PRELOAD_CONCURRENCY)
  /** the URLs of each server, in order, and how many of them are being fetched */
  const servers = new Map<string, { indices: number[]; next: number; running: number; max: number }>()
  urls.forEach((url, i) => {
    const host = /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? ''
    let server = servers.get(host)
    if (!server) servers.set(host, (server = { indices: [], next: 0, running: 0, max: Math.max(1, deps.maxRequestsOf?.(url) ?? Infinity) }))
    server.indices.push(i)
  })
  let running = 0
  let done = 0
  const failedUrls: string[] = []
  const fetchOne = async (url: string) => {
    try {
      const held = deps.stored?.covers(url) ? await deps.stored.get(url) : null
      if (held) return
      try {
        await deps.download(url)
      } catch (error) {
        const fallback = deps.fallbackOf?.(url)
        if (!fallback || deps.isCanceled()) throw error
        await deps.download(fallback)
      }
    } catch {
      failedUrls.push(url)
    }
  }
  await new Promise<void>((resolve) => {
    const pump = () => {
      while (running < limit && !deps.isCanceled()) {
        // the earliest URL of a server with room
        let pick: { indices: number[]; next: number; running: number } | undefined
        for (const server of servers.values()) {
          if (server.next < server.indices.length && server.running < server.max && (!pick || server.indices[server.next] < pick.indices[pick.next])) pick = server
        }
        if (!pick) break
        const server = pick
        const url = urls[server.indices[server.next++]]
        if (deps.skip?.(url)) {
          done++
          continue
        }
        server.running++
        running++
        void fetchOne(url).then(() => {
          server.running--
          running--
          done++
          if (report) deps.onProgress?.(done, urls.length)
          pump()
        })
      }
      if (running === 0) resolve()
    }
    pump()
  })
  return { done, failedUrls }
}
