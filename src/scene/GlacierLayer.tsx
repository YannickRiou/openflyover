/**
 * GlacierLayer — the glaciers of OpenStreetMap (osm/glacier.ts) drawn with the look of the snow (terrain/snowShader.ts)
 * slightly above the relief, whatever the snow line of the day, inside TerrainLayer. Only while « Météo › Neige » is not
 * « Aucune ». See ARCHITECTURE.md "Glaciers".
 *
 * Each glacier is meshed once on the grid of the water (scene/glacierMesh.ts), draped like the track (`engine.sampleHeight` ×
 * exaggeration + GLACIER_LIFT_M; the normal from two more heights a few metres away, so the sun and the terrain shadows shade
 * the ice like the relief) and re-draped (debounced, flushed by the video export) when tiles arrive. One merged geometry,
 * drawn before the water so that a glacial lake stays water.
 * The look is in scene/glacierMaterial.ts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine, Track } from '../core/types'
import { registerDrapeFlush } from '../export/store'
import { fetchTrackGlacier, type GlacierPolygon } from '../osm/glacier'
import { useGlacierStore } from '../osm/store'
import { playsBilan } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { createGlacierMaterial } from './glacierMaterial'
import { buildGlacierMesh, fillHeights, type GlacierMesh } from './glacierMesh'
import { setGlacierStatus } from './glacierStatus'
import { wakeScene } from './renderOnDemand'
import { useTerrainContext } from './terrainContext'
import { REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS } from './trackLineSet'
import { useDebouncedCallback } from './useDebouncedCallback'
import { useFilmTrack } from './usePacing'
import { useTracksByPoints } from './useTrackResults'

/** Height of the ice above the draped relief (metres, not exaggerated): the coarse levels of detail of the relief rise above 1 or 2 m of ice and show through as patches. */
export const GLACIER_LIFT_M = 4
/** Distance of the two extra heights that give the slope under a vertex (metres). */
const NORMAL_STEP_M = 25
const M_PER_DEG = 111_320

/** Height of each vertex of `mesh` (metres, before exaggeration), NaN where the relief is not loaded yet. */
function sampleHeights(mesh: GlacierMesh, engine: TerrainEngine | null): Float64Array {
  const count = mesh.fade.length
  const heights = new Float64Array(count)
  for (let v = 0; v < count; v++) heights[v] = engine?.sampleHeight(mesh.lonLat[2 * v], mesh.lonLat[2 * v + 1]) ?? Number.NaN
  return heights
}

const _p = new Vector3()
const _e = new Vector3()
const _f = new Vector3()
const _n = new Vector3()
const NONE: GlacierPolygon[] = []

