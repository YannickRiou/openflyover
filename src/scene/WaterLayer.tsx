/**
 * WaterLayer — the water of OpenStreetMap (osm/water.ts) as a reflective surface slightly above the relief, inside
 * TerrainLayer: lakes and river areas, the sea along a coast, and the rivers and streams mapped as lines. See
 * ARCHITECTURE.md "Reflective water".
 *
 * Each shape is meshed once (scene/waterMesh.ts, scene/riverStrip.ts), draped like the track (`engine.sampleHeight` x
 * exaggeration + WATER_LIFT_M) and re-draped (debounced, flushed by the video export) when tiles arrive. A lake is flat
 * at a high percentile of the heights inside it (`lakeLevel`: the relief must not poke through), a river area or a
 * ribbon follows its valley, the sea is flat at 0 m (the datum of the relief) and needs no tile.
 *
 * Shading: MeshStandardMaterial extended in `onBeforeCompile` (animated waves faded out below a few pixels, Fresnel
 * reflection of the sky). Everything is a function of the film time: the export is deterministic.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, Uniform, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { registerDrapeFlush } from '../export/store'
import { useWaterStore } from '../osm/store'
import { fetchTrackWater, fetchTrackWaterShapes, isWaterLine, lineWidthM, runsOutside, type WaterLine, type WaterPolygon } from '../osm/water'
import { useAppStore } from '../state/store'
import { useDebouncedCallback } from './useDebouncedCallback'
import { REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS } from './trackLineSet'
import { useTerrainContext } from './terrainContext'
import { wakeScene } from './renderOnDemand'
import { useFilmClock, useFilmTrack } from './usePacing'
import { setWaterStatus } from './waterStatus'
import { buildRiverStrip, stripHeights } from './riverStrip'
import { buildSeaMesh, buildWaterMesh, lakeLevel, type WaterMesh } from './waterMesh'

/** Height of the surface above the draped relief (metres, not exaggerated: like the track). */
export const WATER_LIFT_M = 2
/** Height of the sea surface above 0 m (metres): a beach a little above the datum is not flooded. */
export const SEA_LIFT_M = 0.5
/** Waves of the sea: longer and a little taller than those of a lake (the shader). */
const SEA_WAVE_LENGTH = 3
const SEA_WAVE_AMPLITUDE = 1.5
/** Deep alpine lake. */
const WATER_COLOR = '#1F4252'
/** Opacity seen from above; grazing angles reflect almost everything (Fresnel). */
const WATER_OPACITY = 0.82
/** Sky reflected without the atmosphere (glacier sky of the plain lighting, linear). */
const PLAIN_SKY = new Color('#A9CCD9')

const vertexHead = /* glsl */ `
attribute float waterFade;
attribute float waterSea;
varying float vWaterFade;
varying float vWaterSea;
varying vec2 vWaterXZ;
`
const vertexBody = /* glsl */ `
vWaterFade = waterFade;
vWaterSea = waterSea;
vWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
`
const fragmentHead = /* glsl */ `
uniform float waterTime;
uniform float waterStrength;
uniform float waterOpacity;
uniform vec3 waterSkyColor;
varying float vWaterFade;
varying float vWaterSea;
varying vec2 vWaterXZ;

// slope of h = a·sin(k·(d·p − c·t)), faded out when the wavelength covers less than ~8 pixels
vec2 waterWave(vec2 p, vec2 dir, float wavelength, float amplitude, float speed) {
  wavelength *= mix(1.0, ${SEA_WAVE_LENGTH.toFixed(1)}, vWaterSea);
  amplitude *= mix(1.0, ${SEA_WAVE_AMPLITUDE.toFixed(1)}, vWaterSea);
  float k = 6.2831853 / wavelength;
  float aa = clamp(wavelength / (8.0 * length(fwidth(p))) - 0.5, 0.0, 1.0);
  return dir * (amplitude * k * cos(k * (dot(dir, p) - speed * waterTime)) * aa);
}
`
const fragmentNormal = /* glsl */ `
{
  vec2 slope = waterWave(vWaterXZ, vec2(0.80, 0.60), 23.0, 0.10, 1.5)
    + waterWave(vWaterXZ, vec2(-0.50, 0.866), 9.0, 0.035, 1.0)
    + waterWave(vWaterXZ, vec2(0.96, -0.28), 4.1, 0.014, 0.7)
    + waterWave(vWaterXZ, vec2(-0.20, -0.98), 1.7, 0.005, 0.45);
  normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);
}
`
const fragmentReflection = /* glsl */ `
{
  float waterCos = saturate(dot(normal, geometryViewDir));
  float fresnel = 0.02 + 0.98 * pow(1.0 - waterCos, 5.0);
  #ifdef USE_LIGHT_PROBES
  // irradiance / π is the cosine-weighted mean radiance around the reflected ray: it averages the bright horizon
  // with the dark sky below it, hence the ray kept above the horizon and a gain
  vec3 ray = inverseTransformDirection(reflect(-geometryViewDir, normal), viewMatrix);
  ray = normalize(vec3(ray.x, max(ray.y, 0.15), ray.z));
  vec3 sky = 1.5 * shGetIrradianceAt(ray, lightProbe) / PI;
  #else
  vec3 sky = waterSkyColor;
  #endif
  reflectedLight.indirectSpecular += sky * fresnel * waterStrength;
  diffuseColor.a = vWaterFade * mix(waterOpacity, 1.0, fresnel) * waterStrength;
}
`

