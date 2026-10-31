/**
 * Progress markers as camera-facing sprites: the lead marker of FlyoverRig and the ghost racers of RaceMarkers.
 * Each marker is one Sprite showing a texture chosen by `settings.marker` (ball, pictogram or picture, with its
 * optional stick and label), with the constant on-screen size of the original ball. A pictogram faces the way its
 * track heads on screen and leans with its slope there (`figureHeading`, from the track itself around the marker): it
 * changes side only when the track clearly runs the other way, and turns round over `FIGURE_TURN_S`. It walks at the
 * pace of the marker (`figureMotion`), and a pulsing ball takes the phase of the film time, so every frame of the film
 * gets the same marker whatever frames came before (the export renders any frame on its own). All of it takes a little
 * of the scene's light (`setMarkerLight`).
 */
import { useEffect, useRef, useState } from 'react'
import { wakeScene } from './renderOnDemand'
import { CanvasTexture, Color, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import type { Camera, Sprite, SpriteMaterial } from 'three'
import type { LocalFrame, TerrainEngine, Track } from '../core/types'
import { CAMERA_FOV_DEG } from '../flyover/cameraSettings'
import { samplePath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import type { ClearanceAt } from './labelModel'
import { BADGE_INK, BALL_STYLE_SCALE, drawMarker, loadMarkerImage, markerLabelFont, markerLayout, PIN_HEIGHT, PX_PER_BALL } from './markerBadge'
import type { Badge, MarkerDrawing, MarkerLayout } from './markerBadge'
import { FIGURE_TURN_S, figureOfActivity, MARKER_LABEL_MAX_CHARS, pulsePhase } from './markerSettings'
import type { MarkerFigure, MarkerSettings } from './markerSettings'
import { NEUTRAL_MARKER_LIGHT } from './exposure'
import type { MarkerLight } from './exposure'

/** Ball radius as a fraction of its distance to the camera, at the default field of view (constant on-screen size, ~7 px at 1000 px). */
export const MARKER_SCREEN_FACTOR = 0.007
/** Diameter of the pictogram and picture badges relative to the ball: room for a readable figure. */
export const BADGE_SCALE = 2.2
/** Ink halo of the racers' balls (and contrasting ring of a ringed ball) relative to their coloured disc. */
export const RACE_HALO_SCALE = 1.35
/** Track length looked at on each side of the marker to tell which way it heads on screen (metres). */
export const HEADING_WINDOW_M = 60
/** Textures kept for reuse (pictograms × mirror × colours stay far below), and their pixels at most (labels are wide). */
const TEXTURE_CACHE_SIZE = 48
const TEXTURE_CACHE_PIXELS = 8_000_000

/** Colours of one marker: the lead (white ball, ink badge by default) or a racer (its track colour, ink ring). */
export interface MarkerColors {
  ball: string
  /** halo around the ball, null for none */
  ballRing: string | null
  badgeFill: string
  badgeRing: string
}

/** Colours of the lead marker: those of the settings, the track's own where they are '' (« Celle de la trace »). */
export function leadMarkerColors(marker: MarkerSettings, trackColor: string): MarkerColors {
  const ring = marker.color || trackColor
  return { ball: ring, ballRing: null, badgeFill: marker.figureColor || trackColor, badgeRing: ring }
}

export function racerMarkerColors(trackColor: string): MarkerColors {
  return { ball: trackColor, ballRing: BADGE_INK, badgeFill: trackColor, badgeRing: BADGE_INK }
}

/** What a marker shows: the settings, plus what they resolve to for its track. */
export interface MarkerLook {
  marker: MarkerSettings
  /** the decoded picture (null while loading or for none) */
  image: HTMLImageElement | null
  /** the racers show no picture (it is the lead's): a ball instead */
  allowImage: boolean
  /** the pictogram ('auto' resolved from the activity of the track) */
  figure: MarkerFigure
  /** text under the marker, '' for none */
  label: string
  /** an animated figurine bounces and sways (the lead only) */
  animated: boolean
}

/** `text` cut to MARKER_LABEL_MAX_CHARS with an ellipsis. */
function shortLabel(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MARKER_LABEL_MAX_CHARS ? `${trimmed.slice(0, MARKER_LABEL_MAX_CHARS - 1)}…` : trimmed
}

/**
 * Look of the marker of `track`: the lead shows the picture, the free text and the animation; a racer its ball,
 * its own track's name whenever a label is asked for, and stands still. 'auto' takes each track's activity.
 */
export function markerLook(
  marker: MarkerSettings,
  track: Pick<Track, 'name' | 'activityType'> | undefined,
  lead: boolean,
  image: HTMLImageElement | null = null,
): MarkerLook {
  const label = marker.label === 'aucune' ? '' : marker.label === 'texte' && lead ? marker.labelText : (track?.name ?? '')
  return {
    marker,
    image: lead ? image : null,
    allowImage: lead,
    figure: marker.figure === 'auto' ? figureOfActivity(track?.activityType) : marker.figure,
    label: shortLabel(label),
    animated: lead && marker.kind === 'figurine' && marker.animated,
  }
}

/** Texture of a marker: its cache key, its drawing, and whether it changes with the film time (a pulse). */
export interface MarkerBadge {
  key: string
  drawing: MarkerDrawing
  pulsing: boolean
}

/** Badge of a ball: plain, with a halo or a pulse; a racer's disc keeps its ink ring. */
function ballBadge(marker: MarkerSettings, colors: MarkerColors, timeS: number): { badge: Badge; diameter: number } {
  const style = marker.ballStyle
  const ring = colors.ballRing
  const pulse = style === 'pulsation' ? pulsePhase(timeS) : undefined
  const badge: Badge = ring
    ? { kind: 'disc', fill: colors.ball, ring, ringWidth: 1 - 1 / RACE_HALO_SCALE, style, pulse }
    : { kind: 'disc', fill: colors.ball, style, pulse }
  return { badge, diameter: (ring ? RACE_HALO_SCALE : 1) * BALL_STYLE_SCALE[style] }
}

/** A figure turning round is drawn in this many steps per unit of width: enough textures for a turn, few to keep. */
const FACING_STEPS = 8

/** `facing` of a figure: 1 heads right, -1 heads left, between: turning round (its width). */
export function markerBadge(look: MarkerLook, colors: MarkerColors, facing: number, timeS = 0): MarkerBadge {
  const { marker, image } = look
  let badge: Badge
  let diameter = BADGE_SCALE
  let key: string
  if (marker.kind === 'figurine') {
    const shape = marker.shape
    const width = Math.round(facing * FACING_STEPS) / FACING_STEPS
    badge = { kind: 'figure', figure: look.figure, fill: colors.badgeFill, ring: colors.badgeRing, facing: width, shape }
    if (shape === 'epingle') diameter = BADGE_SCALE * PIN_HEIGHT
    key = `figure:${look.figure}:${shape}:${colors.badgeFill}:${colors.badgeRing}:${width}`
  } else if (marker.kind === 'image' && look.allowImage && image) {
    badge = { kind: 'image', image, width: image.naturalWidth, height: image.naturalHeight, ring: colors.badgeRing }
    key = `image:${colors.badgeRing}:${image.src}`
  } else {
    ;({ badge, diameter } = ballBadge(marker, colors, timeS))
    key = `disc:${colors.ball}:${colors.ballRing}:${marker.ballStyle}:${badge.kind === 'disc' ? (badge.pulse ?? '') : ''}`
  }
  const drawing: MarkerDrawing = { badge, diameter, stick: marker.stick, label: look.label }
  return {
    key: `${key}:${marker.stick}:${look.label}`,
    drawing,
    pulsing: badge.kind === 'disc' && badge.pulse !== undefined,
  }
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

interface MarkerTexture {
  texture: CanvasTexture
  layout: MarkerLayout
}

const textures = new Map<string, MarkerTexture>()
let cachedPixels = 0

/** Draw `drawing` on `canvas`, sized to its layout. */
function paint(canvas: HTMLCanvasElement, drawing: MarkerDrawing): MarkerLayout {
  const ctx = canvas.getContext('2d')
  const measure = (text: string, font: string) => {
    if (!ctx) return 0
    ctx.font = font
    return ctx.measureText(text).width
  }
  const layout = markerLayout(drawing, measure)
  if (canvas.width !== layout.width || canvas.height !== layout.height) {
    canvas.width = layout.width
    canvas.height = layout.height
  }
  if (ctx) drawMarker(ctx, layout, drawing)
  return layout
}

function createMarkerTexture(drawing: MarkerDrawing): MarkerTexture {
  const canvas = document.createElement('canvas')
  const layout = paint(canvas, drawing)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return { texture, layout }
}

/** Texture of `badge`, drawn once per key; the oldest ones are released past TEXTURE_CACHE_SIZE or TEXTURE_CACHE_PIXELS. */
export function badgeTexture({ key, drawing }: MarkerBadge): MarkerTexture {
  let entry = textures.get(key)
  if (entry) return entry
  entry = createMarkerTexture(drawing)
  textures.set(key, entry)
  cachedPixels += entry.layout.width * entry.layout.height
  while (textures.size > 1 && (textures.size > TEXTURE_CACHE_SIZE || cachedPixels > TEXTURE_CACHE_PIXELS)) {
    const [oldestKey, oldest] = textures.entries().next().value as [string, MarkerTexture]
    textures.delete(oldestKey)
    cachedPixels -= oldest.layout.width * oldest.layout.height
    oldest.texture.dispose()
  }
  return entry
}

/** A pulsing marker redraws its own canvas when the phase changes, instead of filling the shared cache. */
const ownTextures = new WeakMap<Sprite, MarkerTexture & { key: string }>()

function ownTexture(sprite: Sprite, { key, drawing }: MarkerBadge): MarkerTexture {
  let own = ownTextures.get(sprite)
  if (own?.key === key) return own
  const canvas = own?.texture.image as HTMLCanvasElement | undefined
  if (own && canvas) {
    const layout = paint(canvas, drawing)
    // a texture keeps the size of its first upload: a new one when the label changes it
    if (layout.width !== own.layout.width || layout.height !== own.layout.height) {
      own.texture.dispose()
      own = { ...createMarkerTexture(drawing), key }
    } else {
      own = { texture: own.texture, layout, key }
      own.texture.needsUpdate = true
    }
  } else {
    own = { ...createMarkerTexture(drawing), key }
  }
  ownTextures.set(sprite, own)
  return own
}

/** Release the texture a pulsing marker drew for itself (when its sprite goes, or stops pulsing). */
export function releaseMarkerTexture(sprite: Sprite | null): void {
  const own = sprite && ownTextures.get(sprite)
  if (!own || !sprite) return
  own.texture.dispose()
  ownTextures.delete(sprite)
}

// ---------------------------------------------------------------------------
// Per-frame placement
// ---------------------------------------------------------------------------

const behindLocal = new Vector3()
const aheadLocal = new Vector3()
const hereLocal = new Vector3()
/** Steepest lean of a figure on screen (radians): a track climbing or dropping steeply on screen tilts it this far. */
const MAX_LEAN_RAD = (30 * Math.PI) / 180

/**
 * The heading is read at these offsets (metres) around the marker, weighted as `HEADING_WEIGHTS`, and averaged: a
 * bump or a noisy elevation of the recording then bends the lean gradually instead of jumping it, with no state kept
 * between frames (every export frame is the same as the preview).
 */
const HEADING_OFFSETS_M = [-80, -60, -40, -20, 0, 20, 40, 60, 80] as const
const HEADING_WEIGHTS = [1, 2, 3, 4, 5, 4, 3, 2, 1] as const

/**
 * The run of the track on screen around `centreM`: from the point HEADING_WINDOW_M behind to the one ahead, at
 * `height` (the marker's, the neighbours raised or lowered by the track's own rise, terrain exaggeration included),
 * projected with `camera`; x in units of the frame's height. With `at`, the run is that of a marker standing at `at`
 * (the track around `centreM` moved there): how it would look from the camera if the marker were there. Nil when
 * either end is behind the camera.
 */
function screenRun(
  path: TrackPath,
  centreM: number,
  height: number,
  frame: LocalFrame,
  camera: Camera,
  exaggeration: number,
  aspect: number,
  at: Vector3 | null = null,
): { dx: number; dy: number } {
  const centre = Math.min(path.lengthM, Math.max(0, centreM))
  const here = samplePath(path, centre)
  const behind = samplePath(path, Math.max(0, centre - HEADING_WINDOW_M))
  const ahead = samplePath(path, Math.min(path.lengthM, centre + HEADING_WINDOW_M))
  const heightOf = (p: { ele?: number }) => height + ((p.ele ?? here.ele ?? 0) - (here.ele ?? 0)) * exaggeration
  frame.toLocal(behind.lon, behind.lat, heightOf(behind), behindLocal)
  frame.toLocal(ahead.lon, ahead.lat, heightOf(ahead), aheadLocal)
  if (at) {
    frame.toLocal(here.lon, here.lat, height, hereLocal)
    behindLocal.sub(hereLocal).add(at)
    aheadLocal.sub(hereLocal).add(at)
  }
  // in the camera's space (z < 0 in front of it) before the projection, which would mirror what is behind the camera
  behindLocal.applyMatrix4(camera.matrixWorldInverse)
  aheadLocal.applyMatrix4(camera.matrixWorldInverse)
  if (behindLocal.z >= 0 || aheadLocal.z >= 0) return { dx: 0, dy: 0 }
  behindLocal.applyMatrix4(camera.projectionMatrix)
  aheadLocal.applyMatrix4(camera.projectionMatrix)
  return { dx: (aheadLocal.x - behindLocal.x) * aspect, dy: aheadLocal.y - behindLocal.y }
}

/**
 * Which way the track runs on screen around `distanceM`, from the points HEADING_WINDOW_M behind and ahead of the
 * marker (and of four neighbouring places, averaged: `HEADING_OFFSETS_M`), at the marker's height, projected with the
 * camera of this frame: `left` when it runs right to left, and `lean`, the angle of its run above the horizontal
 * (radians, counter-clockwise for a rightward run, eased towards ±MAX_LEAN_RAD), which tilts a figure to stand on
 * the track as it climbs, drops or turns. Zero when the track runs along the line of sight (straight to or from the
 * camera), where its screen direction means nothing.
 */
export function screenHeading(
  path: TrackPath,
  distanceM: number,
  at: Vector3,
  frame: LocalFrame,
  camera: Camera,
  exaggeration = 1,
): { left: boolean; lean: number } {
  // the rig may have just moved the camera: project with this frame's view, not the last render's
  camera.updateMatrixWorld()
  const { height } = frame.toLonLat(at)
  const aspect = 'aspect' in camera ? (camera as PerspectiveCamera).aspect : 1
  let sumDx = 0
  let sumAbsDx = 0
  let sumLean = 0
  let sumWeight = 0
  HEADING_OFFSETS_M.forEach((offset, i) => {
    const { dx, dy } = screenRun(path, distanceM + offset, height, frame, camera, exaggeration, aspect)
    const length = Math.hypot(dx, dy)
    const run = Math.abs(dx)
    // the more the track runs across the screen, the more its slope is read
    const lean = length > 1e-6 ? Math.atan2(dy, run) * (run / length) : 0
    const weight = HEADING_WEIGHTS[i]
    sumDx += dx * weight
    sumAbsDx += run * weight
    sumLean += lean * weight
    sumWeight += weight
  })
  // where the track turns on screen the runs cancel and the figure turns round: the lean fades to nothing there, so it
  // does not jump with the mirror
  const coherence = sumAbsDx > 1e-9 ? Math.abs(sumDx) / sumAbsDx : 0
  const lean = (sumLean / sumWeight) * coherence
  return { left: sumDx < 0, lean: MAX_LEAN_RAD * Math.tanh(lean / MAX_LEAN_RAD) }
}

/** True when the track runs right to left on screen around `distanceM` (`screenHeading`). */
export function headsLeft(path: TrackPath, distanceM: number, at: Vector3, frame: LocalFrame, camera: Camera): boolean {
  return screenHeading(path, distanceM, at, frame, camera).left
}

/**
 * A figure changes side only when the track clearly keeps running the other way on screen: the runs seen back from the
 * marker (each from -1 to 1, the sine of its angle from the vertical, weighted by the length it stands for) are added up
 * until the sum passes this much (one SIDE_STEP_M of a track running straight across the screen is 1). A run nearer the
 * vertical (a switchback climbing up the screen, a track coming at the camera) adds little, and the wiggles of a noisy
 * track cancel out, where taking the first run past a threshold flipped the side from one frame to the next.
 */
export const SIDE_EVIDENCE = 1.5
/** Mean run (sine of the angle from the vertical, 20°) that tells a side where the track has too little behind it. */
const SIDE_BAND = Math.sin((20 * Math.PI) / 180)
/**
 * The side it had is read from the track behind the marker, not from the time: every SIDE_STEP_M back to SIDE_DENSE_M,
 * then every SIDE_COARSE_STEP_M to SIDE_LOOK_BACK_M, so a flight at any speed keeps the same side on the same switchback.
 */
const SIDE_STEP_M = 25
const SIDE_DENSE_M = 600
const SIDE_COARSE_STEP_M = 100
const SIDE_LOOK_BACK_M = 3000
/** Bisection steps that place the instant a figure changed side within a turn (a few milliseconds). */
const TURN_BISECTIONS = 6

/** The film camera at an earlier film time (position and what it looks at), to read the side the figure had then. */
export interface PastView {
  position: Vector3
  target: Vector3
}

const pastShown = { timeS: Number.NaN, position: new Vector3(), target: new Vector3(), set: false }

/**
 * The rig tells the markers what the film camera looked like at `timeS` (the frame's film time less FIGURE_TURN_S), or
 * null when the camera is not the film's (the user orbits a paused film). Rewritten every frame, never read after it.
 */
export function showPastView(timeS: number, view: PastView | null): void {
  pastShown.set = view !== null
  pastShown.timeS = timeS
  if (view) {
    pastShown.position.copy(view.position)
    pastShown.target.copy(view.target)
  }
}

/** The camera of `timeS` as the rig told it this frame, null for any other time. */
export function pastViewAt(timeS: number): PastView | null {
  return pastShown.set && pastShown.timeS === timeS ? pastShown : null
}

const sideCamera = new PerspectiveCamera()
const pastDirection = new Vector3()
const pastMarker = new Vector3()
const sideMarker = new Vector3()
const nowDirection = new Vector3()

/**
 * Side a figure faces (1 right, -1 left) with the marker at `distanceM`, the track seen with `camera`: the side of the
 * way the track has clearly run on screen (SIDE_EVIDENCE), from the marker back along the track, each place seen as
 * if the marker stood at `at` (so a place far behind the marker, or the camera, still tells which way the track went).
 * Not enough evidence in the whole look back (a straight climb up the screen): the way the sum leans, right if none.
 */
function sideAt(
  path: TrackPath,
  distanceM: number,
  at: Vector3,
  height: number,
  frame: LocalFrame,
  camera: Camera,
  exaggeration: number,
  aspect: number,
): 1 | -1 {
  let evidence = 0
  let places = 0
  for (let back = 0; back <= SIDE_LOOK_BACK_M; back += back < SIDE_DENSE_M ? SIDE_STEP_M : SIDE_COARSE_STEP_M) {
    const place = Math.max(0, distanceM - back)
    const { dx, dy } = screenRun(path, place, height, frame, camera, exaggeration, aspect, at)
    const length = Math.hypot(dx, dy)
    const run = length > 1e-6 ? dx / length : 0
    evidence += run
    places++
    if (Math.abs(evidence) > SIDE_EVIDENCE) break
    if (place === 0) break
  }
  // the start of a track has too little behind it for that sum: the mean run alone, as clear as SIDE_BAND
  return Math.abs(evidence) > Math.min(SIDE_EVIDENCE, SIDE_BAND * places) ? (evidence < 0 ? -1 : 1) : 1
}

/**
 * Width of the figure (`facing`: 1 heads right, -1 left, between: turning round) and its `lean` at film time `timeS`.
 * The side comes from the track's run on screen at `timeS` and before it (`sideAt`: no flicker on a switchback running
 * up the screen); when it changed within the last FIGURE_TURN_S the figure is turning round, its width going through
 * zero as a card flipped (a cosine: eased at both ends), the change placed by bisection between the camera of that
 * time (`before`, null: no turn, the side changes at once) and this frame's. Every instant is read again from the
 * clock and the camera, with no memory between frames: the export gives the preview's frame.
 */
export function figureHeading(
  path: TrackPath,
  distanceAt: (timeS: number) => number,
  timeS: number,
  at: Vector3,
  frame: LocalFrame,
  camera: Camera,
  before: PastView | null,
  exaggeration = 1,
): { facing: number; lean: number } {
  const { lean } = screenHeading(path, distanceAt(timeS), at, frame, camera, exaggeration)
  const { height } = frame.toLonLat(at)
  const aspect = 'aspect' in camera ? (camera as PerspectiveCamera).aspect : 1
  const side = (t: number, from: Camera, marker: Vector3) => sideAt(path, distanceAt(t), marker, height, frame, from, exaggeration, aspect)
  const now = side(timeS, camera, at)
  if (!before) return { facing: now, lean }
  // the side the figure had `k` of the way from a turn ago (0) to now (1), the view blended between the two
  const was = samplePath(path, distanceAt(timeS - FIGURE_TURN_S))
  frame.toLocal(was.lon, was.lat, height, pastMarker)
  const sideAtK = (k: number) =>
    side(timeS - (1 - k) * FIGURE_TURN_S, placeSideCamera(camera, before, k), sideMarker.lerpVectors(pastMarker, at, k))
  if (sideAtK(0) === now) return { facing: now, lean }
  // changed within the turn: where, as a fraction k of the time since the camera of `before`
  let low = 0
  let high = 1
  for (let i = 0; i < TURN_BISECTIONS; i++) {
    const k = (low + high) / 2
    if (sideAtK(k) === now) high = k
    else low = k
  }
  // the turn began at the change: the old side at first, the new one when `1 - high` of the turn has passed
  return { facing: -now * Math.cos(Math.PI * (1 - high)), lean }
}

/** The camera `k` of the way from the `before` view to `camera` (position and direction blended), projection of `camera`. */
function placeSideCamera(camera: Camera, before: PastView, k: number): Camera {
  sideCamera.projectionMatrix.copy(camera.projectionMatrix)
  sideCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
  sideCamera.position.lerpVectors(before.position, camera.position, k)
  pastDirection.subVectors(before.target, before.position).normalize()
  camera.getWorldDirection(nowDirection)
  sideCamera.lookAt(pastDirection.lerp(nowDirection, k).add(sideCamera.position))
  sideCamera.updateMatrixWorld()
  return sideCamera
}

const NO_MOTION = { lift: 0, tilt: 0 }
/** Light the markers take from the scene (`setMarkerLight`): neutral without the atmosphere. */
let markerLight: MarkerLight = NEUTRAL_MARKER_LIGHT

/**
 * The atmosphere tells the markers the light of this frame (`markerLight`, from the sun elevation and the weather):
 * rewritten every frame before they are placed, neutral again when it goes.
 */
export function setMarkerLight(light: MarkerLight): void {
  markerLight = light
}

/**
 * Radius (world metres) of the ball of a marker at `position`: the constant on-screen size, times `size`. MARKER_SCREEN_FACTOR is
 * for the default field of view: a narrower or wider lens (« Focale », the camera stands farther or closer for it) scales it,
 * so the marker keeps its size on the screen.
 */
export function markerRadius(camera: Camera, position: Vector3, size: number): number {
  const lens = 'fov' in camera ? Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360) / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360) : 1
  return Math.max(1, camera.position.distanceTo(position) * MARKER_SCREEN_FACTOR * lens) * size
}

/** Track length looked at on each side of the marker to tell which way a 3D model faces (metres). */
export const MODEL_WINDOW_M = 30
const modelBehind = new Vector3()

/**
 * The way the track runs at `distanceM` in the scene (a unit vector, its slope included at the `exaggeration` of the relief),
 * from the points MODEL_WINDOW_M behind and ahead of the marker at `at`; zero where the track has no run (a path of one point).
 */
export function trackDirection(path: TrackPath, distanceM: number, at: Vector3, frame: LocalFrame, exaggeration: number, target = new Vector3()): Vector3 {
  const centre = Math.min(path.lengthM, Math.max(0, distanceM))
  const here = samplePath(path, centre)
  const behind = samplePath(path, Math.max(0, centre - MODEL_WINDOW_M))
  const ahead = samplePath(path, Math.min(path.lengthM, centre + MODEL_WINDOW_M))
  const { height } = frame.toLonLat(at)
  const heightOf = (p: { ele?: number }) => height + ((p.ele ?? here.ele ?? 0) - (here.ele ?? 0)) * exaggeration
  frame.toLocal(ahead.lon, ahead.lat, heightOf(ahead), target)
  frame.toLocal(behind.lon, behind.lat, heightOf(behind), modelBehind)
  return target.sub(modelBehind).normalize()
}

const litScratch = new Color()

/** `hex` as the flat colour of a 3D model: divided by the exposure (`gain`) and tinted by the light of the scene, like the sprites. */
export function litColor(hex: string, gain: number, target = new Color()): Color {
  litScratch.setRGB(gain * markerLight.r, gain * markerLight.g, gain * markerLight.b)
  return target.set(hex).multiply(litScratch)
}

/**
 * Put `sprite` at `position` with the texture of `look` at film time `timeS`, at the constant on-screen size times
 * `marker.size`, its colours divided by the exposure (`gain`) like the track lines and tinted by the light of the scene.
 * The track point is the anchor of the texture: the centre of the badge, the tip of a pin or the foot of the stick.
 * `facing` and `lean` come from `figureHeading`, `motion` (the bounce and sway of a walking figure, `figureMotion`) from the rig.
 */
export function placeMarker(
  sprite: Sprite,
  position: Vector3,
  camera: Camera,
  look: MarkerLook,
  colors: MarkerColors,
  facing: number,
  gain: number,
  timeS = 0,
  lean = 0,
  motion = NO_MOTION,
): void {
  const badge = markerBadge(look, colors, facing, timeS)
  if (!badge.pulsing) releaseMarkerTexture(sprite)
  const { texture, layout } = badge.pulsing ? ownTexture(sprite, badge) : badgeTexture(badge)
  const material = sprite.material as SpriteMaterial
  // an animated figure: lifted on screen (the sprite's anchor moves down) and tilted forward, turning with it; on
  // a stick it only sways
  const bounce = look.animated ? motion : NO_MOTION
  const lift = look.marker.stick ? 0 : bounce.lift * layout.side
  sprite.center.set(0.5, 1 - (layout.anchorY + lift) / layout.height)
  // a figure alone (no stick, no label drawn with it) also leans with the slope of the track on screen (`lean`)
  const slope = look.marker.kind === 'figurine' && !look.marker.stick && look.label === '' ? lean : 0
  material.rotation = facing * (slope - bounce.tilt)
  if (material.map !== texture) material.map = texture
  material.color.setRGB(gain * markerLight.r, gain * markerLight.g, gain * markerLight.b)
  const radius = markerRadius(camera, position, look.marker.size)
  // world size of a texture pixel: a ball is PX_PER_BALL pixels across
  const pixel = (2 * radius) / PX_PER_BALL
  sprite.position.copy(position)
  sprite.scale.set(layout.width * pixel, layout.height * pixel, 1)
}

const clearanceProbe = new Vector3()

/** Height of a scene point above the relief (exaggerated, metres); null without terrain. */
export function reliefClearance(engine: TerrainEngine | null, frame: LocalFrame | null, exaggeration: number): ClearanceAt | null {
  if (!engine || !frame) return null
  return (x, y, z) => {
    const p = frame.toLonLat(clearanceProbe.set(x, y, z))
    const ground = engine.sampleHeight(p.lon, p.lat)
    return ground === undefined ? undefined : p.height - ground * exaggeration
  }
}

/** How far in front of its point a marker is drawn (metres, half its distance at most): the relief that close never cuts it. */
export const MARKER_DEPTH_PULL_M = 150

/**
 * Behind the relief a marker is cut by the crest pixel by pixel, like a real object, never switched off whole: it is
 * drawn with the depth test, moved towards the camera along its sight line by MARKER_DEPTH_PULL_M and shrunk in
 * proportion, so its place and size on screen do not change and the slope under it never sinks it. Call after
 * `placeMarker`.
 */
export function pullMarkerForward(sprite: Sprite, camera: Camera): void {
  const distance = camera.position.distanceTo(sprite.position)
  if (distance === 0) return
  const k = 1 - Math.min(MARKER_DEPTH_PULL_M, distance / 2) / distance
  sprite.position.sub(camera.position).multiplyScalar(k).add(camera.position)
  sprite.scale.x *= k
  sprite.scale.y *= k
}

/** Decoded pictures of `dataUrls` (the marker's, and those of its keys): absent while loading, for none or for an unreadable one. */
export function useMarkerImages(dataUrls: readonly string[]): ReadonlyMap<string, HTMLImageElement> {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map())
  const requested = useRef(new Set<string>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    for (const url of dataUrls) {
      if (!url || requested.current.has(url)) continue
      requested.current.add(url)
      loadMarkerImage(url).then(
        (image) => {
          if (!alive.current) return
          setLoaded((now) => new Map(now).set(url, image))
          wakeScene()
        },
        () => undefined,
      )
    }
  }, [dataUrls])
  return loaded
}

/** Load the font of the marker labels once one is shown (the first texture may use the fallback font). */
let labelFontRequested = false
export function useMarkerLabelFont(shown: boolean): void {
  useEffect(() => {
    if (!shown || labelFontRequested || typeof document === 'undefined' || !document.fonts) return
    labelFontRequested = true
    document.fonts
      .load(markerLabelFont(16))
      .then(() => {
        // drop the textures drawn with the fallback font
        for (const entry of textures.values()) entry.texture.dispose()
        textures.clear()
        cachedPixels = 0
        wakeScene()
      })
      .catch(() => undefined)
  }, [shown])
}