/** Merged geometry of every glacier whose relief is known: positions, normals of the relief, fade and flow of each. */
function drapeGlacier(meshes: readonly GlacierMesh[], engine: TerrainEngine | null, frame: LocalFrame, exaggeration: number): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const fades: number[] = []
  const flows: number[] = []
  const index: number[] = []
  for (const mesh of meshes) {
    const known = sampleHeights(mesh, engine)
    const heights = fillHeights(known)
    if (!heights) continue
    const base = positions.length / 3
    // the slope: the heights NORMAL_STEP_M to the east and to the north, only where the vertex's own is known (its own elsewhere)
    const east = Float64Array.from(heights)
    const north = Float64Array.from(heights)
    for (let v = 0; v < heights.length; v++) {
      if (Number.isNaN(known[v])) continue
      const lon = mesh.lonLat[2 * v]
      const lat = mesh.lonLat[2 * v + 1]
      const e = engine?.sampleHeight(lon + NORMAL_STEP_M / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat)
      const n = engine?.sampleHeight(lon, lat + NORMAL_STEP_M / M_PER_DEG)
      if (e !== undefined && !Number.isNaN(e)) east[v] = e
      if (n !== undefined && !Number.isNaN(n)) north[v] = n
    }
    let flowX = 0
    let flowZ = 0
    for (let v = 0; v < heights.length; v++) {
      const lon = mesh.lonLat[2 * v]
      const lat = mesh.lonLat[2 * v + 1]
      frame.toLocal(lon, lat, heights[v] * exaggeration + GLACIER_LIFT_M, _p)
      positions.push(_p.x, _p.y, _p.z)
      frame.toLocal(lon + NORMAL_STEP_M / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat, east[v] * exaggeration + GLACIER_LIFT_M, _e).sub(_p)
      frame.toLocal(lon, lat + NORMAL_STEP_M / M_PER_DEG, north[v] * exaggeration + GLACIER_LIFT_M, _f).sub(_p)
      _n.copy(_e).cross(_f)
      if (_n.y < 0) _n.negate()
      _n.normalize()
      normals.push(_n.x, _n.y, _n.z)
      fades.push(mesh.fade[v])
      // the normal leans downhill: its horizontal part is the way the ice flows
      flowX += _n.x
      flowZ += _n.z
    }
    // the flow of the glacier: downhill on average (any direction on flat ground)
    const length = Math.hypot(flowX, flowZ)
    const [fx, fz] = length > 1e-6 ? [flowX / length, flowZ / length] : [1, 0]
    for (let v = 0; v < mesh.fade.length; v++) flows.push(fx, fz)
    for (const i of mesh.index) index.push(base + i)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('glacierFade', new BufferAttribute(new Float32Array(fades), 1))
  geometry.setAttribute('glacierFlow', new BufferAttribute(new Float32Array(flows), 2))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

export function GlacierLayer() {
  const { engine, frame } = useTerrainContext()
  // a recolour or a rename keeps the points: no new query, no new mesh
  const filmTrack = useFilmTrack()
  const [track] = useTracksByPoints(filmTrack ? [filmTrack] : [])
  // « Aucune » leaves the ground as in the photo: no glacier either (and no request)
  // …nor in a « Bilan »: its track is the whole year, too wide for one query
  const enabled = useAppStore((s) => s.settings.snow.mode !== 'aucune' && !playsBilan(s.settings.race, s.tracks.length))
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  /** glaciers of the track and points they were fetched for (shown only for the current first track, snow not « Aucune »; a track tool changes the points) */
  const [fetched, setFetched] = useState<{ trackId: string; segments: Track['segments']; polygons: GlacierPolygon[] } | null>(null)
  const polygons = useMemo(
    () => (enabled && fetched && fetched.trackId === track?.id && fetched.segments === track.segments ? fetched.polygons : NONE),
    [enabled, fetched, track],
  )
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), createGlacierMaterial())
    m.name = 'glacier'
    m.receiveShadow = true
    // before the water (renderOrder 0): a glacial lake stays water
    m.renderOrder = -1
    // never picked: the track picker and the camera target the relief and the track
    m.raycast = () => {}
    return m
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  // one Overpass query per track (cached); nothing is sent while the snow is off
  useEffect(() => {
    if (!enabled || !track) {
      setGlacierStatus('idle')
      return
    }
    // given up on cleanup: the shared query (osm/overpass.ts `sharedOverpassQuery`) is cancelled once nobody waits for it
    let current = true
    const ctrl = new AbortController()
    const { id: trackId, segments } = track
    setGlacierStatus('loading')
    fetchTrackGlacier(track, ctrl.signal).then(
      (list) => {
        if (!current) return
        setFetched({ trackId, segments, polygons: list })
        setGlacierStatus('ready')
      },
      () => current && setGlacierStatus('error'),
    )
    return () => {
      current = false
      ctrl.abort()
    }
  }, [enabled, track])
  useEffect(() => useGlacierStore.setState({ polygons: polygons.length }), [polygons])
  useEffect(
    () => () => {
      useGlacierStore.setState({ polygons: 0 })
      setGlacierStatus('idle')
    },
    [],
  )

  const meshes = useMemo(() => polygons.map((polygon) => buildGlacierMesh(polygon)), [polygons])
  const drape = useCallback(
    (current: TerrainEngine | null, factor: number) => {
      if (!frame) return
      const previous = mesh.geometry
      mesh.geometry = drapeGlacier(meshes, current, frame, factor)
      previous.dispose()
      wakeScene()
    },
    [mesh, frame, meshes],
  )
  useEffect(() => drape(engine, exaggeration), [drape, engine, exaggeration])

  const redrape = useDebouncedCallback(drape, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])
  // the video export runs the pending re-drape right away instead of waiting for the debounce
  useEffect(
    () =>
      registerDrapeFlush(() => {
        const pending = redrape.isPending()
        redrape.flush()
        return pending
      }),
    [redrape],
  )

  if (meshes.length === 0) return null
  return <primitive object={mesh} dispose={null} />
}
