/**
 * MarkerValue — the panel of « Donnée au-dessus du marqueur » (`settings.markerValue`): a sprite above the lead marker
 * showing one counter of the overlay at the film's progress. A pure function of the settings and the progress, so the
 * export draws what the preview shows. Its canvas is redrawn only when the text changes. Draws nothing itself when off.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, SRGBColorSpace } from 'three'
import type { Sprite, SpriteMaterial } from 'three'
import { createOverlayFilmCache } from '../overlay/exportOverlay'
import { overlayFilmFrameAt } from '../overlay/data'
import { useAppStore } from '../state/store'
import { leadMarkerAnchor, pullMarkerForward } from './markerSprite'
import { VALUE_CANVAS, VALUE_GAP_BALLS, VALUE_PANEL_BALLS, markerValueText, paintValue, valueLookKey } from './markerValuePanel'

export function MarkerValue() {
  const sprite = useRef<Sprite>(null)
  const film = useMemo(() => createOverlayFilmCache(), [])
  const painted = useRef({ key: '', texture: null as CanvasTexture | null })

  useEffect(() => {
    const own = painted.current
    return () => {
      own.texture?.dispose()
      own.texture = null
    }
  }, [])

  useFrame(({ camera, gl }) => {
    const panel = sprite.current
    if (!panel) return
    const { settings, playback } = useAppStore.getState()
    const data = settings.markerValue === 'aucune' || !leadMarkerAnchor.shown ? null : film()
    const text = data ? markerValueText(settings.markerValue, overlayFilmFrameAt(data, playback.progress)) : null
    panel.visible = text !== null
    if (text === null) return
    const key = `${text.value}|${text.unit}|${valueLookKey(settings.overlay)}`
    const own = painted.current
    if (!own.texture) {
      const canvas = document.createElement('canvas')
      canvas.width = VALUE_CANVAS.width
      canvas.height = VALUE_CANVAS.height
      own.texture = new CanvasTexture(canvas)
      own.texture.colorSpace = SRGBColorSpace
      own.key = ''
    }
    if (own.key !== key) {
      paintValue(own.texture.image as HTMLCanvasElement, settings.overlay, text)
      own.texture.needsUpdate = true
      own.key = key
    }
    const material = panel.material as SpriteMaterial
    if (material.map !== own.texture) {
      material.map = own.texture
      material.needsUpdate = true
    }
    // unlit: the colours are divided by the exposure, like the marker's
    material.color.setScalar(1 / gl.toneMappingExposure)
    const ball = 2 * leadMarkerAnchor.radius
    panel.center.set(0.5, 0)
    panel.position.copy(leadMarkerAnchor.position)
    panel.position.y += (leadMarkerAnchor.heightBalls + VALUE_GAP_BALLS) * ball
    const height = VALUE_PANEL_BALLS * ball
    panel.scale.set((height * VALUE_CANVAS.width) / VALUE_CANVAS.height, height, 1)
    pullMarkerForward(panel, camera)
  })

  return (
    <sprite ref={sprite} name="marker-value" visible={false} renderOrder={3}>
      <spriteMaterial depthWrite={false} />
    </sprite>
  )
}
