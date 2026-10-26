/**
 * A small pool of module workers (`tile.worker.ts`) that decode and mesh the terrain tiles, so a tile arriving during
 * the film costs the page little more than the attachment of its buffers. Each worker handles one tile at a time.
 * `buildTileOffThread` resolves with undefined where a worker cannot do it (no Worker or OffscreenCanvas, a test, an
 * image that is not an ImageBitmap, a worker that fails): the caller then builds the tile on the main thread, so the
 * result is the same and the only difference is where the time is spent. A worker that dies is dropped for good.
 * The first tile of the session is also built by the page and the two compared (`verify`): a WebView whose worker reads
 * pixels back differently from the page (not every one was tried) would otherwise corrupt the relief unseen.
 */
import { BITMAP_OPTIONS } from './fetch'
import { runTileJob, type TileJob, type TileResult } from './tileJob'

const MAX_WORKERS = 4

interface Slot {
  worker: Worker
  busy: number
}

/** undefined: not tried yet, null: unavailable */
let slots: Slot[] | null | undefined
let nextId = 0
const pending = new Map<number, { slot: Slot; done: (result?: TileResult) => void }>()

/** Drop the workers for good; the tiles they still hold are built by the page. */
function retire(): void {
  const dead = slots
  slots = null
  dead?.forEach(({ worker }) => worker.terminate())
  for (const { done } of pending.values()) done()
  pending.clear()
}

function start(): Slot[] | null {
  const supported = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof ImageBitmap !== 'undefined'
  if (!supported) return null
  try {
    const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1))
    return Array.from({ length: count }, () => {
      const worker = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ id: number; result?: TileResult; unsupported?: true }>) => {
        const { id, result, unsupported } = event.data
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        entry.slot.busy--
        entry.done(result)
        if (unsupported) retire()
      }
      worker.onerror = retire
      worker.onmessageerror = retire
      return { worker, busy: 0 }
    })
  } catch {
    return null
  }
}

/** The first tile a worker built, checked against the page's own (`verify`): null when they agree, else the page's tile. */
let firstTile: Promise<TileResult | null> | undefined

const sameTile = (a: TileResult, b: TileResult) =>
  a.grid.width === b.grid.width &&
  a.grid.height === b.grid.height &&
  a.grid.data.length === b.grid.data.length &&
  a.grid.data.every((h, i) => Object.is(h, b.grid.data[i])) && // NaN (no data) in the same places
  Object.is(a.mesh.minHeight, b.mesh.minHeight) &&
  Object.is(a.mesh.maxHeight, b.mesh.maxHeight)

/** A worker that does not give what the page gives is dropped for good: the page's tile stands, and so do the next ones. */
async function verify(job: TileJob, fromWorker: TileResult): Promise<TileResult | null> {
  const own = runTileJob(job)
  if (sameTile(own, fromWorker)) return null
  console.warn('[terrain] tuiles décodées en arrière-plan : le résultat diffère de celui du thread principal, travail en arrière-plan abandonné')
  retire()
  return own
}

export async function buildTileOffThread(job: TileJob): Promise<TileResult | undefined> {
  const result = await viaWorker(job)
  if (!result) return undefined
  const first = firstTile === undefined
  firstTile ??= verify(job, result)
  try {
    const own = await firstTile
    return own === null ? result : first ? own : undefined
  } catch {
    // the page cannot build this tile itself: the next one is the check (and this one fails where the engine builds it)
    firstTile = undefined
    return undefined
  }
}

async function viaWorker(job: TileJob): Promise<TileResult | undefined> {
  if (slots === undefined) slots = start()
  if (!slots || !(job.bitmap instanceof ImageBitmap)) return undefined
  try {
    // The fetcher keeps its bitmap (cache): the worker gets a copy, handed over. Cheaper for the page than cloning it.
    const bitmap = await createImageBitmap(job.bitmap, BITMAP_OPTIONS)
    const live = slots // the pool may have been dropped meanwhile
    if (!live) return undefined
    const slot = live.reduce((best, s) => (s.busy < best.busy ? s : best))
    return await new Promise<TileResult | undefined>((resolve) => {
      const id = nextId++
      pending.set(id, { slot, done: resolve })
      slot.busy++
      try {
        slot.worker.postMessage({ id, job: { ...job, bitmap } }, [bitmap])
      } catch {
        pending.delete(id)
        slot.busy--
        bitmap.close()
        resolve(undefined)
      }
    })
  } catch {
    return undefined
  }
}
