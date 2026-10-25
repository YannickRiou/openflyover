import { describe, expect, it, vi } from 'vitest'
import { Color, Group, Vector3 } from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import type { BufferAttribute, InterleavedBufferAttribute, MeshBasicMaterial, ShaderMaterial, TypedArray } from 'three'
import type { TerrainEngine, Track, TrackPoint } from '../core/types'
import { buildSequence } from '../flyover/sequence'
import { createLocalFrame } from '../geo/ellipsoid'
import { DEFAULT_TRACK_STYLE } from './markerSettings'
import { CURTAIN_TOP_ALPHA, NO_TRAIL, SHADOW_WIDTH_SHARE, TRACK_GLOW_MAX_STRENGTH } from './trackLineStyle'
import type { TrackLineSet } from './trackLineSet'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const {
  buildDrapeBuffer,
  computeDrapedPositions,
  writeLinePositions,
  syncTrackLineSets,
  drapeTrackLineSet,
  disposeTrackLineSet,
  applyExposure,
  applyFlightDepth,
  applyResolution,
  dimTrackLineSet,
  applyTrackColors,
  applyTrackStyle,
  cutTrackLineSet,
  drawOnDistances,
  writeLineColors,
  CURTAIN_LIFT_M,
  LINE_LIFT_M,
  LINE_WIDTH_PX,
  DENSIFY_STEP_M,
} = await import('./trackLineSet')

const frame = createLocalFrame(6.5, 45.5)
const points: TrackPoint[] = [
  { lon: 6.5, lat: 45.5, ele: 1000 },
  { lon: 6.51, lat: 45.505, ele: 1100 },
  { lon: 6.52, lat: 45.51 }, // no recorded elevation
]

function expectLocal(out: ArrayLike<number>, index: number, lon: number, lat: number, height: number) {
  const expected = frame.toLocal(lon, lat, height)
  const o = index * 3
  expect(out[o]).toBeCloseTo(expected.x, 3)
  expect(out[o + 1]).toBeCloseTo(expected.y, 3)
  expect(out[o + 2]).toBeCloseTo(expected.z, 3)
}

describe('buildDrapeBuffer / computeDrapedPositions', () => {
  it('reproduces frame.toLocal at the draped height without the terrain', () => {
    const buffer = buildDrapeBuffer(points, frame)
    expect(buffer.count).toBe(3)
    expect(Number.isNaN(buffer.ele[2])).toBe(true)

    const out = computeDrapedPositions(buffer, null, 1, new Float32Array(9))
    expectLocal(out, 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
    expectLocal(out, 1, 6.51, 45.505, 1100 + LINE_LIFT_M)
    // no elevation at all -> 0 m
    expectLocal(out, 2, 6.52, 45.51, LINE_LIFT_M)
  })

  it('prefers the terrain height, falls back to the recorded elevation, and applies the exaggeration', () => {
    const buffer = buildDrapeBuffer(points, frame)
    const sampler = (lon: number) => (lon > 6.505 ? 2000 : undefined)
    const out = computeDrapedPositions(buffer, sampler, 1.5, new Float32Array(9))
    expectLocal(out, 0, 6.5, 45.5, 1000 * 1.5 + LINE_LIFT_M)
    expectLocal(out, 1, 6.51, 45.505, 2000 * 1.5 + LINE_LIFT_M)
    expectLocal(out, 2, 6.52, 45.51, 2000 * 1.5 + LINE_LIFT_M)
  })

  it('keeps the recorded height in a flight, less the device offset, never under the terrain', () => {
    const buffer = buildDrapeBuffer(points.slice(0, 2), frame)
    buffer.flight.fill(20)
    const out = computeDrapedPositions(buffer, (lon) => (lon > 6.505 ? 1500 : 500), 2, new Float32Array(6))
    expectLocal(out, 0, 6.5, 45.5, (1000 - 20) * 2 + LINE_LIFT_M)
    expectLocal(out, 1, 6.51, 45.505, 1500 * 2 + LINE_LIFT_M)
  })

  it('treats a NaN terrain sample as unknown', () => {
    const buffer = buildDrapeBuffer(points.slice(0, 1), frame)
    const out = computeDrapedPositions(buffer, () => Number.NaN, 1, new Float32Array(3))
    expectLocal(out, 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
  })
})

/** the pieces a line draws, as [start, end] points */
function drawnPieces(geometry: LineGeometry): number[][][] {
  const start = geometry.getAttribute('instanceStart')
  const end = geometry.getAttribute('instanceEnd')
  if (!start || !end) return []
  const at = (a: typeof start, i: number) => [a.getX(i), a.getY(i), a.getZ(i)]
  return Array.from({ length: Math.min(start.count, geometry.instanceCount) }, (_, i) => [at(start, i), at(end, i)])
}

describe('writeLinePositions', () => {
  const containsAll = (geometry: LineGeometry, points: number[][]) =>
    points.every(([x, y, z]) => geometry.boundingSphere!.distanceToPoint(new Vector3(x, y, z)) < 1e-6)

  it('draws the polyline piece by piece, then follows new points of the same or another count', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
    expect(drawnPieces(geometry)).toEqual([
      [[0, 0, 0], [1, 0, 0]],
      [[1, 0, 0], [1, 1, 0]],
    ])

    writeLinePositions(geometry, new Float32Array([0, 5, 1, 1, 5, 2, 1, 6, 3]))
    expect(drawnPieces(geometry)).toEqual([
      [[0, 5, 1], [1, 5, 2]],
      [[1, 5, 2], [1, 6, 3]],
    ])
    // the bounds follow, or the moved line would be culled
    expect(containsAll(geometry, [[0, 5, 1], [1, 6, 3]])).toBe(true)

    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 2, 0]))
    expect(drawnPieces(geometry)).toHaveLength(3)
    expect(drawnPieces(geometry)[2]).toEqual([[1, 1, 0], [2, 2, 0]])
    expect(containsAll(geometry, [[0, 0, 0], [2, 2, 0]])).toBe(true)
    geometry.dispose()
  })

  it('ignores degenerate polylines (fewer than two points)', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0]))
    expect(drawnPieces(geometry)).toEqual([])
    geometry.dispose()
  })
})

