import { afterEach, describe, expect, it, vi } from 'vitest'
import { Frustum, Matrix4, Mesh, PerspectiveCamera, Texture, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import type {
  HeightGrid,
  ImagerySource,
  LonLatBounds,
  TerrainEngineOptions,
  TerrainSource,
  TileFetcher,
  TileKey,
} from '../core/types'
import { DEFAULT_SETTLE, settle as settleView } from '../export/capture'
import { createLocalFrame } from '../geo/ellipsoid'
import { tileKeyString, tilesForBounds, zoomForTileBudget } from '../geo/mercator'
import { DEFAULT_TUNING, LOD_STEP, NO_IMAGERY_COLOR, createTerrainEngine, type EngineDeps, type EngineTuning, type HeightFieldLike } from './engine'
import { TileFetchError } from './fetch'

// The engine wires these as defaults; the tests inject every dependency, so keep them inert.
// `./dem` is NOT mocked: mesh.ts needs its real `sampleGrid`, and `decodeDem` is always injected.
vi.mock('./fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fetch')>()),
  createTileFetcher: vi.fn(() => ({ fetchBitmap: vi.fn(), stats: {}, clear: vi.fn() })),
}))
vi.mock('./heightField', () => ({ HeightField: class {} }))
vi.mock('./imagery', () => ({ loadImageryTexture: vi.fn() }))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TERRAIN: TerrainSource = {
  kind: 'terrain',
  id: 'fake-dem',
  name: 'DEM factice',
  urlTemplate: 'https://dem.test/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 15,
  tileSize: 256,
  encoding: 'terrarium',
  attribution: 'test',
}
const TERRAIN_B: TerrainSource = { ...TERRAIN, id: 'fake-dem-b', urlTemplate: 'https://dem-b.test/{z}/{x}/{y}.png' }
const IMAGERY: ImagerySource = {
  kind: 'imagery',
  id: 'fake-ortho',
  name: 'Ortho factice',
  urlTemplate: 'https://ortho.test/{z}/{x}/{y}.jpg',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  attribution: 'test',
}
/** ~46 km x 44 km around the Mont Blanc massif */
const AREA: LonLatBounds = { west: 6.6, south: 45.7, east: 7.2, north: 46.1 }
const FRAME = createLocalFrame(6.9, 45.9)
const ROOT_ZOOM = zoomForTileBudget(AREA, 16, TERRAIN.minZoom, TERRAIN.maxZoom)
const ROOT_KEYS = tilesForBounds(AREA, ROOT_ZOOM)

interface FakeDeps extends EngineDeps {
  /** DEM URLs requested, in order; `signals[i]` is the AbortSignal passed with `fetched[i]` */
  fetched: string[]
  signals: AbortSignal[]
  textures: Texture[]
  /** textures on which `dispose()` was called */
  disposedTextures: Texture[]
  field: Map<string, HeightGrid>
}

interface FakeDepsOptions {
  /** reject DEM fetches whose URL matches */
  failDem?: (url: string) => boolean
  /** error used for a rejected DEM fetch (default: a plain, retryable Error) */
  demError?: (url: string) => Error
  /** reject imagery loads */
  failImagery?: boolean
  /** hold every DEM fetch until `release()` is called */
  deferDem?: boolean
}

function createFakeDeps(options: FakeDepsOptions = {}): FakeDeps & { release: () => void } {
  const fetched: string[] = []
  const textures: Texture[] = []
  const disposedTextures: Texture[] = []
  const signals: AbortSignal[] = []
  const field = new Map<string, HeightGrid>()
  const pending: Array<() => void> = []

  const fetcher: TileFetcher = {
    fetchBitmap: vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
      fetched.push(url)
      if (opts?.signal) signals.push(opts.signal)
      const run = (): Promise<ImageBitmap> => {
        if (opts?.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
        if (options.failDem?.(url)) return Promise.reject(options.demError?.(url) ?? new Error(`HTTP 404 ${url}`))
        return Promise.resolve({ width: 4, height: 4, close() {} } as unknown as ImageBitmap)
      }
      if (!options.deferDem) return run()
      return new Promise<ImageBitmap>((resolve, reject) => {
        pending.push(() => run().then(resolve, reject))
      })
    }),
    stats: { inflight: 0, queued: 0, cached: 0, failed: 0 },
    clear: vi.fn(),
  }
  const decodeDem = vi.fn((): HeightGrid => ({ width: 4, height: 4, data: new Float32Array(16) }))
  const loadImageryTexture = vi.fn(async () => {
    if (options.failImagery) throw new Error('imagery down')
    const texture = new Texture()
    texture.addEventListener('dispose', () => disposedTextures.push(texture))
    textures.push(texture)
    return texture
  })
  const heightField: HeightFieldLike = {
    set: (key: TileKey, grid: HeightGrid) => {
      field.set(tileKeyString(key), grid)
    },
    delete: (key: TileKey) => field.delete(tileKeyString(key)),
    has: (key: TileKey) => field.has(tileKeyString(key)),
    sampleHeight: vi.fn((lon: number, lat: number) => (field.size > 0 ? lon + lat : undefined)),
    prune: vi.fn((max: number) => {
      let evicted = 0
      while (field.size > max) {
        const first = field.keys().next().value
        if (first === undefined) break
        field.delete(first)
        evicted++
      }
      return evicted
    }),
    clear: vi.fn(() => field.clear()),
  }
  return {
    fetcher,
    decodeDem,
    loadImageryTexture,
    heightField,
    fetched,
    textures,
    disposedTextures,
    signals,
    field,
    release: () => {
      const runs = pending.splice(0)
      for (const run of runs) run()
    },
  }
}

function makeOptions(partial: Partial<TerrainEngineOptions> = {}): TerrainEngineOptions {
  return {
    frame: FRAME,
    terrain: TERRAIN,
    imagery: IMAGERY,
    imageryZoomOffset: 1,
    area: AREA,
    exaggeration: 1,
    errorTargetPx: 8,
    segments: 16,
    ...partial,
  }
}

/** Camera looking straight down at the frame origin from `heightM`. */
function cameraAbove(heightM: number, fov = 50): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, 1, 1, 5e6)
  camera.position.set(0, heightM, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(new Vector3(0, 0, 0))
  camera.updateProjectionMatrix()
  return camera
}

function viewFrustum(camera: PerspectiveCamera): Frustum {
  camera.updateMatrixWorld()
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
}

