/**
 * PhotoPins — « Photos sur le terrain »: each picture or clip of the film's timeline stands on the relief as a post with
 * its framed thumbnail, at the point of the track where it was taken (`film/photoPins.ts`). Three sprites of constant
 * screen size per pin (the foot, the post, the picture), sized as a fraction of the height of the frame (so the preview and
 * every export resolution show the same pin, like the streams' minimum width), a little smaller far away. It lights up
 * (chartreuse frame, larger) while the photo is on screen. Close pins are stacked and give way to the 3D labels
 * (`pinLayout.ts`). The camera turns towards them in `computeFilmView` (`flyover/pinAim.ts`). Not drawn on the poster.
 * Must be rendered inside TerrainLayer.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AlwaysDepth, CanvasTexture, Group, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three'
import { useExportStore } from '../export/store'
import { useMediaStore } from '../film/media'
import { photoPins, pinLit, type PhotoPin } from '../film/photoPins'
import { pinLocalPosition } from '../flyover/pinAim'
import { smoothedTrackPath } from '../flyover/smooth'
import { useAppStore } from '../state/store'
import { distanceFade, lineOfSightClearance, occlusionFade, spriteScaleForPixels } from './labelModel'
import { getShownLabelRects } from './labelRects'
import { reliefClearance } from './markerSprite'
import { layoutPins, type PinBox } from './pinLayout'
import { useTerrainContext } from './terrainContext'
import { LINE_LIFT_M } from './trackLineSet'
import { useFilmClock, useFilmTrack } from './usePacing'
import { wakeScene } from './renderOnDemand'

// look (CSS pixels of a 720 px high frame: the pin is drawn at the same share of the frame height at any size)
const THUMB_W = 96
const THUMB_H = 70
const FRAME = 5
const POST_H = 26
const POST_W = 5
const DOT_R = 4
const MARGIN = 16
const TEXTURE_SCALE = 2
/** The look is drawn for a frame this high (pixels). */
export const PIN_REFERENCE_HEIGHT_PX = 720
const NAVY = '#113B54'
const CHARTREUSE = '#DBE64C'
const WHITE = '#FFFFFF'
// the pictures over the 3D labels (order 10), their posts under them; the lit pin over everything
const PIN_RENDER_ORDER = 11
const POST_RENDER_ORDER = 9
const LIT_RENDER_ORDER = 14
/** Distance (m) over which a pin goes from full size to half of it: readable far away, never huge close up. */
const SHRINK_FROM_M = 1_000
const SHRINK_TO_M = 10_000
const LIT_GROWTH = 1.25
const FRAME_W = THUMB_W + 2 * FRAME
const FRAME_H = THUMB_H + 2 * FRAME
const CARD_W = FRAME_W + 2 * MARGIN
const CARD_H = FRAME_H + 2 * MARGIN

interface PinTextures {
  card: CanvasTexture
  cardLit: CanvasTexture
}

function textureOf(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return texture
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  canvas.width = w * TEXTURE_SCALE
  canvas.height = h * TEXTURE_SCALE
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE)
  return { canvas, ctx }
}

/** The framed picture with its soft shadow (a glow when lit), cropped to fill the thumbnail. */
function drawCard(image: CanvasImageSource & { width: number; height: number }, lit: boolean): CanvasTexture | null {
  const made = newCanvas(CARD_W, CARD_H)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.save()
  ctx.shadowColor = lit ? CHARTREUSE : 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = lit ? 14 : 9
  ctx.shadowOffsetY = lit ? 0 : 3
  ctx.fillStyle = lit ? CHARTREUSE : WHITE
  ctx.beginPath()
  ctx.roundRect(MARGIN, MARGIN, FRAME_W, FRAME_H, 6)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = NAVY
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(MARGIN, MARGIN, FRAME_W, FRAME_H, 6)
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(MARGIN + FRAME, MARGIN + FRAME, THUMB_W, THUMB_H, 3)
  ctx.clip()
  const k = Math.max(THUMB_W / image.width, THUMB_H / image.height)
  const w = image.width * k
  const h = image.height * k
  ctx.drawImage(image, MARGIN + FRAME + (THUMB_W - w) / 2, MARGIN + FRAME + (THUMB_H - h) / 2, w, h)
  ctx.restore()
  return textureOf(canvas)
}