// ---------------------------------------------------------------------------
// Three.js object management (runs in jsdom: Line2 / LineMaterial need no WebGL to be constructed)
// ---------------------------------------------------------------------------

function makeTrack(id: string, segments: TrackPoint[][], color = '#ff0000'): Track {
  return {
    id,
    name: id,
    source: 'gpx',
    segments: segments.map((pts) => ({ points: pts })),
    stats: { distanceM: 0, ascentM: 0, descentM: 0, pointCount: segments.flat().length },
    bounds: { west: 6.5, south: 45.5, east: 6.52, north: 45.51 },
    color,
  }
}

/** Two points ~110 m apart (densified to 12 points at 10 m) and a second, separate ~5 m segment (not densified). */
const segmentA: TrackPoint[] = [
  { lon: 6.5, lat: 45.5, ele: 1000 },
  { lon: 6.5, lat: 45.501, ele: 1050 },
]
const segmentB: TrackPoint[] = [
  { lon: 6.51, lat: 45.505, ele: 1100 },
  { lon: 6.51005, lat: 45.50503, ele: 1110 },
]
const lastPoint = segmentB[segmentB.length - 1]

function fakeEngine(height: number): TerrainEngine {
  return {
    group: new Group(),
    update: vi.fn(),
    sampleHeight: () => height,
    setOptions: vi.fn(),
    onChange: () => () => {},
    stats: { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 },
    dispose: vi.fn(),
  }
}

