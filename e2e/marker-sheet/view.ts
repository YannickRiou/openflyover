// PROTOTYPE (lab/marker-looks, jamais fusionné): page autonome qui rend un marqueur (figurine actuelle ou glTF) sur fond transparent à plusieurs hauteurs en pixels. Voir drive.mjs.
import { Box3, Color, OrthographicCamera, Scene, Vector3, WebGLRenderer } from '/node_modules/three/build/three.module.js'
import { createGlbHiker } from '/src/scene/markerGlb'
import { FIGURE_MODELS } from '/src/scene/markerFigureModels'
import type { MarkerModel } from '/src/scene/markerModelKit'

const params = new URLSearchParams(location.search)
const which = params.get('glb') ?? 'current'
const heights = (params.get('px') ?? '44').split(',').map(Number)
const TRACK = new Color('#f05a32')

const model: MarkerModel = which === 'current' ? FIGURE_MODELS.randonneur!() : createGlbHiker()
model.setColor(TRACK.r, TRACK.g, TRACK.b)
model.setLight?.(1, 1, 1)
model.pose(Math.PI / 3)

async function ready(): Promise<void> {
  // the shadow disc exists before the model does: wait for a mesh that is not the disc (skinned for a glTF character)
  for (let i = 0; i < 600; i++) {
    let skinned = 0
    model.root.traverse((o) => {
      if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned++
    })
    if (which === 'current' || skinned > 0) {
      await new Promise((r) => setTimeout(r, 400))
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('model never loaded: ' + which)
}

async function render(px: number, azimuthDeg: number, elevationDeg: number): Promise<string> {
  const side = Math.ceil(px * 1.6)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  gl.setPixelRatio(1)
  gl.setSize(side, side, false)
  gl.setClearColor(0x000000, 0)
  const scene = new Scene()
  scene.add(model.root)
  const el = (elevationDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  // pixels per unit so that the figure's projected height is `px`
  const span = side / (px / (1.7 * Math.cos(el)))
  const camera = new OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 50)
  const target = new Vector3(0, 0.85 * Math.cos(el) * 0.9, 0)
  camera.position.set(Math.sin(az) * Math.cos(el) * 6, Math.sin(el) * 6 + 0.85, -Math.cos(az) * Math.cos(el) * 6)
  camera.lookAt(target.set(0, 0.85, 0))
  gl.render(scene, camera)
  gl.render(scene, camera)
  const url = canvas.toDataURL('image/png')
  scene.remove(model.root)
  gl.dispose()
  return url
}

;(window as unknown as { run: () => Promise<Record<string, string>> }).run = async () => {
  await ready()
  // let animation clips settle on the pose
  model.pose(Math.PI / 3)
  const out: Record<string, string> = {}
  for (const px of heights) {
    out[`back-${px}`] = await render(px, 0, 32)
    out[`quarter-${px}`] = await render(px, 40, 32)
  }
  return out
}