/** The post (stretched along its length) and the foot, in white or in chartreuse, edged in navy. */
function drawPost(lit: boolean): CanvasTexture | null {
  const made = newCanvas(POST_W, 2)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.fillStyle = NAVY
  ctx.fillRect(0, 0, POST_W, 2)
  ctx.fillStyle = lit ? CHARTREUSE : WHITE
  ctx.fillRect(1.25, 0, POST_W - 2.5, 2)
  return textureOf(canvas)
}

function drawFoot(lit: boolean): CanvasTexture | null {
  const size = 2 * DOT_R + 4
  const made = newCanvas(size, size)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, DOT_R, 0, Math.PI * 2)
  ctx.fillStyle = lit ? CHARTREUSE : WHITE
  ctx.fill()
  ctx.strokeStyle = NAVY
  ctx.lineWidth = 1.5
  ctx.stroke()
  return textureOf(canvas)
}

interface PinEntry {
  pin: PhotoPin
  card: Sprite
  post: Sprite
  foot: Sprite
  cardTextures?: PinTextures
}

const cameraPosition = new Vector3()
const projected = new Vector3()

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

function makeSprite(group: Group, name: string, order: number): Sprite {
  // like the labels: always passes the depth test but writes its depth, so the atmosphere (haze, clouds) treats the pin as
  // standing where it is, not as sky
  const material = new SpriteMaterial({ transparent: true, depthTest: true, depthFunc: AlwaysDepth, depthWrite: true, alphaTest: 0.1, sizeAttenuation: false })
  const sprite = new Sprite(material)
  sprite.name = name
  sprite.renderOrder = order
  sprite.visible = false
  group.add(sprite)
  return sprite
}

function show(sprite: Sprite, texture: CanvasTexture, opacity: number, exposureGain: number): void {
  const material = sprite.material
  if (material.map !== texture) {
    material.needsUpdate = material.map === null
    material.map = texture
  }
  material.opacity = opacity
  material.color.setScalar(exposureGain)
  sprite.visible = true
}

