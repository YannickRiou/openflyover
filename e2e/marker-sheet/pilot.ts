import { AmbientLight, Box3, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshStandardMaterial, Object3D, OrthographicCamera, Quaternion, Scene, Vector3, WebGLRenderer } from '/node_modules/three/build/three.module.js'
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from '/node_modules/three/examples/jsm/utils/SkeletonUtils.js'

const q = new URLSearchParams(location.search)
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
const WING = q.get('wing') ?? '/wings/yellow.glb'
const TRACK = new Color(q.get('color') ?? '#f05a32')
const tint = q.get('tint') !== '0'

;(window as unknown as { run: () => Promise<Record<string, string>> }).run = async () => {
  const loader = new GLTFLoader()
  const [wingGltf, manGltf] = await Promise.all([loader.loadAsync(WING), loader.loadAsync('/lab/adventurer-walk.glb')])

  // --- the wing: span along X, about 9 m, harness at the bottom
  const wing = wingGltf.scene
  wing.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const mat = (m.material as MeshStandardMaterial).clone()
    mat.side = DoubleSide
    // the canopy and the harness (yellow) take the colour of the track
    if (tint && mat.color.r > 0.6 && mat.color.g > 0.6 && mat.color.b < 0.4) mat.color.copy(TRACK)
    m.material = mat
  })
  const wingBox = new Box3().setFromObject(wing)
  const size = wingBox.getSize(new Vector3())
  const wingScale = num('span', 9) / Math.max(size.x, size.z)
  const wingHolder = new Group()
  wingHolder.add(wing)
  wing.position.set(-(wingBox.min.x + wingBox.max.x) / 2, -wingBox.min.y, -(wingBox.min.z + wingBox.max.z) / 2)
  wingHolder.scale.setScalar(wingScale)
  // the span is the longest horizontal side: along X (turn if it is along Z), `flip` turns the glider round
  wingHolder.rotation.y = (size.z > size.x ? Math.PI / 2 : 0) + num('flip', 0) * Math.PI

  // --- the pilot: Adventurer in its rest pose, every body segment turned towards a target direction (the pilot faces +Z)
  const man = clone(manGltf.scene) as Group
  man.updateMatrixWorld(true)
  const bones: Record<string, Object3D> = {}
  man.traverse((o) => { if ((o as { isBone?: boolean }).isBone) bones[o.name] = o })
  const B = (name: string) => bones[name.replace('.', '')]
  const wp = (o: Object3D) => o.getWorldPosition(new Vector3())
  const wq = (o: Object3D) => o.getWorldQuaternion(new Quaternion())
  /** direction of each bone towards its child at rest, in the bone's own frame: the axis `aim` turns */
  const axisOf: Record<string, Vector3> = {}
  const rest = (name: string, child: string) => {
    const bone = B(name)
    axisOf[name] = wp(B(child)).sub(wp(bone)).normalize().applyQuaternion(wq(bone).invert())
  }
  for (const [n, c] of [['Hips', 'Abdomen'], ['Abdomen', 'Torso'], ['Torso', 'Chest'], ['Chest', 'Neck'], ['Neck', 'Head'], ['UpperLeg.L', 'LowerLeg.L'], ['UpperLeg.R', 'LowerLeg.R'], ['UpperArm.L', 'LowerArm.L'], ['UpperArm.R', 'LowerArm.R'], ['LowerArm.L', 'Wrist.L'], ['LowerArm.R', 'Wrist.R']] as const) rest(n, c)
  // the legs end at the knee-to-foot bone, which has no child: it goes the same way as the thigh at rest
  axisOf['LowerLeg.L'] = axisOf['UpperLeg.L'].clone().applyQuaternion(wq(B('UpperLeg.L'))).applyQuaternion(wq(B('LowerLeg.L')).invert())
  axisOf['LowerLeg.R'] = axisOf['UpperLeg.R'].clone().applyQuaternion(wq(B('UpperLeg.R'))).applyQuaternion(wq(B('LowerLeg.R')).invert())
  const aim = (name: string, dir: Vector3) => {
    const bone = B(name)
    bone.updateWorldMatrix(true, true)
    const q = wq(bone)
    const from = axisOf[name].clone().applyQuaternion(q)
    const turn = new Quaternion().setFromUnitVectors(from, dir.clone().normalize())
    const parent = wq(bone.parent!)
    bone.quaternion.copy(parent.invert().multiply(turn.multiply(q)))
    bone.updateWorldMatrix(false, true)
  }
  const rad = (d: number) => (d * Math.PI) / 180
  const lean = num('lean', 30)
  const spine = (deg: number) => new Vector3(0, Math.cos(rad(deg)), -Math.sin(rad(deg)))
  aim('Hips', spine(lean + 8))
  aim('Abdomen', spine(lean + 3))
  aim('Torso', spine(lean - 2))
  aim('Chest', spine(lean - 6))
  aim('Neck', new Vector3(0, 1, num('headz', 0.35)))
  for (const side of [1, -1]) {
    const n = side === 1 ? 'L' : 'R'
    const thigh = rad(num('thigh', 22))
    const shin = rad(num('shin', 65))
    aim(`UpperLeg.${n}`, new Vector3(side * num('legout', 0.12), -Math.sin(thigh), Math.cos(thigh)))
    aim(`LowerLeg.${n}`, new Vector3(side * 0.04, -Math.sin(shin), Math.cos(shin)))
    aim(`UpperArm.${n}`, new Vector3(side * num('armout', 0.35), -num('armdown', 0.6), 0.72))
    aim(`LowerArm.${n}`, new Vector3(side * 0.1, num('handup', 0.35), 0.93))
  }
  man.updateMatrixWorld(true)
  man.traverse((o) => { (o as Mesh).frustumCulled = false })
  const manBox = new Box3().setFromObject(man, true)
  const manScale = 1.7 / manBox.getSize(new Vector3()).y
  const manHolder = new Group()
  manHolder.add(man)
  manHolder.scale.setScalar(manScale)
  manHolder.updateMatrixWorld(true)
  // the hips go to the harness
  const hips = new Vector3()
  B('Hips').getWorldPosition(hips)
  const harness = new Vector3(0, num('seat', 0.33), num('seatz', -0.12))
  manHolder.position.copy(harness).sub(hips)

  const scene = new Scene()
  scene.add(wingHolder, manHolder)
  scene.add(new HemisphereLight('#ffffff', '#8a8f6a', 1.6))
  const sun = new DirectionalLight('#ffffff', 2.2)
  sun.position.set(3, 6, 4)
  scene.add(sun, new AmbientLight('#ffffff', 0.4))
  scene.updateMatrixWorld(true)

  const box = new Box3().setFromObject(scene)
  const center = box.getCenter(new Vector3())
  const radius = box.getSize(new Vector3()).length() / 2
  const side = num('size', 520)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = side
  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  gl.setSize(side, side, false)
  gl.setClearColor(0x000000, 0)
  const out: Record<string, string> = {}
  const views: [string, number, number, number][] = [['behind', 0, 22, 1], ['quarter', 40, 22, 1], ['side', 90, 4, 1], ['front', 180, 12, 1], ['pilot-quarter', 35, 15, 0.28], ['pilot-side', 90, 3, 0.28]]
  for (const [name, az, el, zoom] of views) {
    const a = (az * Math.PI) / 180
    const e = (el * Math.PI) / 180
    const r = radius * zoom
    const c = zoom < 1 ? new Vector3(harness.x, harness.y + 0.3, harness.z) : center
    const cam = new OrthographicCamera(-r, r, r, -r, 0.01, radius * 10)
    cam.position.set(c.x + Math.sin(a) * Math.cos(e) * radius * 3, c.y + Math.sin(e) * radius * 3, c.z - Math.cos(a) * Math.cos(e) * radius * 3)
    cam.lookAt(c)
    gl.render(scene, cam)
    gl.render(scene, cam)
    out[name] = canvas.toDataURL('image/png')
  }
  out.info = JSON.stringify({ wingScale, manScale, bones: Object.keys(bones).slice(0, 8), hips: hips.toArray() })
  return out
}
