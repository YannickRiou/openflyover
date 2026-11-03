/**
 * Figurine markers made from a glTF file (`public/models`, credited in `modelCredits.json`): a model with colours of its
 * own, unlit like the other markers (`MeshBasicMaterial`, so the exposure still applies), with the same dark outline (a
 * back-face shell pushed out along the normals). The file loads on demand (the glTF loader is its own chunk): until it
 * is there, and if it never comes, the figure is the flat figurine, so a marker is never missing. `whenMarkerModelsLoaded`
 * lets the export wait for it.
 */
import { AnimationMixer, BackSide, BufferAttribute, BufferGeometry, Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3 } from 'three'
import type { AnimationAction, AnimationClip, Material, Object3D, Texture } from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { createParagliderFlat, FIGURE_MODELS } from './markerFigureModels'
import { MODEL_HEIGHT, OUTLINE } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { wakeScene } from './renderOnDemand'

/** Dark of the outline of the wing, a neutral black (a blue ink looked cold on the coloured models). */
const OUTLINE_COLOR = '#1d1a18'
/** The outline of a character is its part in a darker shade of its own colour: the share of the colour kept. */
const OUTLINE_SHADE = 0.28
/** Height of the paraglider's wing and lines, in model units (the flat figurine is 2.4 tall, 3.2 wide). */
const PARAGLIDER_HEIGHT = 2.4

/** What a glTF file holds that a marker needs, loaded once per file. */
interface Loaded {
  scene: Group
  animations: AnimationClip[]
}
const files = new Map<string, Promise<Loaded>>()
/** Loads under way (and done): what `whenMarkerModelsLoaded` waits for. */
const pending = new Set<Promise<unknown>>()

/** Resolve once every model asked for has loaded or failed (the export starts on the real model, not its stand-in). */
export async function whenMarkerModelsLoaded(): Promise<void> {
  await Promise.allSettled([...pending])
}

function loadFile(file: string): Promise<Loaded> {
  let scene = files.get(file)
  if (!scene) {
    scene = import('three/addons/loaders/GLTFLoader.js').then(async ({ GLTFLoader }) => {
      const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${file}`)
      return { scene: gltf.scene, animations: gltf.animations }
    })
    files.set(file, scene)
    // a file that failed is asked again by the next marker
    scene.catch(() => files.delete(file))
  }
  return scene
}

/** One mesh of a file, drawn unlit with its texture, and its outline. */
function flatCopy(source: Mesh, materials: MeshBasicMaterial[], scale: number): Mesh[] {
  const original = source.material as Material & { map?: Texture | null; color?: { r: number; g: number; b: number } }
  const material = new MeshBasicMaterial({ map: original.map ?? null, color: '#ffffff' })
  if (!original.map && original.color) material.color.setRGB(original.color.r, original.color.g, original.color.b)
  materials.push(material)
  const mesh = new Mesh(source.geometry, material)
  mesh.matrix.copy(source.matrixWorld)
  mesh.matrixAutoUpdate = false

  // the outline: the same triangles, welded so that the shell has no crack at the edges, pushed out along its normals
  const positions = new BufferGeometry()
  positions.setAttribute('position', source.geometry.getAttribute('position'))
  if (source.geometry.index) positions.setIndex(source.geometry.index)
  const welded = mergeVertices(positions, 1e-4)
  welded.computeVertexNormals()
  const shellMaterial = new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide })
  const out = (OUTLINE / scale).toFixed(6)
  shellMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normalize( normal ) * ${out};`)
  }
  const shell = new Mesh(welded, shellMaterial)
  shell.matrix.copy(source.matrixWorld)
  shell.matrixAutoUpdate = false
  return [mesh, shell]
}

/**
 * The paraglider: the wing, its lines and the harness bar of a glTF file (« Parachute », Poly by Google, CC BY 3.0), at the
 * track point and facing +Z, swaying a little with the phase. It has no pilot and keeps its own colours.
 */
export function createParagliderWing(): MarkerModel {
  const stand = createParagliderFlat()
  const root = new Group()
  root.add(stand.root)
  const sway = new Group()
  let wing: { group: Group; materials: MeshBasicMaterial[] } | null = null
  let light: [number, number, number] = [1, 1, 1]

  const loaded = loadFile('models/parachute.glb').then(({ scene }) => {
    scene.updateMatrixWorld(true)
    const box = new Box3().setFromObject(scene)
    const size = box.getSize(new Vector3())
    const scale = PARAGLIDER_HEIGHT / size.y
    const group = new Group()
    const materials: MeshBasicMaterial[] = []
    scene.traverse((node) => {
      if ((node as Mesh).isMesh) group.add(...flatCopy(node as Mesh, materials, scale))
    })
    // standing on the track point by the harness bar, centred on it, the leading edge towards +Z
    group.scale.setScalar(scale)
    group.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale)
    sway.add(group)
    root.remove(stand.root)
    root.add(sway)
    wing = { group, materials }
    for (const m of materials) m.color.setRGB(...light)
    wakeScene()
  })
  loaded.catch((error: unknown) => console.warn('[marqueur] modèle 3D du parapente indisponible, figurine plate gardée :', error))
  pending.add(loaded)

  return {
    root,
    pose(phase) {
      stand.pose(phase)
      sway.rotation.z = 0.05 * Math.sin(phase)
      sway.rotation.x = 0.03 * Math.sin(phase * 0.5 + 1)
    },
    setColor(r, g, b) {
      // the flat stand-in takes the colour of the track, the wing its own
      stand.setColor(r, g, b)
    },
    setLight(r, g, b) {
      light = [r, g, b]
      if (wing) for (const m of wing.materials) m.color.setRGB(r, g, b)
    },
  }
}

