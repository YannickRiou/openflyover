import { AmbientLight, Box3, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, OrthographicCamera, Scene, Vector3, WebGLRenderer } from '/node_modules/three/build/three.module.js'
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { FIGURE_MODELS } from '/src/scene/markerFigureModels'

const params = new URLSearchParams(location.search)
const file = params.get('file') ?? 'current'
const side = Number(params.get('size') ?? 420)

async function load(): Promise<Group> {
  if (file === 'current') {
    const model = FIGURE_MODELS.parapente!()
    model.setColor(new Color('#f05a32').r, new Color('#f05a32').g, new Color('#f05a32').b)
    model.setLight?.(1, 1, 1)
    model.pose(1)
    return model.root
  }
  const gltf = await new GLTFLoader().loadAsync(file)
  gltf.scene.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) (m.material as { side: number }).side = DoubleSide
  })
  return gltf.scene
}

;(window as unknown as { run: () => Promise<Record<string, string>> }).run = async () => {
  const group = await load()
  const scene = new Scene()
  scene.background = null
  scene.add(group)
  scene.add(new HemisphereLight('#ffffff', '#8a8f6a', 1.6))
  const sun = new DirectionalLight('#ffffff', 2.2)
  sun.position.set(3, 6, 4)
  scene.add(sun)
  scene.add(new AmbientLight('#ffffff', 0.4))
  group.updateMatrixWorld(true)
  const box = new Box3().setFromObject(group)
  const center = box.getCenter(new Vector3())
  const radius = box.getSize(new Vector3()).length() / 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  gl.setSize(side, side, false)
  gl.setClearColor(0x000000, 0)
  const out: Record<string, string> = {}
  const views: [string, number, number][] = [['behind-above', 0, 32], ['side', 90, 5], ['quarter', 40, 25], ['top', 0, 88]]
  for (const [name, az, el] of views) {
    const a = (az * Math.PI) / 180
    const e = (el * Math.PI) / 180
    const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 10)
    camera.position.set(center.x + Math.sin(a) * Math.cos(e) * radius * 3, center.y + Math.sin(e) * radius * 3, center.z - Math.cos(a) * Math.cos(e) * radius * 3)
    camera.up.set(0, 1, 0)
    camera.lookAt(center)
    gl.render(scene, camera)
    gl.render(scene, camera)
    out[name] = canvas.toDataURL('image/png')
  }
  out.info = JSON.stringify({ size: box.getSize(new Vector3()).toArray(), min: box.min.toArray() })
  return out
}
