/** Worker of `tileWorker.ts`: runs `runTileJob` for each message and sends the buffers back. */
import { createCanvas } from './dem'
import { meshBuffers, resultBuffers, runMeshJob, runTileJob, type MeshJob, type TileJob, type TileResult } from './tileJob'
import type { TileMeshArrays } from './mesh'

interface Reply {
  id: number
  result?: TileResult
  mesh?: TileMeshArrays
  failed?: true
  unsupported?: true
}
const reply = (message: Reply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

/** Whether this worker can read pixels back (OffscreenCanvas 2D): not every WebView can; checked once. */
let canReadPixels: boolean | undefined
const readsPixels = () => (canReadPixels ??= typeof OffscreenCanvas !== 'undefined' && createCanvas(1, 1).getContext('2d') !== null)

self.onmessage = (event: MessageEvent<{ id: number; job?: TileJob; meshJob?: MeshJob }>) => {
  const { id, job, meshJob } = event.data
  if (meshJob) {
    // meshing a grid again: pure typed-array code, no pixel read-back
    try {
      const mesh = runMeshJob(meshJob)
      reply({ id, mesh }, meshBuffers(mesh))
    } catch {
      reply({ id, failed: true })
    }
    return
  }
  if (!job) return
  try {
    if (!readsPixels()) return reply({ id, unsupported: true })
    const result = runTileJob(job)
    reply({ id, result }, resultBuffers(result))
  } catch {
    // the page builds the tile itself: it gets the real error of a bad tile, or builds it fine
    reply({ id, failed: true })
  } finally {
    job.bitmap.close()
  }
}