/** Let every pending promise chain settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function meshesOf(engine: { group: { children: unknown[] } }): Mesh[] {
  return engine.group.children.filter((o): o is Mesh => o instanceof Mesh)
}

const engines: Array<{ dispose(): void }> = []
function engineWith(deps: EngineDeps, options: Partial<TerrainEngineOptions> = {}, tuning: Partial<EngineTuning> = {}) {
  const engine = createTerrainEngine(makeOptions(options), deps, tuning)
  engines.push(engine)
  return engine
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTerrainEngine', () => {
  it('exposes a group named terrain and empty stats before the first update', () => {
    const engine = engineWith(createFakeDeps())
    expect(engine.group.name).toBe('terrain')
    expect(engine.group.children).toHaveLength(0)
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0, pendingVisibleTiles: 0, missingVisibleTiles: 0, lodFactor: 1 })
  })

  it('counts apart the tiles the view waits for (pendingVisibleTiles excludes culled tiles)', async () => {
    const deps = createFakeDeps({ deferDem: true })
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 })
    const camera = cameraAbove(600_000, 2) // narrow view: most roots are culled but still queued

    engine.update(camera, 1000)
    expect(engine.stats.pendingVisibleTiles).toBeGreaterThan(0)
    expect(engine.stats.pendingVisibleTiles).toBeLessThan(engine.stats.pendingTiles)

    for (let i = 0; i < 6 && engine.stats.pendingVisibleTiles! > 0; i++) {
      deps.release()
      await settle()
      engine.update(camera, 1000)
    }
    expect(engine.stats.pendingVisibleTiles).toBe(0)
  })

  it('prefetches the tiles of another camera after the view, within its share of the load budget', async () => {
    const deps = createFakeDeps({ deferDem: true })
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 4 }, { maxConcurrentLoads: 24, prefetchLoadShare: 0.5 })
    const high = cameraAbove(600_000)
    engine.update(high, 1000)
    for (let i = 0; i < 8 && engine.stats.pendingTiles > 0; i++) {
      deps.release()
      await settle()
      engine.update(high, 1000)
    }
    expect(engine.stats.pendingVisibleTiles).toBe(0)
    const before = { ...engine.stats }
    const visibleBefore = meshesOf(engine).filter((m) => m.visible).length
    const fetchedBefore = deps.fetched.length

    const started = engine.prefetch?.(cameraAbove(4000), 1000) ?? 0
    expect(started).toBeGreaterThan(0)
    expect(started).toBeLessThanOrEqual(12)
    const prefetched = deps.fetched.slice(fetchedBefore)
    expect(prefetched).toHaveLength(started)
    const zoomOf = (url: string) => Number(url.split('/')[3])
    const deepestBefore = Math.max(...deps.fetched.slice(0, fetchedBefore).map(zoomOf))
    for (const url of prefetched) expect(zoomOf(url)).toBeGreaterThan(deepestBefore)
    // ranked after any request of the current view
    const ranks = (deps.fetcher.fetchBitmap as ReturnType<typeof vi.fn>).mock.calls.slice(fetchedBefore).map((c) => c[1]?.priority)
    for (const rank of ranks) expect(rank).toBeGreaterThanOrEqual(1_000_000)
    // nothing drawn or reported changes
    expect(engine.stats).toEqual(before)
    expect(meshesOf(engine).filter((m) => m.visible)).toHaveLength(visibleBefore)

    // a second call does not exceed the share while those loads are in flight
    expect(engine.prefetch?.(cameraAbove(4000), 1000)).toBe(0)
  })

  it('loads the root tiles after a few updates and renders them', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)

    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(ROOT_KEYS.length)
    expect(deps.fetched).toHaveLength(ROOT_KEYS.length)
    for (const key of ROOT_KEYS) expect(deps.fetched).toContain(`https://dem.test/${key.z}/${key.x}/${key.y}.png`)

    await settle()
    engine.update(camera, 1000)

    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.visibleTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(engine.stats.failedTiles).toBe(0)
    const meshes = meshesOf(engine)
    expect(meshes).toHaveLength(ROOT_KEYS.length)
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(true)
      expect(mesh.name).toMatch(new RegExp(`^${ROOT_ZOOM}/`))
      const material = mesh.material as MeshStandardMaterial
      expect(material.map).toBeInstanceOf(Texture)
      expect(material.roughness).toBe(1)
      expect(material.metalness).toBe(0)
      expect(material.wireframe).toBe(false)
    }
    expect(deps.decodeDem).toHaveBeenCalledTimes(ROOT_KEYS.length)
    expect(deps.loadImageryTexture).toHaveBeenCalledTimes(ROOT_KEYS.length)
    expect(deps.field.size).toBe(ROOT_KEYS.length)
  })

  it('refines by replacement: the parent disappears once its children are ready', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { errorTargetPx: 1, maxZoom: ROOT_ZOOM + 1 })
    const camera = cameraAbove(4000)

    engine.update(camera, 1000)
    // unloaded roots already want refinement, so children are queued right behind them
    expect(engine.stats.pendingTiles).toBeGreaterThan(ROOT_KEYS.length)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.visibleTiles).toBeGreaterThan(0)

    await settle()
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)

    const visible = meshesOf(engine).filter((m) => m.visible)
    const childVisible = visible.filter((m) => m.name.startsWith(`${ROOT_ZOOM + 1}/`))
    expect(childVisible.length).toBeGreaterThan(0)
    // every visible child's parent is hidden
    for (const mesh of childVisible) {
      const [z, x, y] = mesh.name.split('/').map(Number)
      const parentName = `${z - 1}/${x >> 1}/${y >> 1}`
      const parent = meshesOf(engine).find((m) => m.name === parentName)
      expect(parent?.visible ?? false).toBe(false)
    }
    // the visible meshes outside the view are shadow casters, not counted as drawn tiles
    const view = viewFrustum(camera)
    const drawn = visible.filter((m) => view.intersectsSphere(m.geometry.boundingSphere!))
    expect(drawn.length).toBeLessThan(visible.length)
    expect(engine.stats.visibleTiles).toBe(drawn.length)
    expect(engine.stats.loadedTiles).toBe(meshesOf(engine).length)
  })

  it('makes every tile cast and receive shadows, frustum-culled by three', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    engine.update(cameraAbove(600_000), 1000)
    await settle()
    engine.update(cameraAbove(600_000), 1000)
    const meshes = meshesOf(engine)
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.frustumCulled).toBe(true)
    }
  })

  it('coalesces onChange to once per update and supports unsubscribe', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    const cb = vi.fn()
    const off = engine.onChange(cb)

    engine.update(camera, 1000)
    expect(cb).not.toHaveBeenCalled()
    await settle()
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)

    off()
    engine.setOptions({ exaggeration: 2 })
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('retries a tile whose imagery fails, and keeps it grey once every attempt is used', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createFakeDeps({ failImagery: true })
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, {}, { retryDelayMs: 1000, maxLoadAttempts: 3 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    // the first attempt is not kept: no grey tile on screen while the parent (here nothing) could do better
    expect(engine.stats.loadedTiles).toBe(0)
    expect(engine.stats.failedTiles).toBe(ROOT_KEYS.length)
    for (let i = 0; i < 2; i++) {
      t += 1000
      engine.update(camera, 1000)
      await settle()
    }
    t += 1000
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.failedTiles).toBe(0)
    expect(deps.loadImageryTexture).toHaveBeenCalledTimes(3 * ROOT_KEYS.length)
    for (const mesh of meshesOf(engine)) {
      const material = mesh.material as MeshStandardMaterial
      expect(material.map).toBeNull()
      expect(material.color.getHex()).toBe(NO_IMAGERY_COLOR)
    }
  })

  it('marks a tile failed when the DEM fails, retries after the delay, then gives up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badUrl = `https://dem.test/${ROOT_KEYS[0].z}/${ROOT_KEYS[0].x}/${ROOT_KEYS[0].y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl })
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, {}, { retryDelayMs: 3000, maxLoadAttempts: 2 })
    const camera = cameraAbove(600_000)
    const badFetches = () => deps.fetched.filter((u) => u === badUrl).length
    // one update per second
    const tick = () => {
      t += 1000
      engine.update(camera, 1000)
    }

    engine.update(camera, 1000) // 0 s: first attempt
    await settle() // fails at 0 s -> retry allowed from 3 s
    tick() // 1 s
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(badFetches()).toBe(1)
    // The texture fetched alongside the failed DEM is released, not attached to a mesh, and the
    // imagery request of that node is cancelled (shared signal) while the others keep theirs.
    expect(deps.disposedTextures).toHaveLength(1)
    expect(meshesOf(engine).some((m) => (m.material as MeshStandardMaterial).map === deps.disposedTextures[0])).toBe(false)
    const badIndex = deps.fetched.indexOf(badUrl)
    expect(deps.signals[badIndex].aborted).toBe(true)
    expect(deps.signals.filter((s) => s.aborted)).toHaveLength(1)

    tick() // 2 s: retry time not reached yet
    expect(badFetches()).toBe(1)
    tick() // 3 s: second attempt
    expect(badFetches()).toBe(2)
    expect(engine.stats.pendingTiles).toBe(1)
    // the view (the export) does not wait for a retry, fetched after every first attempt and prefetch
    expect(engine.stats.pendingVisibleTiles).toBe(0)
    const ranks = vi
      .mocked(deps.fetcher.fetchBitmap)
      .mock.calls.filter(([url]) => url === badUrl)
      .map(([, o]) => o?.priority ?? 0)
    expect(ranks[0]).toBeLessThan(1_000_000)
    expect(ranks[1]).toBeGreaterThanOrEqual(2_000_000)
    await settle()
    for (let i = 0; i < 8; i++) tick()
    // two attempts allowed: no third request, the tile stays failed
    expect(badFetches()).toBe(2)
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('treats an HTTP 4xx on the DEM as "no data": a leaf that is never retried nor counted as failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badUrl = `https://dem.test/${ROOT_KEYS[0].z}/${ROOT_KEYS[0].x}/${ROOT_KEYS[0].y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl, demError: (url) => new TileFetchError(url, 404) })
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, {}, { retryDelayMs: 2000, maxLoadAttempts: 3 })
    const camera = cameraAbove(600_000)
    const badFetches = () => deps.fetched.filter((u) => u === badUrl).length

    engine.update(camera, 1000)
    await settle()
    for (let i = 0; i < 12; i++) {
      t += 1000 // well past every retry delay
      engine.update(camera, 1000)
    }
    expect(badFetches()).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(engine.stats.failedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(deps.disposedTextures).toHaveLength(1) // the orphan imagery of the no-data tile is released
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails the tile (and frees its load slot) when the geometry cannot be built from the grid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createFakeDeps()
    let corrupt = true
    const goodGrid = (): HeightGrid => ({ width: 4, height: 4, data: new Float32Array(16) })
    deps.decodeDem = vi.fn((): HeightGrid => {
      if (!corrupt) return goodGrid()
      corrupt = false
      return { width: 4, height: 4, data: undefined as unknown as Float32Array } // crashes the sampler
    })
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, {}, { retryDelayMs: 4000, maxConcurrentLoads: ROOT_KEYS.length })
    const camera = cameraAbove(600_000)

    engine.update(camera, 1000) // 0 s
    await settle()
    t = 1000
    engine.update(camera, 1000)
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(engine.stats.pendingTiles).toBe(0) // not stuck in 'loading'
    expect(deps.disposedTextures).toHaveLength(1) // the orphan texture of the failed node
    expect(warn).toHaveBeenCalledTimes(1)

    // Retry after the delay: the next decode is fine and the tile recovers.
    engine.update(camera, 1000) // any number of updates before the delay: no retry
    expect(engine.stats.pendingTiles).toBe(0)
    t = 4000 // retry at 4 s
    engine.update(camera, 1000)
    expect(engine.stats.pendingTiles).toBe(1)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.failedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(0)
  })

  it('rebuilds loaded geometries lazily when the exaggeration changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, {}, { rebuildsPerFrame: 2 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const before = meshesOf(engine).map((m) => m.geometry)
    const disposeSpies = before.map((g) => vi.spyOn(g, 'dispose'))
    const cb = vi.fn()
    engine.onChange(cb)

    engine.setOptions({ exaggeration: 2 })
    expect(cb).not.toHaveBeenCalled()
    const frames = Math.ceil(ROOT_KEYS.length / 2)
    for (let i = 0; i < frames; i++) engine.update(camera, 1000)

    const after = meshesOf(engine).map((m) => m.geometry)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).not.toBe(before[i])
      expect(disposeSpies[i]).toHaveBeenCalledTimes(1)
    }
    expect(cb).toHaveBeenCalled()
    expect(cb.mock.calls.length).toBeLessThanOrEqual(frames)
    // all geometries are rebuilt within the budget: 2 per frame
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })

  it('toggles wireframe on existing materials', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    engine.setOptions({ wireframe: true })
    for (const mesh of meshesOf(engine)) expect((mesh.material as MeshStandardMaterial).wireframe).toBe(true)
    engine.setOptions({ wireframe: false })
    for (const mesh of meshesOf(engine)) expect((mesh.material as MeshStandardMaterial).wireframe).toBe(false)
  })

  it('rebuilds everything from the new sources when the terrain source changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const oldMeshes = meshesOf(engine)
    const oldTextures = deps.textures.slice()
    const textureDispose = oldTextures.map((t) => vi.spyOn(t, 'dispose'))

    engine.setOptions({ terrain: TERRAIN_B })
    expect(engine.group.children).toHaveLength(0)
    expect(deps.heightField.clear).toHaveBeenCalled()
    for (const spy of textureDispose) expect(spy).toHaveBeenCalled()
    // stats reflect the empty tree right away, not only after the next update()
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0, pendingVisibleTiles: 0, missingVisibleTiles: 0, lodFactor: 1 })

    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(0)
    expect(deps.fetched.some((u) => u.startsWith('https://dem-b.test/'))).toBe(true)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    const newMeshes = meshesOf(engine)
    expect(newMeshes).toHaveLength(ROOT_KEYS.length)
    for (const mesh of newMeshes) expect(oldMeshes).not.toContain(mesh)
  })

  it('does not refetch when an unrelated option changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const fetchCount = deps.fetched.length
    engine.setOptions({ errorTargetPx: 5 })
    engine.update(camera, 1000)
    expect(deps.fetched).toHaveLength(fetchCount)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })

  it('unloads nodes that are no longer visited and keeps their ancestors', async () => {
    const deps = createFakeDeps()
    let t = 0
    deps.now = () => t
    // errorTargetPx 8: the 4 km camera refines (it sits inside the root spheres), the 600 km one does not
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 }, { unloadAfterMs: 3000, sweepEveryFrames: 1 })
    const near = cameraAbove(4000)
    for (let i = 0; i < 4; i++) {
      engine.update(near, 1000)
      await settle()
    }
    engine.update(near, 1000)
    const childMeshes = meshesOf(engine).filter((m) => m.name.startsWith(`${ROOT_ZOOM + 1}/`))
    expect(childMeshes.length).toBeGreaterThan(0)
    const loadedBefore = engine.stats.loadedTiles

    // Move far away: children are no longer refined, so they stop being visited.
    const far = cameraAbove(600_000)
    const cb = vi.fn()
    engine.onChange(cb)
    for (let i = 0; i < 6; i++) {
      engine.update(far, 1000)
      await settle() // a root that was never on screen while zoomed in loads now
    }
    // the delay is a time, not a number of updates (the export's tile waits update every 16 ms)
    for (const mesh of childMeshes) expect(engine.group.children).toContain(mesh)
    t = 3001
    engine.update(far, 1000)

    const remaining = meshesOf(engine)
    expect(remaining.every((m) => m.name.startsWith(`${ROOT_ZOOM}/`))).toBe(true)
    expect(remaining).toHaveLength(ROOT_KEYS.length)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.loadedTiles).toBeLessThan(loadedBefore)
    expect(cb).toHaveBeenCalled()
    for (const mesh of childMeshes) expect(engine.group.children).not.toContain(mesh)
  })

  it('keeps the tiles of a prefetch for prefetchKeepMs, longer than the unload delay of the view', async () => {
    const deps = createFakeDeps()
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 }, { unloadAfterMs: 1000, prefetchKeepMs: 10_000, sweepEveryFrames: 1 })
    const far = cameraAbove(600_000)
    engine.update(far, 1000)
    await settle()
    expect(engine.prefetch?.(cameraAbove(4000), 1000)).toBeGreaterThan(0)
    await settle()
    const prefetched = meshesOf(engine).filter((m) => m.name.startsWith(`${ROOT_ZOOM + 1}/`))
    expect(prefetched.length).toBeGreaterThan(0)

    t = 5000 // a frame of the export still waiting for its own tiles
    engine.update(far, 1000)
    for (const mesh of prefetched) expect(engine.group.children).toContain(mesh)
    t = 10_001
    engine.update(far, 1000)
    for (const mesh of prefetched) expect(engine.group.children).not.toContain(mesh)
  })

  it('aborts in-flight loads and ignores their late results on dispose', async () => {
    const deps = createFakeDeps({ deferDem: true })
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    expect(deps.signals.length).toBe(ROOT_KEYS.length)
    expect(engine.stats.pendingTiles).toBe(ROOT_KEYS.length)

    engine.dispose()
    for (const signal of deps.signals) expect(signal.aborted).toBe(true)
    deps.release()
    await settle()

    expect(engine.group.children).toHaveLength(0)
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0, pendingVisibleTiles: 0, missingVisibleTiles: 0, lodFactor: 1 })
    expect(deps.heightField.clear).toHaveBeenCalled()
    // the injected fetcher is not owned by the engine
    expect(deps.fetcher.clear).not.toHaveBeenCalled()
    // update after dispose is a no-op
    engine.update(camera, 1000)
    expect(engine.group.children).toHaveLength(0)
  })

  it('frees geometries, textures and materials on dispose', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const meshes = meshesOf(engine)
    const geometrySpies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'))
    const materialSpies = meshes.map((m) => vi.spyOn(m.material as MeshStandardMaterial, 'dispose'))
    const textureSpies = deps.textures.map((t) => vi.spyOn(t, 'dispose'))

    engine.dispose()

    for (const spy of [...geometrySpies, ...materialSpies, ...textureSpies]) expect(spy).toHaveBeenCalledTimes(1)
    expect(engine.group.children).toHaveLength(0)
    expect(deps.field.size).toBe(0)
  })

  it('samples the drawn tile (true-scale heights), not the grids cached in the height field', async () => {
    const deps = createFakeDeps()
    vi.mocked(deps.decodeDem).mockImplementation(() => ({ width: 4, height: 4, data: new Float32Array(16).fill(1234) }))
    const engine = engineWith(deps, { exaggeration: 2.5 })
    expect(engine.sampleHeight(6.9, 45.9)).toBeUndefined()
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    // the fake height field answers lon + lat: a finer or older grid than the tile on screen
    expect(engine.sampleHeight(6.9, 45.9)).toBeCloseTo(1234, 3)
    engine.update(camera, 1000)
    expect(engine.sampleHeight(6.9, 45.9)).toBeCloseTo(1234, 3)
    // the height field still answers where no tile is loaded (tree rebuilt for new imagery)
    engine.setOptions({ imageryZoomOffset: 2 })
    expect(engine.sampleHeight(6.9, 45.9)).toBeCloseTo(6.9 + 45.9, 9)
  })

  it('reports a change when the drawn tiles change without any load', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 })
    const near = cameraAbove(4000)
    for (let i = 0; i < 4; i++) {
      engine.update(near, 1000)
      await settle()
    }
    engine.update(near, 1000)
    const cb = vi.fn()
    engine.onChange(cb)
    // back up: the roots are drawn again instead of their loaded children
    engine.update(cameraAbove(600_000), 1000)
    expect(cb).toHaveBeenCalledTimes(1)
    engine.update(cameraAbove(600_000), 1000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('prunes the height field cache to the configured number of grids', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, {}, { heightCacheEntries: 2 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    expect(deps.heightField.prune).toHaveBeenCalledWith(2)
    expect(deps.field.size).toBe(2)
  })

  it('counts the height cache budget in 256 px tile equivalents (a 512 px grid weighs four)', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { terrain: { ...TERRAIN, tileSize: 512 } }, { heightCacheEntries: 8 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    expect(deps.heightField.prune).toHaveBeenCalledWith(2)
    expect(deps.field.size).toBe(2)
  })

  it('skips imagery requests for tiles outside the imagery coverage', async () => {
    const deps = createFakeDeps()
    const elsewhere: ImagerySource = { ...IMAGERY, coverage: { west: -10, south: 30, east: -5, north: 35 } }
    const engine = engineWith(deps, { imagery: elsewhere })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    expect(deps.loadImageryTexture).not.toHaveBeenCalled()
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })
})

// ---------------------------------------------------------------------------
// Tile budget (phone export)
// ---------------------------------------------------------------------------

/** Settle the loads of the fake deps (a few promise hops, no timer): the simulations run thousands of updates. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

/** Camera `heightM` above (x, z) in the local frame, looking straight down. */
function cameraAt(x: number, z: number, heightM: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 1, 5e6)
  camera.position.set(x, heightM, z)
  camera.up.set(0, 0, -1)
  camera.lookAt(new Vector3(x, 0, z))
  camera.updateProjectionMatrix()
  return camera
}