export function PhotoPins() {
  const enabled = useAppStore((s) => s.settings.labels.photoPins)
  const media = useAppStore((s) => s.settings.film.media)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const table = useMediaStore((s) => s.table)
  const track = useFilmTrack()
  const clock = useFilmClock()
  const { engine, frame } = useTerrainContext()
  const path = useMemo(() => (track ? smoothedTrackPath(track, smoothingM) : null), [track, smoothingM])
  const pins = useMemo(() => (enabled && path ? photoPins(media, path, clock, table) : []), [enabled, media, path, clock, table])
  const groupRef = useRef<Group>(null)
  const entriesRef = useRef<PinEntry[]>([])
  const sharedRef = useRef<{ post: CanvasTexture; postLit: CanvasTexture; foot: CanvasTexture; footLit: CanvasTexture } | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    let alive = true
    const post = drawPost(false)
    const postLit = drawPost(true)
    const foot = drawFoot(false)
    const footLit = drawFoot(true)
    sharedRef.current = post && postLit && foot && footLit ? { post, postLit, foot, footLit } : null
    const entries: PinEntry[] = pins.map((pin) => {
      const entry: PinEntry = {
        pin,
        post: makeSprite(group, `photo-pin-post:${pin.id}`, POST_RENDER_ORDER),
        foot: makeSprite(group, `photo-pin-foot:${pin.id}`, POST_RENDER_ORDER),
        card: makeSprite(group, `photo-pin:${pin.id}`, PIN_RENDER_ORDER),
      }
      const image = new Image()
      image.onload = () => {
        if (!alive) return
        const card = drawCard(image, false)
        const cardLit = drawCard(image, true)
        if (card && cardLit) entry.cardTextures = { card, cardLit }
        wakeScene()
      }
      image.src = table[pin.src]?.thumb ?? ''
      return entry
    })
    entriesRef.current = entries
    wakeScene()
    return () => {
      alive = false
      for (const entry of entries) {
        for (const sprite of [entry.post, entry.foot, entry.card]) {
          sprite.removeFromParent()
          sprite.material.dispose()
        }
        entry.cardTextures?.card.dispose()
        entry.cardTextures?.cardLit.dispose()
      }
      for (const texture of Object.values(sharedRef.current ?? {})) texture.dispose()
      sharedRef.current = null
      entriesRef.current = []
    }
  }, [pins, table])

  useFrame(({ camera, size, gl }) => {
    const entries = entriesRef.current
    const shared = sharedRef.current
    for (const entry of entries) entry.card.visible = entry.post.visible = entry.foot.visible = false
    if (entries.length === 0 || !shared || !frame || size.height <= 0) return
    const { playback, settings } = useAppStore.getState()
    // the poster is a still of the whole outing: no pins on it
    if (useExportStore.getState().request?.still?.compose) return
    const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
    camera.getWorldPosition(cameraPosition)
    const clearanceAt = reliefClearance(engine, frame, settings.exaggeration)
    const sample = engine ? (lon: number, lat: number) => engine.sampleHeight(lon, lat) : null
    const pixel = spriteScaleForPixels(1, size.height, camera.projectionMatrix.elements[5])
    const exposureGain = 1 / gl.toneMappingExposure
    // a share of the frame's height, but of the height of a 16:9 frame of the same width in a tall one (9:16): not gigantic there
    const unit = Math.min(size.height, (size.width * 9) / 16) / PIN_REFERENCE_HEIGHT_PX

    const shown: { entry: PinEntry; lit: boolean; opacity: number; k: number; box: PinBox }[] = []
    for (const entry of entries) {
      if (!entry.cardTextures) continue
      const { pin } = entry
      const position = pinLocalPosition(pin, frame, sample, settings.exaggeration, LINE_LIFT_M, entry.foot.position)
      const distance = cameraPosition.distanceTo(position)
      let opacity = distanceFade(distance, settings.labels.rangeKm * 1000)
      if (clearanceAt) opacity *= occlusionFade(lineOfSightClearance(cameraPosition, position, clearanceAt))
      if (opacity < 0.02) continue
      projected.copy(position).project(camera)
      if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) continue
      const lit = pinLit(pin, timeS)
      const k = unit * settings.labels.size * (1 - 0.5 * smooth((distance - SHRINK_FROM_M) / (SHRINK_TO_M - SHRINK_FROM_M))) * (lit ? LIT_GROWTH : 1)
      const box: PinBox = {
        id: pin.id,
        x: ((projected.x + 1) / 2) * size.width,
        y: ((1 - projected.y) / 2) * size.height,
        w: FRAME_W * k,
        h: FRAME_H * k,
        postPx: POST_H * k,
        lit,
        priority: -distance,
      }
      shown.push({ entry, lit, opacity, k, box })
    }
    const lifts = layoutPins(shown.map((s) => s.box), getShownLabelRects())
    for (const { entry, lit, opacity, k, box } of shown) {
      const lift = lifts.get(box.id)
      if (lift === null || lift === undefined) continue
      const { cardTextures, card, post, foot } = entry
      if (!cardTextures) continue
      const liftCss = lift / k
      post.position.copy(foot.position)
      card.position.copy(foot.position)
      show(foot, lit ? shared.footLit : shared.foot, opacity, exposureGain)
      foot.center.set(0.5, 0.5)
      foot.scale.setScalar((2 * DOT_R + 4) * k * pixel)
      show(post, lit ? shared.postLit : shared.post, opacity, exposureGain)
      post.center.set(0.5, 0)
      post.scale.set(POST_W * k * pixel, (POST_H + liftCss) * k * pixel, 1)
      show(card, lit ? cardTextures.cardLit : cardTextures.card, opacity, exposureGain)
      // the frame's bottom edge sits on top of the post: its margin (shadow) hangs below it
      card.center.set(0.5, -(POST_H + liftCss - MARGIN) / CARD_H)
      card.scale.set(CARD_W * k * pixel, CARD_H * k * pixel, 1)
      card.renderOrder = lit ? LIT_RENDER_ORDER : PIN_RENDER_ORDER
      post.renderOrder = foot.renderOrder = lit ? LIT_RENDER_ORDER : POST_RENDER_ORDER
    }
  })

  return <group ref={groupRef} name="photo-pins" />
}
