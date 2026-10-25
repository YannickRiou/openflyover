import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Sprite, Vector3 } from 'three'
import { createLocalFrame } from '../geo/ellipsoid'
import { focalDolly, fovDegOf } from '../flyover/cameraSettings'
import { buildTrackPath, samplePath } from '../flyover/path'
import type { Track } from '../core/types'
import { DEFAULT_MARKER } from './markerSettings'
import type { MarkerSettings } from './markerSettings'
import { markerLayout, PX_PER_BALL } from './markerBadge'
import {
  BADGE_SCALE,
  headsLeft,
  screenHeading,
  leadMarkerColors,
  markerBadge,
  markerLook,
  MARKER_DEPTH_PULL_M,
  pullMarkerForward,
  placeMarker,
  RACE_HALO_SCALE,
  racerMarkerColors,
} from './markerSprite'

const picture = { naturalWidth: 10, naturalHeight: 10, src: 'data:image/png;base64,AA' } as HTMLImageElement
const look = (kind: 'boule' | 'figurine' | 'image', allowImage = true, patch: Partial<MarkerSettings> = {}) => ({
  ...markerLook({ ...DEFAULT_MARKER, kind, ...patch }, { name: 'Tour', activityType: 'cycling' }, allowImage, picture),
})
const LEAD = leadMarkerColors(DEFAULT_MARKER, '#E4572E')

describe('markerBadge', () => {
  it('keeps the former balls: plain white for the lead, track colour in an ink halo for a racer', () => {
    expect(markerBadge(look('boule'), LEAD, false).drawing).toMatchObject({ badge: { kind: 'disc', fill: '#FFFFFF' }, diameter: 1 })
    const racer = markerBadge(look('boule'), racerMarkerColors('#5BC0EB'), false)
    expect(racer.drawing.diameter).toBe(RACE_HALO_SCALE)
    expect(racer.drawing.badge).toMatchObject({ kind: 'disc', fill: '#5BC0EB' })
  })

  it('draws larger badges for a figure or a picture, the racers keeping their ball instead of the picture', () => {
    const figure = markerBadge(look('figurine'), LEAD, true)
    expect(figure.drawing).toMatchObject({ badge: { kind: 'figure', mirrored: true, figure: 'cycliste' }, diameter: BADGE_SCALE })
    expect(figure.key).not.toBe(markerBadge(look('figurine'), LEAD, false).key)
    expect(markerBadge(look('image'), LEAD, false).drawing.badge.kind).toBe('image')
    expect(markerBadge(look('image', false), racerMarkerColors('#5BC0EB'), false).drawing.badge.kind).toBe('disc')
  })

  it('takes the colours of the settings, the track colour for an empty one', () => {
    expect(LEAD).toEqual({ ball: '#FFFFFF', ballRing: null, badgeFill: '#1C2A33', badgeRing: '#FFFFFF' })
    const own = leadMarkerColors({ ...DEFAULT_MARKER, color: '', figureColor: '#FFD23F' }, '#E4572E')
    expect(own).toEqual({ ball: '#E4572E', ballRing: null, badgeFill: '#FFD23F', badgeRing: '#E4572E' })
  })

  it('haloes or pulses the ball, the pulse following the film time', () => {
    expect(markerBadge(look('boule', true, { ballStyle: 'halo' }), LEAD, false).drawing.diameter).toBeGreaterThan(2)
    const pulse = look('boule', true, { ballStyle: 'pulsation' })
    const early = markerBadge(pulse, LEAD, false, 0.11)
    expect(early.pulsing).toBe(true)
    expect(early.key).not.toBe(markerBadge(pulse, LEAD, false, 0.61).key)
    // one period later: the same frame
    expect(markerBadge(pulse, LEAD, false, 1.61).key).toBe(early.key)
    expect(markerBadge(look('boule'), LEAD, false, 0.6).pulsing).toBe(false)
  })

  it('resolves the figure from the activity of each track, the label from its name or the free text', () => {
    const marker = { ...DEFAULT_MARKER, kind: 'figurine' as const, label: 'texte' as const, labelText: 'Moi' }
    expect(markerLook(marker, { name: 'Lac', activityType: 'swimming' }, true)).toMatchObject({ figure: 'nageur', label: 'Moi' })
    expect(markerLook(marker, { name: 'Lac', activityType: 'swimming' }, false)).toMatchObject({ label: 'Lac', animated: false })
    expect(markerLook({ ...marker, figure: 'kayak', label: 'aucune' }, undefined, true)).toMatchObject({ figure: 'kayak', label: '' })
    expect(markerLook({ ...marker, label: 'nom' }, { name: 'x'.repeat(60) }, true).label).toHaveLength(40)
  })

  it('stands a pin on its tip and a stick on its foot, the label under it', () => {
    const pin = markerBadge(look('figurine', true, { shape: 'epingle' }), LEAD, false)
    const pinLayout = markerLayout(pin.drawing, () => 0)
    expect(pinLayout.height - pinLayout.anchorY).toBeLessThan(1)
    const stick = markerBadge(look('boule', true, { stick: true, label: 'nom' }), LEAD, false)
    const layout = markerLayout(stick.drawing, (text) => text.length * 50)
    expect(layout.footY).toBeGreaterThan(layout.side)
    expect(layout.anchorY).toBe(layout.footY)
    expect(layout.label?.top).toBeGreaterThan(layout.anchorY)
    expect(layout.width).toBeGreaterThanOrEqual(200)
  })
})