describe('syncTrackLineSets', () => {
  it('builds one solid + one glow Line2 per segment (segments are not joined) (no start / end mesh: Labels pins them)', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const track = makeTrack('a', [segmentA, [{ lon: 6, lat: 45 }], segmentB])

    syncTrackLineSets(group, sets, [track], frame, 800, 600)

    const set = sets.get('a')!
    expect(group.children).toEqual([set.object])
    // the single-point segment is skipped
    expect(set.segments).toHaveLength(2)
    expect(set.segments[0].buffer.count).toBeGreaterThanOrEqual(Math.ceil(110 / DENSIFY_STEP_M) + 1)
    expect(set.segments[1].buffer.count).toBe(segmentB.length)
    // each segment is drawn on its own points: no line across the gap
    drapeTrackLineSet(set, null, 1)
    const [first, second] = set.segments.map((segment) => drawnPieces(segment.solid.geometry))
    expectLocal(first.at(-1)![1], 0, 6.5, 45.501, 1050 + LINE_LIFT_M)
    expectLocal(second[0][0], 0, 6.51, 45.505, 1100 + LINE_LIFT_M)
    for (const segment of set.segments) {
      expect(drawnPieces(segment.glow.geometry)).toEqual(drawnPieces(segment.solid.geometry))
      expect(segment.solid.visible).toBe(true)
      expect(segment.glow.visible).toBe(false)
    }

    // 4 px lines in the track colour
    expect(set.solidMaterial.linewidth).toBe(LINE_WIDTH_PX)
    expect(set.solidMaterial.color.getHexString()).toBe('ff0000')
    // the relief hides the parts behind it: no pass without the depth test (a translucent one piles up its
    // overlapping round caps into an opaque line far away)
    set.object.traverse((object) => {
      if (object instanceof Line2) expect(object.material.depthTest).toBe(true)
    })
    expect(set.object.children).toHaveLength(2 * set.segments.length)

    syncTrackLineSets(group, sets, [], frame, 800, 600)
  })

  it('keeps an unchanged track, rebuilds a replaced one and drops a removed one (disposing resources)', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const a = makeTrack('a', [segmentA])
    const b = makeTrack('b', [segmentB])

    syncTrackLineSets(group, sets, [a, b], frame, 800, 600)
    const setA = sets.get('a')!
    const setB = sets.get('b')!
    expect(group.children).toHaveLength(2)

    // same track objects: nothing is rebuilt
    expect(syncTrackLineSets(group, sets, [a, b], frame, 800, 600)).toEqual([])
    expect(sets.get('a')).toBe(setA)
    expect(sets.get('b')).toBe(setB)

    // recoloured or renamed (a new object, the same points): kept, its colour read by the next exposure
    const recoloured = { ...a, color: '#0000ff', name: 'Autre' }
    expect(syncTrackLineSets(group, sets, [recoloured, b], frame, 800, 600)).toEqual([])
    expect(sets.get('a')).toBe(setA)
    expect(setA.track).toBe(recoloured)
    applyExposure([setA], 1)
    expect(setA.solidMaterial.color.getHexString()).toBe('0000ff')

    // a replaced by a new object with the same id, b removed
    const geometryDispose = vi.spyOn(setA.segments[0].geometry, 'dispose')
    const solidDispose = vi.spyOn(setA.solidMaterial, 'dispose')
    const glowDispose = vi.spyOn(setA.glowMaterial, 'dispose')
    const bGeometryDispose = vi.spyOn(setB.segments[0].geometry, 'dispose')
    const a2 = makeTrack('a', [segmentA], '#00ff00')
    expect(syncTrackLineSets(group, sets, [a2], frame, 800, 600)).toEqual([sets.get('a')])

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(solidDispose).toHaveBeenCalledTimes(1)
    expect(glowDispose).toHaveBeenCalledTimes(1)
    expect(bGeometryDispose).toHaveBeenCalledTimes(1)
    expect(sets.has('b')).toBe(false)
    const setA2 = sets.get('a')!
    expect(setA2).not.toBe(setA)
    expect(setA2.solidMaterial.color.getHexString()).toBe('00ff00')
    expect(group.children).toEqual([setA2.object])
    expect(setA.object.parent).toBeNull()
    expect(setB.object.parent).toBeNull()

    syncTrackLineSets(group, sets, [], frame, 800, 600)
    expect(sets.size).toBe(0)
    expect(group.children).toHaveLength(0)
  })

  it('rebuilds when the local frame changes and builds nothing without a frame', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const a = makeTrack('a', [segmentA])

    syncTrackLineSets(group, sets, [a], null, 800, 600)
    expect(sets.size).toBe(0)
    expect(group.children).toHaveLength(0)

    syncTrackLineSets(group, sets, [a], frame, 800, 600)
    const first = sets.get('a')!
    const otherFrame = createLocalFrame(6.6, 45.6)
    syncTrackLineSets(group, sets, [a], otherFrame, 800, 600)
    const second = sets.get('a')!
    expect(second).not.toBe(first)
    expect(second.frame).toBe(otherFrame)
    expect(group.children).toEqual([second.object])

    syncTrackLineSets(group, sets, [], frame, 800, 600)
  })

  it('smooths the points before densifying, keeps the recorded distances and rebuilds when the smoothing changes', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    // northwards every ~11 m, zigzagging 4 m east and west
    const zigzag: TrackPoint[] = Array.from({ length: 30 }, (_, i) => ({ lon: 6.5 + (i % 2 === 0 ? 5e-5 : -5e-5), lat: 45.5 + i * 1e-4 }))
    const a = makeTrack('a', [zigzag])

    syncTrackLineSets(group, sets, [a], frame, 800, 600)
    const raw = sets.get('a')!
    expect(raw.smoothingM).toBe(0)
    expect(raw.segments[0].source).toBe(a.segments[0].points)

    syncTrackLineSets(group, sets, [a], frame, 800, 600, 100)
    const smoothed = sets.get('a')!
    expect(smoothed).not.toBe(raw)
    expect(raw.object.parent).toBeNull()
    const [segment] = smoothed.segments
    expect(segment.source).not.toBe(a.segments[0].points)
    expect(Math.max(...segment.source.slice(2, -2).map((p) => Math.abs(p.lon - 6.5)))).toBeLessThan(1e-5)
    // same distance scale as the recorded line (and the marker), though the smoothed line is shorter
    expect(segment.dist[segment.dist.length - 1]).toBeCloseTo(raw.segments[0].dist[raw.segments[0].dist.length - 1], 3)

    syncTrackLineSets(group, sets, [a], frame, 800, 600, 100)
    expect(sets.get('a')).toBe(smoothed)
    syncTrackLineSets(group, sets, [], frame, 800, 600)
  })
})