/** The normals of `geometry` averaged over the vertices at the same place (a file splits them at hard edges): for the outline. */
function smoothNormals(geometry: BufferGeometry): BufferAttribute {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const key = (i: number) => `${Math.round(position.getX(i) * 2000)},${Math.round(position.getY(i) * 2000)},${Math.round(position.getZ(i) * 2000)}`
  const sums = new Map<string, Vector3>()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const n = new Vector3()
  const corner = (i: number) => (index ? index.getX(i) : i)
  for (let f = 0; f < (index ? index.count : position.count); f += 3) {
    const [i, j, k] = [corner(f), corner(f + 1), corner(f + 2)]
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, j)
    c.fromBufferAttribute(position, k)
    // not normalised: the larger the face, the more it weighs
    n.subVectors(c, b).cross(a.sub(b))
    for (const v of [i, j, k]) {
      const id = key(v)
      const sum = sums.get(id)
      if (sum) sum.add(n)
      else sums.set(id, n.clone())
    }
  }
  const normals = new Float32Array(position.count * 3)
  const out = new Vector3()
  for (let v = 0; v < position.count; v++) out.copy(sums.get(key(v)) ?? n.set(0, 1, 0)).normalize().toArray(normals, v * 3)
  return new BufferAttribute(normals, 3)
}

/** What differs between the characters of a file: its materials that take the colour of the track, and the clip played. */
interface CharacterSpec {
  file: string
  /** « Walk », « Run »: one cycle of the clip is one turn of the phase */
  clip: string
  /** materials in the colour of the track (the jacket), their darker shade (the sleeves) and their lighter shade */
  main: string
  shade?: string
  light?: string
  /** meshes left out by name (the runner leaves his backpack at home) */
  hide?: string[]
  /** the flat figure that stands in while the file loads, and if it never does */
  stand: () => MarkerModel
}

/**
 * A rigged glTF character (« Adventurer » and « Adventurer F », Quaternius, CC0) with a backpack, walking or running: one
 * cycle of its clip is one turn of the phase, as the other figurines. Its jacket takes the colour of the track, the rest its
 * own colours, flat and outlined like the other markers. The flat figure stands in until the file is there.
 */