function createWaterMaterial(uniforms: Record<string, Uniform>): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: WATER_COLOR,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // a little nearer than the relief it lies on: the coarse levels of detail of the relief do not reach through
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`)
    shader.fragmentShader =
      fragmentHead +
      shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${fragmentNormal}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${fragmentReflection}`)
  }
  material.customProgramCacheKey = () => 'openflyover-water'
  return material
}

/** Height of each vertex of `mesh` (metres, before exaggeration), NaN where the relief is not loaded yet. */
function sampleHeights(mesh: WaterMesh, engine: TerrainEngine | null): Float64Array {
  const count = mesh.fade.length
  const heights = new Float64Array(count)
  for (let v = 0; v < count; v++) heights[v] = engine?.sampleHeight(mesh.lonLat[2 * v], mesh.lonLat[2 * v + 1]) ?? Number.NaN
  return heights
}

const _p = new Vector3()
const NONE: WaterPolygon[] = []
const NO_LINES: WaterLine[] = []

/** A meshed shape of the water: a lake (flat), a river area (per vertex), the sea (flat at 0 m) or a ribbon (per sample, three vertices each). */
export interface WaterPiece {
  kind: WaterPolygon['kind'] | 'line'
  mesh: WaterMesh
}

/** Height above sea level (metres, before exaggeration and lift) of each vertex of a piece; null when its relief is not known yet. */
function pieceHeights({ kind, mesh }: WaterPiece, engine: TerrainEngine | null): Float64Array | null {
  if (kind === 'sea') return new Float64Array(mesh.fade.length)
  const heights = sampleHeights(mesh, engine)
  if (kind === 'line') {
    const samples = stripHeights(Array.from({ length: mesh.fade.length / 3 }, (_, i) => heights[3 * i + 1]))
    return samples && Float64Array.from({ length: mesh.fade.length }, (_, v) => samples[Math.floor(v / 3)])
  }
  const level = lakeLevel(heights, mesh.fade)
  if (Number.isNaN(level)) return null
  return kind === 'lake' ? new Float64Array(heights.length).fill(level) : heights.map((h) => (Number.isNaN(h) ? level : h))
}