describe('applyExposure', () => {
  it('divides the line colours by the exposure and restores them at 1', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    const set = sets.get('a')!

    applyExposure(sets.values(), 10)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.1, 6)
    expect(set.glowMaterial.color.equals(set.solidMaterial.color)).toBe(true)
    applyExposure(sets.values(), 1)
    expect(set.solidMaterial.color.getHexString()).toBe('ff0000')
  })

  it('gives the glow its own colour, over the per-vertex colours too, and the track colour back', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    const set = sets.get('a')!
    drapeTrackLineSet(set, null, 1)
    applyTrackColors(sets.values(), 'elevation')

    applyExposure(sets.values(), 2, '#ffff00')
    expect(set.glowMaterial.vertexColors).toBe(false)
    expect(set.glowMaterial.color.r).toBeCloseTo(0.5, 6)
    expect(set.glowMaterial.color.b).toBe(0)
    expect(set.solidMaterial.vertexColors).toBe(true)

    applyExposure(sets.values(), 1)
    expect(set.glowMaterial.vertexColors).toBe(true)
    expect(set.glowMaterial.color.getHexString()).toBe('ffffff')
  })
})

describe('dimTrackLineSet', () => {
  it('draws a track in a share of its colours at once, and keeps the share through the exposure', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    const set = sets.get('a')!
    applyExposure(sets.values(), 2)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.5, 6)
    dimTrackLineSet(set, 0.4)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.2, 6)
    expect(set.glowMaterial.color.r).toBeCloseTo(0.2, 6)
    // a new exposure keeps the dimmer tone, the full one comes back with 1
    applyExposure(sets.values(), 4)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.1, 6)
    dimTrackLineSet(set, 1)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.25, 6)
    dimTrackLineSet(set, 1)
    expect(set.solidMaterial.color.r).toBeCloseTo(0.25, 6)
  })
})

describe('applyTrackColors', () => {
  const colorStart = (set: TrackLineSet, k = 0) =>
    set.segments[k].geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute | undefined

  it('colours every densified vertex by the metric, with one range for all tracks, and restores the track colour', () => {
    const sets = new Map<string, TrackLineSet>()
    const low = makeTrack('low', [segmentA]) // 1000 -> 1050 m over 12 densified points
    const high = makeTrack('high', [segmentB]) // 1100 -> 1110 m
    syncTrackLineSets(new Group(), sets, [low, high], frame, 800, 600)
    const setLow = sets.get('low')!
    const setHigh = sets.get('high')!
    const geometry = setLow.segments[0].geometry
    drapeTrackLineSet(setLow, null, 1)
    const positions = geometry.getAttribute('instanceStart')

    applyTrackColors(sets.values(), 'elevation')
    for (const set of [setLow, setHigh]) {
      expect(set.solidMaterial.vertexColors).toBe(true)
      expect(set.glowMaterial.vertexColors).toBe(true)
    }
    const colors = colorStart(setLow)!
    expect(colors.count).toBe(setLow.segments[0].buffer.count - 1)
    // viridis: lightness (green channel) grows with elevation along the densified points
    for (let i = 1; i < colors.count; i++) expect(colors.getY(i)).toBeGreaterThan(colors.getY(i - 1))
    // the range spans both tracks: 1000 m is the dark end, 1110 m the bright one (#440154 / #fde725)
    expect(new Color().setRGB(colors.getX(0), colors.getY(0), colors.getZ(0)).getHexString()).toBe('440154')
    const end = colorStart(setHigh)!
    expect(new Color().setRGB(end.getX(0), end.getY(0), end.getZ(0)).getHexString()).not.toBe('440154')

    // exposure: vertex colours are scaled by a white material colour
    applyExposure(sets.values(), 4)
    expect(setLow.solidMaterial.color.toArray()).toEqual([0.25, 0.25, 0.25])

    // another mode rewrites the colours in place; geometry positions are untouched
    const colorBuffer = colors.data
    applyTrackColors(sets.values(), 'slope')
    expect(colorStart(setLow)!.data).toBe(colorBuffer)
    expect(geometry.getAttribute('instanceStart')).toBe(positions)

    applyTrackColors(sets.values(), 'none')
    expect(setLow.solidMaterial.vertexColors).toBe(false)
    expect(colorStart(setLow)).toBeUndefined()
    applyExposure(sets.values(), 1)
    expect(setLow.solidMaterial.color.getHexString()).toBe('ff0000')
  })

  it('greys out a track without the quantity', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    applyTrackColors(sets.values(), 'heartRate')
    const colors = colorStart(sets.get('a')!)!
    expect(new Color().setRGB(colors.getX(0), colors.getY(0), colors.getZ(0)).getHexString()).toBe('55626b')
  })
})

