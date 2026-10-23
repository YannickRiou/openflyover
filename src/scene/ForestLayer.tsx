/**
 * ForestLayer — trees on the forests of OpenStreetMap (osm/forest.ts), inside TerrainLayer. See ARCHITECTURE.md
 * "Forests".
 *
 * `placeTrees` (scene/forestPoints.ts, pure) gives the trees in chunks of the ground; each chunk is two `InstancedMesh`
 * (conifers, broadleaves: scene/treeGeometry.ts) draped like the track (`engine.sampleHeight` × exaggeration), when it
 * is first within `FOREST_FAR_M` of the camera and again after the relief changed (a few thousand trees a frame while
 * the film plays, all of them at once for the video export through `registerDrapeFlush`). A chunk beyond the distance is
 * not drawn; the trees shrink to nothing over the last `FOREST_FADE_M`, so none pops. Lit by the sun, they receive the
 * terrain's shadows; they cast none (a tree's shadow would be a few texels wide: heavy for no visible result).
 * Everything is a function of the settings, the forests and the camera: the export is deterministic.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { Camera, BufferGeometry } from 'three'
import { deviceBudget } from '../core/deviceBudget'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { isExportBusy, registerDrapeFlush, useExportStore } from '../export/store'
import { mergeByTrack } from '../osm/byTrack'
import { fetchTrackForest } from '../osm/forest'
import { simplifyLine } from '../osm/overpass'
import { useForestStore } from '../osm/store'
import { setForestStatus } from './forestStatus'
import { useAppStore } from '../state/store'
import { type ForestChunk, placeTrees, treeKind } from './forestPoints'
import { wakeScene } from './renderOnDemand'
import { REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS } from './trackLineSet'
import { useTerrainContext } from './terrainContext'
import { TREE_WIDTH_RATIO, createTreeGeometries } from './treeGeometry'
import { useDebouncedCallback } from './useDebouncedCallback'
import { useFilmTracks } from './usePacing'
import { useTrackResults } from './useTrackResults'

/** Trees are drawn up to this distance from the camera (metres)... */
export const FOREST_FAR_M = 6000
/** ...and shrink to nothing over the last of it. */
export const FOREST_FADE_M = 500
/** Trees draped in one frame while the film plays (the export drapes every chunk in range at once). */
export const DRAPE_TREES_PER_FRAME = 8000
/** The track is simplified to this tolerance before the trees' distance to it is measured (metres). */
const PATH_TOLERANCE_M = 200
/** A tree stands this deep in the ground: the trunk meets the relief on a slope and under a coarse level of detail. */
const SINK_M = 1

const fadeGlsl = /* glsl */ `
#ifdef USE_INSTANCING
{
  float forestDistance = distance(cameraPosition, (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  transformed *= 1.0 - smoothstep(${(FOREST_FAR_M - FOREST_FADE_M).toFixed(1)}, ${FOREST_FAR_M.toFixed(1)}, forestDistance);
}
#endif
`

function createTreeMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${fadeGlsl}`)
  }
  material.customProgramCacheKey = () => 'openflyover-forest'
  return material
}

interface Entry {
  chunk: ForestChunk
  /** scene position of the chunk's centre */
  x: number
  z: number
  conifer: InstancedMesh | null
  broadleaf: InstancedMesh | null
  /** relief and exaggeration it was draped with */
  epoch: number
  exaggeration: number
}

interface Forest {
  root: Group
  entries: Entry[]
  dispose(): void
}

const _p = new Vector3()
const _s = new Vector3()
const _q = new Quaternion()
const _m = new Matrix4()
const _c = new Color()
const _cam = new Vector3()
const UP = new Vector3(0, 1, 0)

function createForest(chunks: readonly ForestChunk[], frame: LocalFrame): Forest {
  const root = new Group()
  root.name = 'forest'
  const entries = chunks.map((chunk): Entry => {
    frame.toLocal(chunk.centre.lon, chunk.centre.lat, 0, _p)
    return { chunk, x: _p.x, z: _p.z, conifer: null, broadleaf: null, epoch: -1, exaggeration: 0 }
  })
  const dispose = () => {
    for (const entry of entries) {
      entry.conifer?.dispose()
      entry.broadleaf?.dispose()
    }
    root.clear()
  }
  return { root, entries, dispose }
}

/** A tree mesh with room for `capacity` trees, never picked (the track picker and the camera target the relief). */
function createMesh(geometry: BufferGeometry, material: MeshStandardMaterial, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity)
  mesh.receiveShadow = true
  mesh.count = 0
  mesh.raycast = () => {}
  return mesh
}

interface Drape {
  engine: TerrainEngine | null
  frame: LocalFrame
  exaggeration: number
  epoch: number
  geometries: Record<'conifer' | 'broadleaf', BufferGeometry>
  material: MeshStandardMaterial
}

/** Put every tree of `entry` on the relief. Trees whose height is not known yet are left out until the next relief change. */
function drapeEntry(entry: Entry, forest: Forest, d: Drape): void {
  const { chunk } = entry
  const kinds = chunk.kind
  const mayBeConifer = kinds.reduce((n, k) => n + (k !== 1 ? 1 : 0), 0)
  const mayBeBroadleaf = chunk.count - kinds.reduce((n, k) => n + (k === 0 ? 1 : 0), 0)
  if (!entry.conifer && mayBeConifer > 0) {
    entry.conifer = createMesh(d.geometries.conifer, d.material, mayBeConifer)
    forest.root.add(entry.conifer)
  }
  if (!entry.broadleaf && mayBeBroadleaf > 0) {
    entry.broadleaf = createMesh(d.geometries.broadleaf, d.material, mayBeBroadleaf)
    forest.root.add(entry.broadleaf)
  }
  const used = { conifer: 0, broadleaf: 0 }
  for (let i = 0; i < chunk.count; i++) {
    const lon = chunk.lonLat[2 * i]
    const lat = chunk.lonLat[2 * i + 1]
    const ground = d.engine?.sampleHeight(lon, lat)
    if (ground === undefined || Number.isNaN(ground)) continue
    const kind = treeKind(kinds[i], ground)
    const mesh = kind === 'conifer' ? entry.conifer : entry.broadleaf
    if (!mesh) continue
    const height = chunk.height[i]
    const width = height * TREE_WIDTH_RATIO[kind]
    d.frame.toLocal(lon, lat, ground * d.exaggeration - SINK_M, _p)
    _q.setFromAxisAngle(UP, chunk.yaw[i])
    _m.compose(_p, _q, _s.set(width, height, width))
    const index = used[kind]++
    mesh.setMatrixAt(index, _m)
    // a slight variation of the green, from lighter and yellower to darker and bluer
    const v = chunk.variation[i]
    mesh.setColorAt(index, _c.setRGB(0.78 + 0.34 * v, 0.84 + 0.2 * v, 0.72 + 0.3 * (1 - v)))
  }
  for (const [mesh, count] of [[entry.conifer, used.conifer], [entry.broadleaf, used.broadleaf]] as const) {
    if (!mesh) continue
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    if (count > 0) mesh.computeBoundingSphere()
  }
  entry.epoch = d.epoch
  entry.exaggeration = d.exaggeration
}

/**
 * One pass over the chunks: hide those beyond FOREST_FAR_M, drape those in range that need it (nearest to the camera
 * first, `limit` trees at most). Returns the trees draped and whether chunks in range still wait for their turn.
 */
function updateForest(forest: Forest, camera: Camera, d: Drape, limit: number): { draped: number; waiting: boolean } {
  camera.getWorldPosition(_cam)
  const inRange: { entry: Entry; distance: number }[] = []
  for (const entry of forest.entries) {
    // horizontal distance: a function of the camera alone, whatever has been draped before
    const distance = Math.hypot(_cam.x - entry.x, _cam.z - entry.z) - entry.chunk.radiusM
    const visible = distance < FOREST_FAR_M
    if (entry.conifer) entry.conifer.visible = visible
    if (entry.broadleaf) entry.broadleaf.visible = visible
    if (visible && (entry.epoch !== d.epoch || entry.exaggeration !== d.exaggeration)) inRange.push({ entry, distance })
  }
  inRange.sort((a, b) => a.distance - b.distance)
  let draped = 0
  let next = 0
  for (; next < inRange.length && draped < limit; next++) {
    drapeEntry(inRange[next].entry, forest, d)
    draped += inRange[next].entry.chunk.count
  }
  // a chunk draped for the first time becomes visible with its meshes
  return { draped, waiting: next < inRange.length }
}

export function ForestLayer() {
  const { engine, frame } = useTerrainContext()
  const tracks = useFilmTracks()
  const enabled = useAppStore((s) => s.settings.forest.enabled)
  const density = useDeferredValue(useAppStore((s) => s.settings.forest.density))
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const get = useThree((s) => s.get)
  // one Overpass query per track of the film (cached, one at a time); nothing is sent while the setting is off, and a track
  // that fails shows no trees (the status chip says so). The forests of all the tracks are drawn together.
  const { results, loading, started, failed } = useTrackResults(enabled, tracks, (track, onStart, signal) => fetchTrackForest(track, signal, undefined, onStart))
  // « en attente » until the Overpass queue reaches the first request still waiting, then « chargement »
  useEffect(
    () => setForestStatus(!enabled || tracks.length === 0 ? 'idle' : loading ? (started ? 'loading' : 'queued') : failed ? 'error' : 'ready'),
    [enabled, tracks, loading, started, failed],
  )
  const polygons = useMemo(() => mergeByTrack(results, tracks.map((t) => t.id)), [results, tracks])
  const paths = useMemo(() => tracks.map((track) => simplifyLine(track.segments.flatMap((s) => s.points), PATH_TOLERANCE_M)), [tracks])
  // Placing takes up to a second or more: once the queue is empty, not at each answer (the trees of the tracks asked before stay meanwhile)
  const [placed, setPlaced] = useState<{ polygons: unknown; density: number; paths: unknown; chunks: ForestChunk[] }>({ polygons, density, paths, chunks: [] })
  if (!loading && (placed.polygons !== polygons || placed.density !== density || placed.paths !== paths)) {
    setPlaced({ polygons, density, paths, chunks: placeTrees(polygons, { density, maxTrees: deviceBudget().maxTrees, paths }) })
  }
  const { chunks } = placed
  const forest = useMemo(() => (frame ? createForest(chunks, frame) : null), [chunks, frame])
  useEffect(() => () => forest?.dispose(), [forest])
  const geometries = useMemo(() => createTreeGeometries(), [])
  const material = useMemo(() => createTreeMaterial(), [])
  useEffect(
    () => () => {
      geometries.conifer.dispose()
      geometries.broadleaf.dispose()
      material.dispose()
    },
    [geometries, material],
  )
  // OpenStreetMap is credited while its forests are drawn
  const credited = forest !== null && chunks.length > 0
  useEffect(() => useForestStore.setState({ polygons: credited ? polygons.length : 0 }), [credited, polygons])
  useEffect(
    () => () => {
      useForestStore.setState({ polygons: 0 })
      setForestStatus('idle')
    },
    [],
  )

  // the relief changed (tiles arrived, a level of detail swapped): every chunk in range is draped again, in time
  const epoch = useRef(0)
  const bump = useCallback(() => {
    epoch.current++
    wakeScene()
  }, [])
  const redrape = useDebouncedCallback(bump, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  useEffect(() => {
    if (!engine) return
    bump()
    const unsubscribe = engine.onChange(redrape)
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, bump, redrape])

  const run = useCallback(
    (camera: Camera, limit: number) => {
      if (!forest || !frame) return { draped: 0, waiting: false }
      return updateForest(forest, camera, { engine, frame, exaggeration, epoch: epoch.current, geometries, material }, limit)
    },
    [forest, frame, engine, exaggeration, geometries, material],
  )
  useFrame(({ camera }) => {
    const { draped, waiting } = run(camera, exporting ? Infinity : DRAPE_TREES_PER_FRAME)
    // the chunks left for the next frames: keep drawing until they are all draped
    if (draped > 0 && waiting) wakeScene(2)
  })
  // the video export drapes what is in range right away instead of waiting for the debounce and the next frames
  useEffect(
    () =>
      registerDrapeFlush(() => {
        const pending = redrape.isPending()
        redrape.flush()
        return run(get().camera, Infinity).draped > 0 || pending
      }),
    [redrape, run, get],
  )

  if (!forest || chunks.length === 0) return null
  return <primitive object={forest.root} dispose={null} />
}