/** Merged geometry of every draped piece whose relief is known. */
function drapeWater(pieces: readonly WaterPiece[], engine: TerrainEngine | null, frame: LocalFrame, exaggeration: number): BufferGeometry {
  const positions: number[] = []
  const fades: number[] = []
  const seas: number[] = []
  const index: number[] = []
  for (const piece of pieces) {
    const { kind, mesh } = piece
    const heights = pieceHeights(piece, engine)
    if (!heights) continue
    const base = positions.length / 3
    for (let v = 0; v < mesh.fade.length; v++) {
      frame.toLocal(mesh.lonLat[2 * v], mesh.lonLat[2 * v + 1], heights[v] * exaggeration + (kind === 'sea' ? SEA_LIFT_M : WATER_LIFT_M), _p)
      positions.push(_p.x, _p.y, _p.z)
      fades.push(mesh.fade[v])
      seas.push(kind === 'sea' ? 1 : 0)
    }
    for (const i of mesh.index) index.push(base + i)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  // up everywhere: the waves of the shader perturb the world vertical
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('waterFade', new BufferAttribute(new Float32Array(fades), 1))
  geometry.setAttribute('waterSea', new BufferAttribute(new Float32Array(seas), 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

export function WaterLayer() {
  const { engine, frame } = useTerrainContext()
  const track = useFilmTrack()
  const enabled = useAppStore((s) => s.settings.water.enabled)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const clock = useFilmClock()
  /** water of the track it was fetched for (shown only for the current first track, setting on) */
  const [fetched, setFetched] = useState<{ trackId: string; polygons: WaterPolygon[]; lines: WaterLine[] } | null>(null)
  const shown = enabled && fetched && fetched.trackId === track?.id ? fetched : null
  const polygons = shown?.polygons ?? NONE
  const lines = shown?.lines ?? NO_LINES
  const uniforms = useMemo(
    () => ({
      waterTime: new Uniform(0),
      waterStrength: new Uniform(1),
      waterOpacity: new Uniform(WATER_OPACITY),
      waterSkyColor: new Uniform(PLAIN_SKY.clone()),
    }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), createWaterMaterial(uniforms))
    m.name = 'water'
    m.receiveShadow = true
    // never picked: the track picker and the camera target the relief and the track
    m.raycast = () => {}
    return m
  }, [uniforms])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  // two Overpass queries per track (cached): the water areas, then the sea and the waterway lines; nothing is sent
  // while the setting is off. What one of them gives is shown even if the other fails.
  useEffect(() => {
    if (!enabled || !track) {
      setWaterStatus('idle')
      return
    }
    // not aborted on cleanup: the queries are shared and cached (StrictMode runs this effect twice), only their
    // answer is ignored once stale
    let current = true
    const trackId = track.id
    setWaterStatus('loading')
    Promise.allSettled([fetchTrackWater(track), fetchTrackWaterShapes(track)]).then(([areas, shapes]) => {
      if (!current) return
      const found = shapes.status === 'fulfilled' ? shapes.value : []
      setFetched({
        trackId,
        polygons: [...(areas.status === 'fulfilled' ? areas.value : []), ...found.filter((s): s is WaterPolygon => !isWaterLine(s))],
        lines: found.filter(isWaterLine),
      })
      setWaterStatus(areas.status === 'fulfilled' && shapes.status === 'fulfilled' ? 'ready' : 'error')
    })
    return () => {
      current = false
    }
  }, [enabled, track])
  useEffect(() => useWaterStore.setState({ polygons: polygons.length + lines.length }), [polygons, lines])
  useEffect(
    () => () => {
      useWaterStore.setState({ polygons: 0 })
      setWaterStatus('idle')
    },
    [],
  )

  const pieces = useMemo<WaterPiece[]>(
    () => [
      ...polygons.map((polygon): WaterPiece => ({ kind: polygon.kind, mesh: polygon.kind === 'sea' ? buildSeaMesh(polygon) : buildWaterMesh(polygon) })),
      // a river mapped as a line inside a riverbank polygon is the polygon's
      ...lines
        .flatMap((line) => runsOutside(line, polygons))
        .map((line): WaterPiece => ({ kind: 'line', mesh: buildRiverStrip(line.points, lineWidthM(line)) })),
    ],
    [polygons, lines],
  )
  const drape = useCallback(
    (current: TerrainEngine | null, factor: number) => {
      if (!frame) return
      const previous = mesh.geometry
      mesh.geometry = drapeWater(pieces, current, frame, factor)
      previous.dispose()
      wakeScene()
    },
    [mesh, frame, pieces],
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

  useFrame(() => {
    const { playback, settings } = useAppStore.getState()
    uniforms.waterTime.value = playback.timeS ?? clock.timeAtProgress(playback.progress)
    uniforms.waterStrength.value = Math.min(1, Math.max(0, settings.water.strength))
  })

  if (pieces.length === 0) return null
  return <primitive object={mesh} dispose={null} />
}