describe('writeLineColors', () => {
  it('builds the colour pairs once, then updates them in place', () => {
    const geometry = new LineGeometry()
    writeLineColors(geometry, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]))
    const start = geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute
    expect(Array.from(start.data.array as TypedArray)).toEqual([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1])
    const version = start.data.version
    writeLineColors(geometry, new Float32Array([0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1]))
    expect(geometry.getAttribute('instanceColorStart')).toBe(start)
    expect(start.data.version).toBeGreaterThan(version)
    expect(Array.from(start.data.array as TypedArray)).toEqual([0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1])
    geometry.dispose()
  })
})

describe('drapeTrackLineSet', () => {
  it('drapes every segment on the terrain, from the first point to the last', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const track = makeTrack('a', [segmentA, segmentB])
    syncTrackLineSets(group, sets, [track], frame, 800, 600)
    const set = sets.get('a')!

    drapeTrackLineSet(set, fakeEngine(2000), 1.5)
    const h = 2000 * 1.5 + LINE_LIFT_M

    // geometry of the first segment: segment 0 starts at the first point, last segment ends at the last
    const startA = set.segments[0].geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    expectLocal(startA.data.array as TypedArray, 0, 6.5, 45.5, h)
    expect(startA.count).toBe(set.segments[0].buffer.count - 1)
    const endB = set.segments[1].geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute
    const lastSegment = endB.count - 1
    const end = () => [endB.getX(lastSegment), endB.getY(lastSegment), endB.getZ(lastSegment)]
    expectLocal(end(), 0, lastPoint.lon, lastPoint.lat, h)

    // a re-drape without terrain falls back to the recorded elevations, in place
    const bufferBefore = startA.data
    drapeTrackLineSet(set, null, 1)
    expect((set.segments[0].geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data).toBe(
      bufferBefore,
    )
    expectLocal(startA.data.array as TypedArray, 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
    expectLocal(end(), 0, lastPoint.lon, lastPoint.lat, 1110 + LINE_LIFT_M)

    disposeTrackLineSet(set)
  })
})

describe('applyTrackStyle', () => {
  it('sets the widths (times the render scale), the glow and the dashes of every material', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    const set = sets.get('a')!
    drapeTrackLineSet(set, null, 1)

    const style = { ...DEFAULT_TRACK_STYLE, width: 6, dash: 'tirets', glow: true, glowWidth: 30, glowIntensity: 0.5 } as const
    applyTrackStyle(sets.values(), style, 2, 0.5)
    expect(set.solidMaterial.linewidth).toBe(12)
    expect(set.glowMaterial.linewidth).toBe(60)
    expect(set.segments[0].glow.visible).toBe(true)
    // the halo starts at the edge of the line (6 of 30 px), at half the full strength
    expect(set.glowMaterial.uniforms.glowInner.value).toBeCloseTo(0.2, 6)
    expect(set.glowMaterial.uniforms.glowStrength.value).toBeCloseTo(0.5 * TRACK_GLOW_MAX_STRENGTH, 6)
    expect(set.solidMaterial.dashed).toBe(true)
    expect(set.solidMaterial.dashScale).toBe(2)
    // dash distances are measured along the draped line
    expect(set.segments[0].geometry.getAttribute('instanceDistanceStart')).toBeDefined()

    applyTrackStyle(sets.values(), DEFAULT_TRACK_STYLE, 1, 0)
    expect(set.solidMaterial.dashed).toBe(false)
    expect(set.segments[0].glow.visible).toBe(false)
  })
})