describe('tile budget', () => {
  const names = (engine: { group: { children: unknown[] } }, onlyVisible = false) =>
    new Set(meshesOf(engine).filter((m) => !onlyVisible || m.visible).map((m) => m.name))

  /** Three views side by side, each settled; returns what was loaded and drawn after each, and the engine. */
  async function threeViews(tuning: Partial<EngineTuning>) {
    const engine = engineWith(createFakeDeps(), { maxZoom: ROOT_ZOOM + 2 }, { unloadAfterMs: 1e9, ...tuning })
    const loaded: Array<Set<string>> = []
    const drawn: Array<Set<string>> = []
    for (const x of [-8000, 0, 8000]) {
      const camera = cameraAt(x, 0, 3000)
      for (let i = 0; i < 4; i++) {
        engine.update(camera, 1000)
        await flush()
      }
      loaded.push(names(engine))
      drawn.push(names(engine, true))
    }
    return { engine, loaded, drawn }
  }

  it('evicts, past the cap, the least recently visited tiles first and never those of the current view', async () => {
    const free = await threeViews({})
    const cap = free.engine.stats.loadedTiles - 2
    const capped = await threeViews({ maxResidentTiles: cap })

    expect(capped.engine.stats.loadedTiles).toBe(cap)
    // what the last view draws (tiles and shadow casters) is what it drew without a cap
    expect(capped.drawn[2]).toEqual(free.drawn[2])
    // the two tiles that went were last visited by the first view, not the second one's
    const evicted = [...free.loaded[2]].filter((name) => !capped.loaded[2].has(name))
    expect(evicted).toHaveLength(2)
    const [first, second, third] = free.drawn
    for (const name of evicted) {
      expect(first.has(name) && !second.has(name) && !third.has(name)).toBe(true)
    }
  })

  it('keeps nothing but the current view and the roots with a cap of zero', async () => {
    const free = await threeViews({})
    const { engine, drawn, loaded } = await threeViews({ maxResidentTiles: 0 })
    expect(drawn[2]).toEqual(free.drawn[2])
    expect(loaded[2].size).toBeLessThan(free.loaded[2].size)
    expect(engine.stats.loadedTiles).toBeGreaterThanOrEqual(ROOT_KEYS.length)
  })

  it('starts no prefetch past the cap', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 4 }, { maxResidentTiles: ROOT_KEYS.length })
    const high = cameraAbove(600_000)
    engine.update(high, 1000)
    await settle()
    engine.update(high, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.prefetch?.(cameraAbove(4000), 1000)).toBe(0)
  })

  it('counts the retention in film frames, not wall time, until it is switched off', async () => {
    const deps = createFakeDeps()
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 }, { unloadAfterMs: 1000, sweepEveryFrames: 1 })
    const retention = (frame: number) => ({ frame, keepFrames: 3, prefetchKeepFrames: 10 })
    const near = cameraAbove(4000)
    const far = cameraAbove(600_000)
    const view = async (camera: PerspectiveCamera) => {
      for (let i = 0; i < 4; i++) {
        engine.update(camera, 1000)
        await settle()
      }
      engine.update(camera, 1000)
      return engine.stats.loadedTiles
    }

    engine.setRetention?.(retention(0))
    const withChildren = await view(near)
    expect(withChildren).toBeGreaterThan(ROOT_KEYS.length)

    t = 600_000 // a long tile wait: the film did not move
    engine.setRetention?.(retention(2))
    engine.update(far, 1000)
    expect(engine.stats.loadedTiles).toBe(withChildren)
    engine.setRetention?.(retention(4)) // 0 + 3 frames are behind
    engine.update(far, 1000)
    expect(engine.stats.loadedTiles).toBeLessThan(withChildren)

    // back to wall time: the delay of the view applies again
    engine.setRetention?.(null)
    const again = await view(near)
    expect(again).toBeGreaterThan(ROOT_KEYS.length)
    t += 500
    engine.update(far, 1000)
    expect(engine.stats.loadedTiles).toBe(again)
    t += 1500
    engine.update(far, 1000)
    expect(engine.stats.loadedTiles).toBeLessThan(again)
  })

  it('releases the 2D canvas of an imagery texture with the tile', async () => {
    const deps = createFakeDeps()
    const canvas = { width: 512, height: 512, getContext: () => null }
    deps.loadImageryTexture = vi.fn(async () => {
      const texture = new Texture()
      texture.image = canvas
      return texture
    })
    const engine = engineWith(deps)
    engine.update(cameraAbove(600_000), 1000)
    await settle()
    expect(canvas.width).toBe(512)
    engine.dispose()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })

  describe('simulated export: a camera flies along a line, prefetching every 5 frames', () => {
    const AREA_WIDE: LonLatBounds = { west: 5.9, south: 45.3, east: 7.9, north: 46.5 }
    const FRAMES = 900

    /** Resident tiles after every frame of a film flown at `frameMs` per frame (the injected clock). */
    async function fly(tuning: Partial<EngineTuning>, o: { frameMs: number; ahead: number[]; keepFrames?: number }) {
      const deps = createFakeDeps()
      let t = 0
      deps.now = () => t
      const engine = engineWith(
        deps,
        { area: AREA_WIDE, maxZoom: 14, segments: 64, errorTargetPx: 8 },
        tuning,
      )
      const at = (i: number) => {
        const x = -37_000 + 80 * i
        const z = 3000 * Math.sin(i / 300)
        const camera = new PerspectiveCamera(50, 720 / 1280, 1, 2e6)
        camera.position.set(x, 4000 + 1500 * Math.sin(i / 150), z)
        camera.lookAt(new Vector3(x + 3000, 0, z - 200))
        camera.updateProjectionMatrix()
        return camera
      }
      const resident: number[] = []
      for (let i = 0; i < FRAMES; i++) {
        t += o.frameMs
        if (o.keepFrames) engine.setRetention?.({ frame: i, keepFrames: o.keepFrames, prefetchKeepFrames: Math.max(...o.ahead) + 10 })
        for (let k = 0; k < 3; k++) {
          engine.update(at(i), 720)
          await flush()
        }
        if (i % 5 === 0) {
          for (const ahead of o.ahead) {
            engine.prefetch?.(at(i + ahead), 720)
            await flush()
          }
        }
        resident.push(engine.stats.loadedTiles)
      }
      return resident
    }
    const FULL_AHEAD = [5, 10, 15, 20, 30, 40]

    it('a phone reaches a plateau under its cap; a computer keeps its wall-clock retention', async () => {
      const cap = 120
      const phone = await fly({ maxResidentTiles: cap }, { frameMs: 290, ahead: [5, 10, 20], keepFrames: 6 })
      expect(Math.max(...phone)).toBeLessThanOrEqual(cap)
      // no growth: the last third holds no more than the first
      expect(Math.max(...phone.slice(-300))).toBeLessThanOrEqual(Math.max(...phone.slice(0, 300)) + 5)

      // the former retention (30 s of wall time, every prefetch of the list) holds well above the cap
      const before = await fly({}, { frameMs: 290, ahead: FULL_AHEAD })
      expect(Math.max(...before)).toBeGreaterThan(cap * 1.4)

      // a computer: no cap, no frame retention: the default tuning is the unbounded one
      expect(DEFAULT_TUNING.maxResidentTiles).toBe(Infinity)
      const desktop = await fly({}, { frameMs: 30, ahead: FULL_AHEAD })
      expect(desktop).toEqual(await fly({ maxResidentTiles: Infinity }, { frameMs: 30, ahead: FULL_AHEAD }))
      expect(Math.max(...desktop)).toBeGreaterThan(cap * 1.4)
    }, 60_000)
  })
})

