/**
 * What the pool of tile workers (`tileWorker.ts`) did, for the diagnostic report. Kept apart so that reading it loads no
 * worker: on a phone the page cannot otherwise tell whether the tiles are built off the main thread or fell back to it.
 */
export type TileWorkerState = 'untried' | 'active' | 'unsupported' | 'dropped'

export interface TileWorkerStatus {
  state: TileWorkerState
  /** workers in the pool while it is active */
  workers: number
  /** tiles built by a worker and used */
  built: number
}

const status: TileWorkerStatus = { state: 'untried', workers: 0, built: 0 }

export const tileWorkerStatus = (): TileWorkerStatus => ({ ...status })

export function noteWorkersStarted(workers: number): void {
  status.state = 'active'
  status.workers = workers
}

/** No Worker, OffscreenCanvas or ImageBitmap here, or the pool could not be made: every tile is built by the page. */
export function noteWorkersUnsupported(): void {
  status.state = 'unsupported'
  status.workers = 0
}

/** The pool was given up (a worker died or gave another result than the page): every later tile is built by the page. */
export function noteWorkersDropped(): void {
  if (status.state !== 'active') return
  status.state = 'dropped'
  status.workers = 0
}

export function noteTileBuilt(): void {
  status.built++
}