describe('draw-on (« trace qui se dessine »)', () => {
  it('draws the first track to its marker and the others whole without a race', () => {
    const lead = { ...makeTrack('a', [segmentA]), stats: { distanceM: 200, ascentM: 0, descentM: 0, pointCount: 2 } }
    expect(drawOnDistances([lead, makeTrack('b', [segmentB])], 0.25, null)).toEqual([50, Infinity])
    expect(drawOnDistances([], 0.5, null)).toEqual([])
  })

  it('« À la suite »: the stages flown whole, the current one to the marker, the next ones not yet', () => {
    const tracks = [makeTrack('a', [segmentA]), makeTrack('b', [segmentB]), makeTrack('c', [segmentA])]
    const sequence = buildSequence(tracks)
    const [a, b] = sequence.stages
    const at = (b.startM + (b.endM - b.startM) / 2) / sequence.stages[2].endM
    const [da, db, dc] = drawOnDistances(tracks, at, null, sequence)
    expect(da).toBeCloseTo(a.endM + (b.endM - b.startM) / 2, 6)
    expect(db).toBeCloseTo((b.endM - b.startM) / 2, 6)
    expect(dc).toBe(0)
  })

  it('cuts every segment at a distance counted along the whole track, then draws it whole again', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA, segmentB])], frame, 800, 600)
    const set = sets.get('a')!
    drapeTrackLineSet(set, null, 1)
    const [first, second] = set.segments
    const pieces = first.buffer.count - 1

    // halfway along the first segment: about half its pieces, the second segment hidden
    cutTrackLineSet(set, first.dist[first.dist.length - 1] / 2)
    expect(first.geometry.instanceCount).toBeGreaterThan(0)
    expect(first.geometry.instanceCount).toBeLessThan(pieces)
    expect(second.geometry.instanceCount).toBe(0)
    // the second segment starts where the first ends (no distance across the gap)
    expect(second.dist[0]).toBeCloseTo(first.dist[first.dist.length - 1], 6)

    cutTrackLineSet(set, Infinity)
    expect(first.geometry.instanceCount).toBe(pieces)
    expect(second.geometry.instanceCount).toBe(1)
    expect(first.shortened).toBe(-1)
  })

  it('« Traînée »: the line and its halo skip what lies before the trail, a track drawn whole stays whole', () => {
    const sets = new Map<string, TrackLineSet>()
    syncTrackLineSets(new Group(), sets, [makeTrack('a', [segmentA])], frame, 800, 600)
    const set = sets.get('a')!
    drapeTrackLineSet(set, null, 1)
    const trailStart = () => [set.solidMaterial, set.glowMaterial].map((m) => m.uniforms.trailStartM.value as number)

    cutTrackLineSet(set, 500, 200)
    expect(trailStart()).toEqual([300, 300])
    const trailFade = () => [set.solidMaterial, set.glowMaterial].map((m) => m.uniforms.trailFadeM.value as number)
    // the oldest half thins out
    expect(trailFade()).toEqual([100, 100])
    const drawn = set.segments[0].geometry.instanceCount
    // paused (the marker has not moved): a new length still applies
    cutTrackLineSet(set, 500, 400)
    expect(trailStart()).toEqual([100, 100])
    expect(set.segments[0].geometry.instanceCount).toBe(drawn)
    // whole, or no trail: nothing skipped
    cutTrackLineSet(set, Infinity, 200)
    expect(trailStart()).toEqual([NO_TRAIL, NO_TRAIL])
    cutTrackLineSet(set, 500)
    expect(trailStart()).toEqual([NO_TRAIL, NO_TRAIL])
    expect(trailFade()).toEqual([0, 0])
  })
})