describe('placeMarker', () => {
  it('anchors the sprite on the track point at the size of the ball', () => {
    // a canvas without 2D context: the layout is still computed
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) })
    const sprite = new Sprite()
    const camera = new PerspectiveCamera()
    camera.position.set(0, 0, 1000)
    const lookWithStick = look('boule', true, { stick: true })
    const expected = markerLayout(markerBadge(lookWithStick, LEAD, false).drawing, () => 0)
    placeMarker(sprite, new Vector3(), camera, lookWithStick, LEAD, false, 1)
    vi.unstubAllGlobals()
    // 7 world units of ball radius at 1 km
    expect(sprite.scale.x).toBeCloseTo((expected.width * 14) / PX_PER_BALL, 6)
    expect(sprite.center.y).toBeCloseTo(1 - expected.anchorY / expected.height, 6)
  })

  it('keeps its size on the screen with any lens: the camera stands focalDolly farther for a telephoto', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) })
    const onScreen = (focalMm: number) => {
      const sprite = new Sprite()
      const camera = new PerspectiveCamera(fovDegOf(focalMm))
      camera.position.set(0, 0, 1000 * focalDolly(focalMm))
      placeMarker(sprite, new Vector3(), camera, look('boule'), LEAD, false, 1)
      // height on the screen, as a share of the frame height: world height / (distance × tan(fov / 2))
      return sprite.scale.y / (camera.position.length() * Math.tan((camera.fov * Math.PI) / 360))
    }
    const reference = onScreen(26)
    for (const focalMm of [18, 50, 85, 135]) expect(onScreen(focalMm)).toBeCloseTo(reference, 9)
    vi.unstubAllGlobals()
  })
})