describe('hard tile cap through the level of detail (phone)', () => {
  const AREA_WIDE: LonLatBounds = { west: 5.9, south: 45.3, east: 7.9, north: 46.5 }
  const FRAMES = 150
  const PHONE: Partial<EngineTuning> = { maxResidentTiles: 120, maxConcurrentLoads: 6 }

  /** Portrait 720×1280 film camera at frame `i`: a dive from 6 km to 300 m ending on the horizon, or low from the start. */
  function filmCamera(i: number, low: boolean): PerspectiveCamera {
    const s = low ? 1 : Math.min(1, i / 120)
    const x = -20_000 + 40 * i
    const height = 6000 + (300 - 6000) * s
    const camera = new PerspectiveCamera(50, 720 / 1280, 1, 2e6)
    camera.position.set(x, height, 0)
    // from 45° down to 2° below the horizon
    camera.lookAt(new Vector3(x + height / Math.tan((45 + (2 - 45) * s) * (Math.PI / 180)), 0, 0))
    camera.updateProjectionMatrix()
    return camera
  }

  /**
   * A film rendered as an export does: every frame updated until the view waits for nothing, prefetches every 5 frames.
   * Records, after every update, the tiles loaded and loading (the loads it started are still in flight then).
   */
  async function film(tuning: Partial<EngineTuning>, low: boolean) {
    const deps = createFakeDeps()
    let t = 0
    deps.now = () => t
    const engine = engineWith(deps, { area: AREA_WIDE, maxZoom: 15, segments: 64, errorTargetPx: 3 }, tuning)
    const held: number[] = []
    const factors: number[] = []
    /** share of the tiles in view (before or after) that differ from the previous frame's */
    const redrawn: number[] = []
    let drawn: Mesh[] = []
    let before = new Set<string>()
    for (let i = 0; i < FRAMES; i++) {
      t += 290
      if (tuning.maxResidentTiles !== undefined) engine.setRetention?.({ frame: i, keepFrames: 6, prefetchKeepFrames: 30 })
      const camera = filmCamera(i, low)
      for (let k = 0; k < 80; k++) {
        const fetched = deps.fetched.length
        engine.update(camera, 720)
        held.push(engine.stats.loadedTiles + deps.fetched.length - fetched)
        factors.push(engine.stats.lodFactor ?? 1)
        await flush()
        if (k > 0 && engine.stats.pendingVisibleTiles === 0) break
      }
      if (i % 5 === 0) {
        for (const ahead of [5, 10, 20]) {
          engine.prefetch?.(filmCamera(i + ahead, low), 720)
          await flush()
        }
      }
      drawn = meshesOf(engine).filter((m) => m.visible && viewFrustum(camera).intersectsObject(m))
      const now = new Set(drawn.map((m) => m.name))
      const changed = [...now].filter((n) => !before.has(n)).length + [...before].filter((n) => !now.has(n)).length
      redrawn.push(changed / new Set([...now, ...before]).size)
      before = now
    }
    return { held, factors, drawn, redrawn }
  }

  /** zoom of the drawn tile nearest to the camera, and of the farthest one (horizontal distance) */
  function nearAndFar(meshes: Mesh[], camera: PerspectiveCamera): [number, number] {
    const distance = (m: Mesh) => {
      m.geometry.computeBoundingSphere()
      const c = m.geometry.boundingSphere!.center
      return Math.hypot(c.x - camera.position.x, c.z - camera.position.z)
    }
    const sorted = [...meshes].sort((a, b) => distance(a) - distance(b))
    return [sorted[0], sorted[sorted.length - 1]].map((m) => Number(m.name.split('/')[0])) as [number, number]
  }

  /** Updates `camera` until the view waits for nothing; returns the factors seen and the drawn tiles. */
  async function settleOn(engine: ReturnType<typeof engineWith>, camera: PerspectiveCamera, frame?: number) {
    const factors: number[] = []
    for (let k = 0; k < 80; k++) {
      if (frame !== undefined) engine.setRetention?.({ frame, keepFrames: 6, prefetchKeepFrames: 30 })
      engine.update(camera, 720)
      factors.push(engine.stats.lodFactor ?? 1)
      await flush()
      if (k > 0 && engine.stats.pendingVisibleTiles === 0) break
    }
    // in the view (the shadow casters around it are the ready tiles it visits: they depend on what was loaded before)
    const inView = meshesOf(engine).filter((m) => m.visible && viewFrustum(camera).intersectsObject(m))
    return { factors, drawn: inView.map((m) => m.name).sort() }
  }
  const phoneEngine = () => engineWith(createFakeDeps(), { area: AREA_WIDE, maxZoom: 15, segments: 64, errorTargetPx: 3 }, PHONE)

  it('an export frame depends on its view, not on the frames before', async () => {
    const direct = phoneEngine()
    const a = await settleOn(direct, filmCamera(149, true), 0)
    const after = phoneEngine()
    for (let i = 0; i < 40; i += 4) await settleOn(after, filmCamera(i, false), i)
    const b = await settleOn(after, filmCamera(149, true), 40)
    expect(b.factors.at(-1)).toBe(a.factors.at(-1))
    expect(b.drawn).toEqual(a.drawn)
  }, 60_000)

  it('the preview keeps its level on a still view and goes back to full detail one step at a time', async () => {
    const engine = phoneEngine()
    const low = await settleOn(engine, filmCamera(149, true))
    // once its tiles are in, the view relaxes a step per update to what it needs, then holds: no pumping
    const still: number[] = []
    for (let k = 0; k < 40; k++) {
      engine.update(filmCamera(149, true), 720)
      still.push(engine.stats.lodFactor ?? 1)
      await flush()
    }
    for (let k = 1; k < still.length; k++) expect(still[k]).toBeLessThanOrEqual(still[k - 1])
    expect(new Set(still.slice(-20)).size).toBe(1)
    expect(low.factors.at(-1)).toBeGreaterThan(1)
    expect(still.at(-1)).toBeGreaterThan(1)
    const factors: number[] = []
    for (let k = 0; k < 20; k++) {
      engine.update(cameraAbove(1_000_000), 720)
      factors.push(engine.stats.lodFactor ?? 1)
      await flush()
    }
    expect(factors.at(-1)).toBe(1)
    for (let k = 1; k < factors.length; k++) expect(factors[k]).toBeGreaterThanOrEqual(factors[k - 1] / LOD_STEP - 1e-9)
  })

  for (const low of [false, true]) {
    it(`keeps a phone within its cap on every update, ${low ? 'low from the first frame' : 'through a descent'}`, async () => {
      const free = await film({}, low)
      const phone = await film(PHONE, low)
      // the view alone needs far more than the cap without it
      expect(Math.max(...free.held)).toBeGreaterThan(200)
      // a computer: no budget, full detail, the selections of before (the error target times 1)
      expect(new Set(free.factors)).toEqual(new Set([1]))

      // tiles loaded + loading, after every update
      expect(Math.max(...phone.held)).toBeLessThanOrEqual(120)
      expect(Math.max(...phone.factors)).toBeGreaterThan(1)
      const last = filmCamera(FRAMES - 1, low)
      const [freeNear, freeFar] = nearAndFar(free.drawn, last)
      const [phoneNear, phoneFar] = nearAndFar(phone.drawn, last)
      // the ground under the camera keeps its detail, the distance gets coarser
      expect(phoneNear).toBe(freeNear)
      expect(phoneFar).toBeLessThan(freeFar)
      // the level hovers around the budget: no frame redraws a third of the view (×1.25 steps did, 36 % and 43 %)
      if (!low) expect(Math.max(...phone.redrawn.slice(3))).toBeLessThan(0.35)
    }, 120_000)
  }
})