describe('flights: curtain, ground shadow, width weights', () => {
  // 1.1 km north, recorded 500 m above the 1000 m terrain; the flight is the stretch 300..800 m
  const air: TrackPoint[] = [
    { lon: 6.5, lat: 45.5, ele: 1500 },
    { lon: 6.5, lat: 45.505, ele: 1600 },
    { lon: 6.5, lat: 45.51, ele: 1500 },
  ]
  const flights = [{ startM: 300, endM: 800, offsetM: 0 }]
  const build = (withFlights: boolean) => {
    const sets = new Map<string, TrackLineSet>()
    const track = { ...makeTrack('f', [air]), flights: withFlights ? flights : undefined }
    syncTrackLineSets(new Group(), sets, [track], frame, 800, 600)
    return sets.get('f')!
  }
  const at = (attribute: BufferAttribute, v: number) => [attribute.getX(v), attribute.getY(v), attribute.getZ(v)]

  it('builds a strip per flight and nothing on the ground: two vertices per point of the flight only', () => {
    const none = build(false)
    expect(none.segments[0].flights).toEqual([])
    expect(none.object.children.some((c) => c.name === 'track-curtain' || c.name === 'track-shadow')).toBe(false)
    expect(none.segments[0].geometry.getAttribute('instanceFlightStart')).toBeUndefined()

    const set = build(true)
    const [segment] = set.segments
    expect(segment.flights).toHaveLength(1)
    const [piece] = segment.flights
    // the first and last points of the strip are the flight's, the points around it are on the ground
    expect(segment.dist[piece.first]).toBeGreaterThanOrEqual(300)
    expect(segment.dist[piece.first + piece.count - 1]).toBeLessThanOrEqual(800)
    expect(Number.isNaN(segment.buffer.flight[piece.first - 1])).toBe(true)
    expect(Number.isNaN(segment.buffer.flight[piece.first + piece.count])).toBe(true)
    expect(segment.buffer.count).toBeGreaterThan(piece.count * 2)
    for (const mesh of [piece.curtain, piece.shadow]) {
      expect(mesh.geometry.getAttribute('position').count).toBe(piece.count * 2)
      expect(mesh.geometry.getIndex()!.count).toBe((piece.count - 1) * 6)
    }
    expect(set.object.children).toContain(piece.curtain)
    expect(set.object.children).toContain(piece.shadow)
    disposeTrackLineSet(set)
  })

  it('drapes the curtain from the flight down to the relief, and the shadow on the relief', () => {
    const set = build(true)
    const [segment] = set.segments
    const [piece] = segment.flights
    drapeTrackLineSet(set, fakeEngine(1000), 2)
    const curtain = piece.curtain.geometry.getAttribute('position') as BufferAttribute
    const shadow = piece.shadow.geometry.getAttribute('position') as BufferAttribute
    for (const k of [0, Math.floor(piece.count / 2), piece.count - 1]) {
      const p = segment.points[piece.first + k]
      const top = Math.max(1000, segment.buffer.ele[piece.first + k]) * 2 + CURTAIN_LIFT_M
      const ground = 1000 * 2 + LINE_LIFT_M
      for (const [vertex, height] of [[2 * k, top], [2 * k + 1, ground]] as const) {
        const expected = frame.toLocal(p.lon, p.lat, height)
        expect(at(curtain, vertex)[0]).toBeCloseTo(expected.x, 2)
        expect(at(curtain, vertex)[1]).toBeCloseTo(expected.y, 2)
        expect(at(curtain, vertex)[2]).toBeCloseTo(expected.z, 2)
      }
      // the shadow is the ground foot of the curtain, on both sides of the strip
      expect(at(shadow, 2 * k)).toEqual(at(curtain, 2 * k + 1))
      expect(at(shadow, 2 * k + 1)).toEqual(at(curtain, 2 * k + 1))
    }
    // the shadow knows its direction of travel, for its width in the screen
    const ahead = piece.shadow.geometry.getAttribute('ahead') as BufferAttribute
    expect(Math.hypot(...at(ahead, 0))).toBeGreaterThan(5)

    // tiles load: the re-drape follows the new ground; a ground above the flight never flips the strip
    drapeTrackLineSet(set, fakeEngine(5000), 1)
    const flat = frame.toLocal(segment.points[piece.first].lon, segment.points[piece.first].lat, 5000 + CURTAIN_LIFT_M)
    expect(at(curtain, 0)[0]).toBeCloseTo(flat.x, 2)
    expect(at(curtain, 1)[0]).toBeCloseTo(flat.x, 2)
    expect(at(curtain, 1)[1]).toBeCloseTo(at(curtain, 0)[1], 2)
    // no terrain yet: the strip collapses onto the flight
    drapeTrackLineSet(set, null, 1)
    expect(at(curtain, 1)).toEqual(at(curtain, 0))
    disposeTrackLineSet(set)
  })

  it('colours the curtain like the line, from opaque-ish at the line to nothing at the ground, white without colouring', () => {
    const set = build(true)
    const [segment] = set.segments
    const [piece] = segment.flights
    const color = piece.curtain.geometry.getAttribute('color') as BufferAttribute
    expect(color.itemSize).toBe(4)
    expect(Array.from(color.array.slice(0, 8))).toEqual([1, 1, 1, CURTAIN_TOP_ALPHA, 1, 1, 1, 0])

    drapeTrackLineSet(set, null, 1)
    applyTrackColors([set], 'elevation')
    const line = segment.geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute
    for (const k of [0, piece.count - 1]) {
      const i = piece.first + k
      expect(color.getX(2 * k)).toBeCloseTo(line.getX(i), 6)
      expect(color.getY(2 * k)).toBeCloseTo(line.getY(i), 6)
      expect(color.getZ(2 * k + 1)).toBeCloseTo(line.getZ(i), 6)
      expect(color.getW(2 * k)).toBeCloseTo(CURTAIN_TOP_ALPHA, 6)
      expect(color.getW(2 * k + 1)).toBe(0)
    }
    expect(color.getX(0)).not.toBe(1)
    // the material carries the track colour only without colouring
    applyExposure([set], 2)
    expect(set.curtainMaterial.color.toArray()).toEqual([0.5, 0.5, 0.5])
    applyTrackColors([set], 'none')
    expect(Array.from(color.array.slice(0, 8))).toEqual([1, 1, 1, CURTAIN_TOP_ALPHA, 1, 1, 1, 0])
    applyExposure([set], 2)
    expect(set.curtainMaterial.color.r).toBeCloseTo(0.5, 6)
    expect(set.curtainMaterial.color.g).toBe(0)
    // a track drawn dimmer in a « Bilan » dims its curtain too
    dimTrackLineSet(set, 0.5)
    expect(set.curtainMaterial.color.r).toBeCloseTo(0.25, 6)
    disposeTrackLineSet(set)
  })

  it('shows the curtain and the shadow with their own switches, the shadow as wide as the line times its share', () => {
    const set = build(true)
    const [piece] = set.segments[0].flights
    applyTrackStyle([set], { ...DEFAULT_TRACK_STYLE, width: 4 }, 2, 0)
    expect(piece.curtain.visible).toBe(true)
    expect(piece.shadow.visible).toBe(true)
    expect(set.shadowMaterial.uniforms.widthPx.value).toBe(4 * SHADOW_WIDTH_SHARE * 2)
    applyTrackStyle([set], { ...DEFAULT_TRACK_STYLE, flightCurtain: false }, 1, 0)
    expect(piece.curtain.visible).toBe(false)
    expect(piece.shadow.visible).toBe(true)
    applyTrackStyle([set], { ...DEFAULT_TRACK_STYLE, flightShadow: false }, 1, 0)
    expect(piece.curtain.visible).toBe(true)
    expect(piece.shadow.visible).toBe(false)
  })

  it('follows the draw-on and the trail like the line: cut at the marker, nothing before the trail', () => {
    const set = build(true)
    const cut = (m: ShaderMaterial | MeshBasicMaterial) => m.userData.cut as Record<string, { value: number }>
    cutTrackLineSet(set, 500, 200)
    for (const material of [set.curtainMaterial, set.shadowMaterial]) {
      expect(cut(material).trailStartM.value).toBe(300)
      expect(cut(material).trailFadeM.value).toBe(100)
      expect(cut(material).drawEndM.value).toBe(500)
    }
    // whole again: nothing cut (a finite stand-in for infinity: a GLSL float)
    cutTrackLineSet(set, Infinity)
    expect(cut(set.curtainMaterial).trailStartM.value).toBe(NO_TRAIL)
    expect(cut(set.shadowMaterial).drawEndM.value).toBeGreaterThan(1e8)
    disposeTrackLineSet(set)
  })

  it('weights the width by the flight, easing in and out at both ends: 0 on the ground, 1 inside', () => {
    const set = build(true)
    const [segment] = set.segments
    const start = segment.geometry.getAttribute('instanceFlightStart') as InterleavedBufferAttribute
    const weight = (i: number) => start.getX(i)
    const dist = (i: number) => segment.dist[i]
    for (let i = 0; i < start.count; i++) {
      if (dist(i) < 300 || dist(i) > 800) expect(weight(i)).toBe(0)
      else if (dist(i) >= 400 && dist(i) <= 700) expect(weight(i)).toBe(1)
      else expect(weight(i)).toBeLessThanOrEqual(1)
    }
    // in between it rises without a step
    const rising = Array.from({ length: start.count }, (_, i) => i).filter((i) => dist(i) >= 300 && dist(i) <= 400)
    for (let j = 1; j < rising.length; j++) {
      expect(weight(rising[j])).toBeGreaterThanOrEqual(weight(rising[j - 1]))
      expect(weight(rising[j]) - weight(rising[j - 1])).toBeLessThan(0.15)
    }
    disposeTrackLineSet(set)
  })

  it('tells the line materials the distance the width is the user\'s at, and the shadow the canvas size', () => {
    const set = build(true)
    applyFlightDepth([set], 1234)
    expect(set.solidMaterial.uniforms.flightDepthM.value).toBe(1234)
    expect(set.glowMaterial.uniforms.flightDepthM.value).toBe(1234)
    applyResolution([set], 1920, 1080)
    expect(set.shadowMaterial.uniforms.resolution.value.toArray()).toEqual([1920, 1080])
    disposeTrackLineSet(set)
  })
})