function createCharacter({ file, clip: clipName, main, shade, light: lighter, hide, stand: standIn }: CharacterSpec): MarkerModel {
  const stand = standIn()
  const root = new Group()
  root.add(stand.root)
  const parts: { material: MeshBasicMaterial; base: Color; role: 'main' | 'shade' | 'light' | 'fixed'; shells: MeshBasicMaterial[] }[] = []
  const track = new Color('#ffffff')
  const light = new Color('#ffffff')
  let mixer: AnimationMixer | null = null
  let action: AnimationAction | null = null
  let phase = 0

  const paint = () => {
    for (const { material, base, role, shells } of parts) {
      if (role === 'main') material.color.copy(track)
      else if (role === 'shade') material.color.copy(track).multiplyScalar(0.7)
      else if (role === 'light') material.color.copy(track).lerp(light, 0.45)
      else material.color.copy(base).multiply(light)
      for (const shell of shells) shell.color.copy(material.color).multiplyScalar(OUTLINE_SHADE)
    }
  }
  const pose = () => {
    if (!action || !mixer) return
    const turn = ((phase / (2 * Math.PI)) % 1 + 1) % 1
    action.time = turn * action.getClip().duration
    mixer.update(0)
  }

  const loaded = Promise.all([loadFile(file), import('three/addons/utils/SkeletonUtils.js')]).then(([{ scene, animations }, { clone }]) => {
    const model = clone(scene) as Group
    const pivot = new Group()
    pivot.add(model)
    // standing on the track point, MODEL_HEIGHT tall, centred, facing +Z
    model.updateMatrixWorld(true)
    const box = new Box3().setFromObject(model, true)
    const scale = MODEL_HEIGHT / box.getSize(new Vector3()).y
    pivot.scale.setScalar(scale)
    pivot.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale)
    root.add(pivot)
    pivot.updateMatrixWorld(true)

    const cache = new Map<Material, MeshBasicMaterial>()
    const skinned: SkinnedMesh[] = []
    model.traverse((node: Object3D) => {
      if (!(node as Mesh).isMesh) return
      const mesh = node as Mesh
      const source = mesh.material as Material & { color: Color; name: string; map?: Texture | null }
      let flat = cache.get(source)
      if (!flat) {
        flat = new MeshBasicMaterial({ map: source.map ?? null })
        cache.set(source, flat)
        parts.push({ material: flat, base: source.color.clone(), role: source.name === main ? 'main' : source.name === shade ? 'shade' : source.name === lighter ? 'light' : 'fixed', shells: [] })
      }
      mesh.material = flat
      if (hide?.includes(mesh.parent?.name ?? '')) mesh.visible = false
      mesh.frustumCulled = false
      if ((mesh as SkinnedMesh).isSkinnedMesh) skinned.push(mesh as SkinnedMesh)
    })
    // the outline: the same skinned mesh drawn from behind, pushed out along its normals (in the units of the mesh, which the
    // file may scale: the width of the outline is measured in the marker's own units)
    root.updateMatrixWorld(true)
    const inRoot = new Matrix4()
    for (const mesh of skinned.filter((m) => m.visible)) {
      // smooth normals across the edges split by the file: a normal split at a hard edge would tear the shell open there
      const smooth = mesh.geometry.clone()
      smooth.setAttribute('normal', smoothNormals(mesh.geometry))
      const shellMaterial = new MeshBasicMaterial({ side: BackSide })
      parts.find((part) => part.material === mesh.material)?.shells.push(shellMaterial)
      const shell = new SkinnedMesh(smooth, shellMaterial)
      shell.bind(mesh.skeleton, mesh.bindMatrix)
      shell.frustumCulled = false
      inRoot.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
      const out = (OUTLINE / Math.max(new Vector3().setFromMatrixScale(inRoot).x, 1e-6)).toFixed(6)
      shellMaterial.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * ${out};`)
      }
      mesh.parent?.add(shell)
    }
    const clip = animations.find((a) => a.name.endsWith(`|${clipName}`))
    if (!clip) throw new Error(`no « ${clipName} » animation in ${file}`)
    mixer = new AnimationMixer(model)
    action = mixer.clipAction(clip)
    action.play()
    root.remove(stand.root)
    paint()
    pose()
    wakeScene()
  })
  loaded.catch((error: unknown) => console.warn(`[marqueur] ${file} indisponible, figurine plate gardée :`, error))
  pending.add(loaded)

  return {
    root,
    pose(next) {
      phase = next
      stand.pose(next)
      pose()
    },
    setColor(r, g, b) {
      track.setRGB(r, g, b)
      stand.setColor(r, g, b)
      paint()
    },
    setLight(r, g, b) {
      light.setRGB(r, g, b)
      paint()
    },
  }
}

/** « Adventurer »: the hiker walks, the runner runs. */
const ADVENTURER = { file: 'models/adventurer.glb', main: 'Green', light: 'LightGreen' }
/** « Adventurer F »: the trail runner. */
const ADVENTURER_F = { file: 'models/adventurer-f.glb', main: 'LightGreen', shade: 'Green' }

export const createHikerAdventurer = (): MarkerModel => createCharacter({ ...ADVENTURER, clip: 'Walk', stand: FIGURE_MODELS.randonneur! })
export const createRunnerAdventurer = (): MarkerModel => createCharacter({ ...ADVENTURER, clip: 'Run', hide: ['Backpack'], stand: FIGURE_MODELS.coureur! })
export const createTrailRunnerAdventurerF = (): MarkerModel => createCharacter({ ...ADVENTURER_F, clip: 'Run', stand: FIGURE_MODELS.traileur! })