// ---------------------------------------------------------------------------
// Video export: the view is final when the settle loop returns
// ---------------------------------------------------------------------------

describe('export: the view is final when the settle loop returns', () => {
  /** capture.ts's `settle` driven by the real engine, on a virtual clock (a wait step is a macrotask and at least 1 ms) */
  function exportView(engine: ReturnType<typeof engineWith>, camera: PerspectiveCamera, clock: { t: number }, timeoutMs = DEFAULT_SETTLE.timeoutMs) {
    const counts = { renders: 0, waits: 0 }
    const run = () =>
      settleView(
        {
          advance: () => {
            counts.renders++
            engine.update(camera, 1000)
          },
          separateFinal: () => false,
          updateTiles: () => engine.update(camera, 1000),
          pendingTiles: () => engine.stats.pendingVisibleTiles ?? 0,
          flushDrapes: () => false,
          now: () => clock.t,
          wait: async (ms) => {
            counts.waits++
            clock.t += Math.max(ms, 1)
            await settle()
          },
          isCanceled: () => false,
        },
        { ...DEFAULT_SETTLE, timeoutMs },
      )
    return { counts, run }
  }

  /** the tiles drawn, with whether each has its imagery */
  const drawn = (engine: ReturnType<typeof engineWith>) =>
    meshesOf(engine)
      .filter((m) => m.visible)
      .map((m) => `${m.name}${(m.material as MeshStandardMaterial).map ? '' : ' grey'}`)
      .sort()

  /** another update of the same view changes nothing: no request, same tiles drawn, nothing awaited */
  async function expectFinal(engine: ReturnType<typeof engineWith>, camera: PerspectiveCamera, deps: FakeDeps) {
    const requests = deps.fetched.length
    const view = drawn(engine)
    for (let i = 0; i < 3; i++) {
      engine.update(camera, 1000)
      await settle()
    }
    expect(deps.fetched.length).toBe(requests)
    expect(drawn(engine)).toEqual(view)
    expect(engine.stats.pendingVisibleTiles).toBe(0)
  }

  const DEEP = { errorTargetPx: 1, maxZoom: ROOT_ZOOM + 2 }

  it('requests the children of a loaded parent before it returns (cached tiles, answered at once)', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, DEEP)
    engine.setExporting?.(true)
    const camera = cameraAbove(4000)
    const clock = { t: 0 }
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(drawn(engine).some((name) => name.startsWith(`${ROOT_ZOOM + 2}/`))).toBe(true)
    expect(engine.stats.lodFactor).toBe(1) // a computer: the level of detail never gives way
    await expectFinal(engine, camera, deps)
  })

  it('waits for the imagery of tiles whose bitmaps are cached but whose composite comes a few ms later', async () => {
    const deps = createFakeDeps()
    deps.loadImageryTexture = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 8))
      return new Texture()
    })
    const engine = engineWith(deps, DEEP)
    engine.setExporting?.(true)
    const camera = cameraAbove(4000)
    expect(await exportView(engine, camera, { t: 0 }).run()).toBe(true)
    expect(drawn(engine).length).toBeGreaterThan(0)
    expect(drawn(engine).some((name) => name.endsWith('grey'))).toBe(false)
    await expectFinal(engine, camera, deps)
  })

  it('retries a failed tile of the view quickly and returns once it is drawn', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ROOT_KEYS[0]
    const badUrl = `https://dem.test/${bad.z}/${bad.x}/${bad.y}.png`
    let failures = 1
    const deps = createFakeDeps({ failDem: (url) => url === badUrl && failures-- > 0 })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    engine.setExporting?.(true)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(drawn(engine)).toHaveLength(ROOT_KEYS.length)
    expect(clock.t).toBeLessThan(2000) // not the 5 s of the preview
    expect(engine.stats.missingVisibleTiles).toBe(0)
    await expectFinal(engine, camera, deps)
  })

  it('retries a tile whose imagery failed, so no tile is drawn grey', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createFakeDeps()
    let calls = 0
    deps.loadImageryTexture = vi.fn(async () => {
      if (calls++ === 0) throw new Error('imagery down')
      return new Texture()
    })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    engine.setExporting?.(true)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(drawn(engine)).toHaveLength(ROOT_KEYS.length)
    expect(drawn(engine).some((name) => name.endsWith('grey'))).toBe(false)
  })

  it('counts a tile it gave up on as missing, after its last attempt, without waiting for the timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ROOT_KEYS[0]
    const badUrl = `https://dem.test/${bad.z}/${bad.x}/${bad.y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    engine.setExporting?.(true)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(deps.fetched.filter((u) => u === badUrl)).toHaveLength(DEFAULT_TUNING.maxLoadAttempts)
    expect(engine.stats.pendingVisibleTiles).toBe(0)
    expect(engine.stats.missingVisibleTiles).toBe(1)
    expect(clock.t).toBeLessThan(5000)
    // later frames do not wait for it again
    const again = exportView(engine, camera, clock)
    await again.run()
    expect(again.counts.waits).toBe(0)
  })

  it('counts a tile drawn with some imagery missing, once its attempts are used', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createFakeDeps()
    deps.loadImageryTexture = vi.fn(async () => {
      const texture = new Texture()
      texture.userData.incomplete = true
      return texture
    })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    engine.setExporting?.(true)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(deps.loadImageryTexture).toHaveBeenCalledTimes(DEFAULT_TUNING.maxLoadAttempts * ROOT_KEYS.length)
    expect(drawn(engine)).toHaveLength(ROOT_KEYS.length)
    expect(engine.stats.missingVisibleTiles).toBe(ROOT_KEYS.length)
  })

  it('gives up at the timeout when tiles never arrive: not settled, still pending', async () => {
    const deps = createFakeDeps({ deferDem: true })
    const clock = { t: 0 }
    const engine = engineWith(deps)
    engine.setExporting?.(true)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock, 3000).run()).toBe(false)
    expect(clock.t).toBeGreaterThanOrEqual(3000)
    expect(engine.stats.pendingVisibleTiles).toBeGreaterThan(0)
  })

  it('tries again, when an export starts, the tiles that had given up', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ROOT_KEYS[0]
    const badUrl = `https://dem.test/${bad.z}/${bad.x}/${bad.y}.png`
    let down = true
    const deps = createFakeDeps({ failDem: (url) => url === badUrl && down })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    for (let i = 0; i < 4; i++) {
      engine.update(camera, 1000)
      await settle()
      clock.t += 6000
    }
    expect(engine.stats.failedTiles).toBe(1)
    down = false
    engine.setExporting?.(true)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(drawn(engine)).toHaveLength(ROOT_KEYS.length)
  })

  it('costs nothing more when every tile is there: one render, no wait, no request', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, DEEP)
    engine.setExporting?.(true)
    const camera = cameraAbove(4000)
    await exportView(engine, camera, { t: 0 }).run()
    const requests = deps.fetched.length
    const next = exportView(engine, camera, { t: 0 })
    expect(await next.run()).toBe(true)
    expect(next.counts).toEqual({ renders: 1, waits: 0 })
    expect(deps.fetched.length).toBe(requests)
  })

  it('leaves the preview as it was: the retry of a failed tile is not awaited', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ROOT_KEYS[0]
    const badUrl = `https://dem.test/${bad.z}/${bad.x}/${bad.y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl })
    const clock = { t: 0 }
    deps.now = () => clock.t
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    expect(await exportView(engine, camera, clock).run()).toBe(true)
    expect(drawn(engine)).toHaveLength(ROOT_KEYS.length - 1)
  })
})