describe('headsLeft', () => {
  const frame = createLocalFrame(6.5, 45.5)
  const track = {
    segments: [{ points: [{ lon: 6.49, lat: 45.5 }, { lon: 6.51, lat: 45.5 }] }],
  } as unknown as Track
  const path = buildTrackPath(track)
  const at = frame.toLocal(6.5, 45.5, 0)

  function cameraLooking(from: Vector3): PerspectiveCamera {
    const camera = new PerspectiveCamera(50, 1, 1, 1e6)
    camera.position.copy(at).add(from)
    camera.lookAt(at)
    return camera
  }

  it('follows the screen direction of the track around the marker', () => {
    const up = frame.toLocal(6.5, 45.5, 1).sub(at)
    const south = frame.toLocal(6.5, 45.49, 0).sub(at)
    // seen from the south, an eastward track runs to the right; from the north, to the left
    const fromSouth = cameraLooking(south.clone().multiplyScalar(0.5).addScaledVector(up, 300))
    const fromNorth = cameraLooking(south.clone().multiplyScalar(-0.5).addScaledVector(up, 300))
    expect(headsLeft(path, path.lengthM / 2, at, frame, fromSouth)).toBe(false)
    expect(headsLeft(path, path.lengthM / 2, at, frame, fromNorth)).toBe(true)
  })

  it('leans with the slope of the track on screen, and not at all for a track that runs along the line of sight', () => {
    const climbing = {
      segments: [{ points: [{ lon: 6.49, lat: 45.5, ele: 0 }, { lon: 6.51, lat: 45.5, ele: 600 }] }],
    } as unknown as Track
    const up = frame.toLocal(6.5, 45.5, 1).sub(at)
    const south = frame.toLocal(6.5, 45.49, 0).sub(at)
    const camera = cameraLooking(south.clone().multiplyScalar(0.5).addScaledVector(up, 100))
    const rising = screenHeading(buildTrackPath(climbing), buildTrackPath(climbing).lengthM / 2, at, frame, camera)
    expect(rising.left).toBe(false)
    // a flat track on screen: no lean; the same track climbing seen from the side leans counter-clockwise, within the cap
    expect(screenHeading(path, path.lengthM / 2, at, frame, camera).lean).toBeCloseTo(0, 1)
    const flat = screenHeading(path, path.lengthM / 2, at, frame, camera).lean
    expect(rising.lean).toBeGreaterThan(flat)
    expect(rising.lean).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-9)
    // an elevation recorded with noise (±4 m every 10 m, pseudo-random) does not make the lean jump from one metre to the next
    const noise = (i: number) => 4 * ((Math.sin(i * 12.9898) * 43758.5453) % 1) // in (-4, 4)
    const noisy = {
      segments: [{ points: Array.from({ length: 220 }, (_, i) => ({ lon: 6.49 + i * 0.00013, lat: 45.5, ele: i * 3 + noise(i) })) }],
    } as unknown as Track
    const noisyPath = buildTrackPath(noisy)
    const side = new PerspectiveCamera(50, 1, 1, 1e6)
    side.position.copy(frame.toLocal(6.505, 45.495, 600))
    side.lookAt(frame.toLocal(6.505, 45.5, 400))
    let worst = 0
    let previous = 0
    for (let d = 600; d < 1400; d++) {
      const here = samplePath(noisyPath, d)
      const marker = frame.toLocal(here.lon, here.lat, here.ele ?? 0)
      const { lean } = screenHeading(noisyPath, d, marker, frame, side)
      if (d > 600) worst = Math.max(worst, Math.abs(lean - previous))
      previous = lean
    }
    expect(worst).toBeLessThan(0.002)
    // the lean is eased, not clamped: always strictly inside the cap
    expect(rising.lean).toBeLessThan((30 * Math.PI) / 180)
    // seen from the west the eastward track comes straight at the camera: its screen run is nil
    const west = frame.toLocal(6.49, 45.5, 0).sub(at)
    const along = cameraLooking(west.clone().multiplyScalar(0.5).addScaledVector(up, 100))
    expect(Math.abs(screenHeading(path, path.lengthM / 2, at, frame, along).lean)).toBeLessThan(0.15)
  })
})

describe('pullMarkerForward', () => {
  const camera = new PerspectiveCamera(50, 1, 1, 1e6)
  camera.position.set(0, 1000, 0)
  camera.lookAt(5000, 0, 0)
  camera.updateMatrixWorld()
  const placed = (x: number) => {
    const marker = new Sprite()
    marker.position.set(x, 0, 0)
    marker.scale.set(40, 60, 1)
    return marker
  }

  it('moves the marker towards the camera without changing its place or its size on screen', () => {
    const marker = placed(5000)
    const before = marker.position.clone().project(camera)
    const apparent = marker.scale.y / camera.position.distanceTo(marker.position)
    const distance = camera.position.distanceTo(marker.position)
    pullMarkerForward(marker, camera)
    expect(camera.position.distanceTo(marker.position)).toBeCloseTo(distance - MARKER_DEPTH_PULL_M, 6)
    const after = marker.position.clone().project(camera)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(marker.scale.y / camera.position.distanceTo(marker.position)).toBeCloseTo(apparent, 12)
    expect(marker.scale.x / marker.scale.y).toBeCloseTo(40 / 60, 12)
  })

  it('a marker close to the camera moves by half its distance at most', () => {
    const marker = placed(0)
    marker.position.set(0, 800, 0)
    pullMarkerForward(marker, camera)
    expect(camera.position.distanceTo(marker.position)).toBeCloseTo(100, 6)
  })
})
