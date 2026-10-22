/**
 * PhotoPins — « Photos sur le terrain » (prototype): each picture of the film's timeline stands on the relief as a post
 * with its framed thumbnail, at the track point under the marker when the photo appears (`film/photoPins.ts`). A sprite
 * of constant screen size (a little smaller far away), like the labels; it lights up (chartreuse frame, larger) while the
 * photo is on screen. The camera turns towards it in `FlyoverRig` (`pinAimTarget`). Must be rendered inside TerrainLayer.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, Group, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three'
import { useExportStore } from '../export/store'
import { useMediaStore } from '../film/media'
import { photoPins, pinLit, type PhotoPin } from '../film/photoPins'
import { smoothedTrackPath } from '../flyover/smooth'
import { useAppStore } from '../state/store'
import { distanceFade, lineOfSightClearance, occlusionFade, spriteScaleForPixels } from './labelModel'
import { reliefClearance } from './markerSprite'
import { useTerrainContext } from './terrainContext'
import { pinPosition } from './photoPinPlace'
import { useFilmClock, useFilmTrack } from './usePacing'
import { wakeScene } from './renderOnDemand'

// look (CSS pixels)
const THUMB_W = 96
const THUMB_H = 70
const FRAME = 5
const POST_H = 26
const DOT_R = 4
const MARGIN = 16
const TEXTURE_SCALE = 2
const NAVY = '#113B54'
const CHARTREUSE = '#DBE64C'
const PIN_RENDER_ORDER = 11
/** Distance (m) over which a pin goes from full size to 60 % of it: readable far away, never huge close up. */
const SHRINK_FROM_M = 1_000
const SHRINK_TO_M = 10_000
const LIT_GROWTH = 1.25

interface PinTexture {
  texture: CanvasTexture
  width: number
  height: number
  anchorY: number
}

function drawPinTexture(image: CanvasImageSource & { width: number; height: number }, lit: boolean): PinTexture | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const s = TEXTURE_SCALE
  const frameW = THUMB_W + 2 * FRAME
  const frameH = THUMB_H + 2 * FRAME
  const width = frameW + 2 * MARGIN
  const baseY = MARGIN + frameH + POST_H + DOT_R
  const height = baseY + DOT_R + MARGIN
  canvas.width = width * s
  canvas.height = height * s
  ctx.scale(s, s)
  const cx = width / 2
  const accent = lit ? CHARTREUSE : '#FFFFFF'

  // post: navy edge, then the accent
  ctx.lineCap = 'round'
  ctx.strokeStyle = NAVY
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(cx, MARGIN + frameH)
  ctx.lineTo(cx, baseY)
  ctx.stroke()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, baseY, DOT_R, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = NAVY
  ctx.lineWidth = 1.5
  ctx.stroke()

  // frame with its soft shadow (a glow when lit)
  ctx.save()
  ctx.shadowColor = lit ? CHARTREUSE : 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = lit ? 14 : 9
  ctx.shadowOffsetY = lit ? 0 : 3
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.roundRect(MARGIN, MARGIN, frameW, frameH, 6)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = NAVY
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(MARGIN, MARGIN, frameW, frameH, 6)
  ctx.stroke()

  // the picture, cropped to fill the thumbnail
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(MARGIN + FRAME, MARGIN + FRAME, THUMB_W, THUMB_H, 3)
  ctx.clip()
  const k = Math.max(THUMB_W / image.width, THUMB_H / image.height)
  const w = image.width * k
  const h = image.height * k
  ctx.drawImage(image, MARGIN + FRAME + (THUMB_W - w) / 2, MARGIN + FRAME + (THUMB_H - h) / 2, w, h)
  ctx.restore()

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return { texture, width, height, anchorY: (DOT_R + MARGIN) / height }
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

interface PinEntry {
  pin: PhotoPin
  sprite: Sprite
  material: SpriteMaterial
  textures?: { normal: PinTexture; lit: PinTexture }
}

const cameraPosition = new Vector3()

export function PhotoPins() {
  const enabled = useAppStore((s) => s.settings.labels.photoPins)
  const media = useAppStore((s) => s.settings.film.media)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const table = useMediaStore((s) => s.table)
  const track = useFilmTrack()
  const clock = useFilmClock()
  const { engine, frame } = useTerrainContext()
  const path = useMemo(() => (track ? smoothedTrackPath(track, smoothingM) : null), [track, smoothingM])
  const pins = useMemo(() => (enabled && path ? photoPins(media, path, clock) : []), [enabled, media, path, clock])
  const groupRef = useRef<Group>(null)
  const entriesRef = useRef<PinEntry[]>([])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    let alive = true
    const entries: PinEntry[] = []
    for (const pin of pins) {
      const thumb = table[pin.src]?.thumb
      if (!thumb) continue
      const material = new SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false })
      const sprite = new Sprite(material)
      sprite.name = `photo-pin:${pin.id}`
      sprite.renderOrder = PIN_RENDER_ORDER
      sprite.visible = false
      group.add(sprite)
      const entry: PinEntry = { pin, sprite, material }
      entries.push(entry)
      const image = new Image()
      image.onload = () => {
        if (!alive) return
        const normal = drawPinTexture(image, false)
        const lit = drawPinTexture(image, true)
        if (normal && lit) entry.textures = { normal, lit }
        wakeScene()
      }
      image.src = thumb
    }
    entriesRef.current = entries
    wakeScene()
    return () => {
      alive = false
      for (const entry of entries) {
        entry.sprite.removeFromParent()
        entry.material.dispose()
        entry.textures?.normal.texture.dispose()
        entry.textures?.lit.texture.dispose()
      }
      entriesRef.current = []
    }
  }, [pins, table])

  useFrame(({ camera, size, gl }) => {
    const entries = entriesRef.current
    if (entries.length === 0 || !path || !frame) return
    const { playback, settings } = useAppStore.getState()
    const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
    const { renderScale } = useExportStore.getState()
    camera.getWorldPosition(cameraPosition)
    const clearanceAt = reliefClearance(engine, frame, settings.exaggeration)
    const pixel = spriteScaleForPixels(1, size.height, camera.projectionMatrix.elements[5]) * renderScale * settings.labels.size
    for (const entry of entries) {
      const { sprite, material, textures, pin } = entry
      if (!textures) continue
      const lit = pinLit(pin, timeS)
      const tex = lit ? textures.lit : textures.normal
      pinPosition(pin, path, frame, engine, settings.exaggeration, sprite.position)
      const distance = cameraPosition.distanceTo(sprite.position)
      let opacity = distanceFade(distance, settings.labels.rangeKm * 1000)
      if (clearanceAt) opacity *= occlusionFade(lineOfSightClearance(cameraPosition, sprite.position, clearanceAt))
      sprite.visible = opacity > 0.02
      if (!sprite.visible) continue
      const grow = (1 - 0.5 * smooth((distance - SHRINK_FROM_M) / (SHRINK_TO_M - SHRINK_FROM_M))) * (lit ? LIT_GROWTH : 1)
      if (material.map !== tex.texture) {
        material.needsUpdate = material.map === null
        material.map = tex.texture
      }
      material.opacity = opacity
      material.color.setScalar(1 / gl.toneMappingExposure)
      sprite.center.set(0.5, tex.anchorY)
      sprite.scale.set(tex.width * pixel * grow, tex.height * pixel * grow, 1)
    }
  })

  return <group ref={groupRef} name="photo-pins" />
}
