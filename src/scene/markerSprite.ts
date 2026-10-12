/**
 * Progress markers as camera-facing sprites: the lead marker of FlyoverRig and the ghost racers of RaceMarkers.
 * Each marker is one Sprite showing a texture chosen by `settings.marker` (ball, pictogram or picture, with its
 * optional stick and label), with the constant on-screen size of the original ball. A pictogram is mirrored to
 * move the way its track heads on screen, from the track itself around the marker, and a pulsing ball takes the
 * phase of the film time, so every frame of the film gets the same marker whatever frames came before (the export
 * renders any frame on its own).
 */
import { useEffect, useState } from 'react'
import { wakeScene } from './renderOnDemand'
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import type { Camera, Sprite, SpriteMaterial } from 'three'
import type { LocalFrame, TerrainEngine, Track } from '../core/types'
import { samplePath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { lineOfSightClearance, occlusionFade } from './labelModel'
import type { ClearanceAt } from './labelModel'
import { BADGE_INK, BALL_STYLE_SCALE, drawMarker, loadMarkerImage, markerLabelFont, markerLayout, PIN_HEIGHT, PX_PER_BALL, readableInk } from './markerBadge'
import type { Badge, MarkerDrawing, MarkerLayout } from './markerBadge'
import { figureMotion, figureOfActivity, MARKER_LABEL_MAX_CHARS, pulsePhase } from './markerSettings'
import type { MarkerFigure, MarkerSettings } from './markerSettings'

/** Ball radius as a fraction of its distance to the camera (constant on-screen size, ~7 px at 1000 px). */
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

/** Badge of a ball: plain, ringed (contrasting ring), with a halo or a pulse; a racer's disc keeps its ink ring. */
function ballBadge(marker: MarkerSettings, colors: MarkerColors, timeS: number): { badge: Badge; diameter: number } {
  const style = marker.ballStyle
  const ring = style === 'anneau' ? readableInk(colors.ball) : colors.ballRing
  const pulse = style === 'pulsation' ? pulsePhase(timeS) : undefined
  const badge: Badge = ring
    ? { kind: 'disc', fill: colors.ball, ring, ringWidth: 1 - 1 / RACE_HALO_SCALE, style, pulse }
    : { kind: 'disc', fill: colors.ball, style, pulse }
  return { badge, diameter: (ring ? RACE_HALO_SCALE : 1) * BALL_STYLE_SCALE[style] }
}

export function markerBadge(look: MarkerLook, colors: MarkerColors, mirrored: boolean, timeS = 0): MarkerBadge {
  const { marker, image } = look
  let badge: Badge
  let diameter = BADGE_SCALE
  let key: string
  if (marker.kind === 'figurine') {
    const shape = marker.shape
    badge = { kind: 'figure', figure: look.figure, fill: colors.badgeFill, ring: colors.badgeRing, mirrored, shape }
    if (shape === 'epingle') diameter = BADGE_SCALE * PIN_HEIGHT
    key = `figure:${look.figure}:${shape}:${colors.badgeFill}:${colors.badgeRing}:${mirrored}`
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
/**
 * True when the track runs right to left on screen around `distanceM`: the points HEADING_WINDOW_M behind and
 * ahead of the marker, at the marker's height, projected with the camera of this frame.
 */
export function headsLeft(path: TrackPath, distanceM: number, at: Vector3, frame: LocalFrame, camera: Camera): boolean {
  // the rig may have just moved the camera: project with this frame's view, not the last render's
  camera.updateMatrixWorld()
  const { height } = frame.toLonLat(at)
  const behind = samplePath(path, Math.max(0, distanceM - HEADING_WINDOW_M))
  const ahead = samplePath(path, Math.min(path.lengthM, distanceM + HEADING_WINDOW_M))
  frame.toLocal(behind.lon, behind.lat, height, behindLocal).project(camera)
  frame.toLocal(ahead.lon, ahead.lat, height, aheadLocal).project(camera)
  return aheadLocal.x < behindLocal.x
}

const NO_MOTION = { lift: 0, tilt: 0 }

/**
 * Put `sprite` at `position` with the texture of `look` at film time `timeS`, at the constant on-screen size times
 * `marker.size`, its colours divided by the exposure (`gain`) like the track lines. The track point is the anchor
 * of the texture: the centre of the badge, the tip of a pin or the foot of the stick.
 */
export function placeMarker(
  sprite: Sprite,
  position: Vector3,
  camera: Camera,
  look: MarkerLook,
  colors: MarkerColors,
  mirrored: boolean,
  gain: number,
  timeS = 0,
): void {
  const badge = markerBadge(look, colors, mirrored, timeS)
  if (!badge.pulsing) releaseMarkerTexture(sprite)
  const { texture, layout } = badge.pulsing ? ownTexture(sprite, badge) : badgeTexture(badge)
  const material = sprite.material as SpriteMaterial
  // an animated figure: lifted on screen (the sprite's anchor moves down) and tilted forward, mirrored with it; on
  // a stick it only sways
  const motion = look.animated ? figureMotion(timeS) : NO_MOTION
  const lift = look.marker.stick ? 0 : motion.lift * layout.side
  sprite.center.set(0.5, 1 - (layout.anchorY + lift) / layout.height)
  material.rotation = mirrored ? motion.tilt : -motion.tilt
  if (material.map !== texture) material.map = texture
  material.color.setScalar(gain)
  const radius = Math.max(1, camera.position.distanceTo(position) * MARKER_SCREEN_FACTOR) * look.marker.size
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

/** A marker is drawn without depth test (never sunk into the slope): it is hidden behind the relief like the labels (hard cut). */
export function occludeMarker(sprite: Sprite, camera: Camera, clearanceAt: ClearanceAt | null): void {
  const material = sprite.material as SpriteMaterial
  material.opacity = clearanceAt ? occlusionFade(lineOfSightClearance(camera.position, sprite.position, clearanceAt)) : 1
}

/** Decoded picture of `settings.marker.image` (null while loading, for none or for an unreadable one). */
export function useMarkerImage(dataUrl: string): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!dataUrl) return
    let alive = true
    loadMarkerImage(dataUrl).then(
      (image) => {
        if (!alive) return
        setLoaded({ src: dataUrl, image })
        wakeScene()
      },
      () => alive && setLoaded(null),
    )
    return () => {
      alive = false
    }
  }, [dataUrl])
  return loaded && loaded.src === dataUrl ? loaded.image : null
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
