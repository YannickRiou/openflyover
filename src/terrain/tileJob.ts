/**
 * What a worker does for one terrain tile (`tile.worker.ts`, driven by `tileWorker.ts`): the elevation bitmap becomes a
 * cleaned height grid and the mesh arrays of the tile. These are the very functions of the main thread's path
 * (`decodeDem`, `buildTileMesh`), so the tile is the same wherever it is built. Pure of everything but the bitmap's pixel
 * read-back; also runs in-process (tests, the engine without workers).
 */
import type { BuildTileGeometryOptions, DemCleanOptions, DemEncoding, HeightGrid, LonLat, TileKey } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { decodeDem } from './dem'
import { buildTileMesh, type TileMeshArrays } from './mesh'

export interface TileJob {
  bitmap: ImageBitmap
  encoding: DemEncoding
  clean?: DemCleanOptions
  /** ground width of the tile, metres (see `decodeDem`) */
  tileWidthM: number
  key: TileKey
  /** origin of the engine's local frame, which the worker makes again (`createLocalFrame`) */
  origin: LonLat
  geometry: BuildTileGeometryOptions
}

export interface TileResult {
  grid: HeightGrid
  mesh: TileMeshArrays
}

export function runTileJob(job: TileJob): TileResult {
  const grid = decodeDem(job.bitmap, job.encoding, job.clean, job.tileWidthM)
  const frame = createLocalFrame(job.origin.lon, job.origin.lat)
  return { grid, mesh: buildTileMesh(job.key, grid, frame, job.geometry) }
}

/** The buffers of a result, to hand over to the page instead of copying them. */
export function resultBuffers({ grid, mesh }: TileResult): ArrayBuffer[] {
  return [grid.data, mesh.positions, mesh.normals, mesh.uvs, mesh.index].map((array) => array.buffer as ArrayBuffer)
}
