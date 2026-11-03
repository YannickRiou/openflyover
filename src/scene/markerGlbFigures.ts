/**
 * Figurine markers made from a glTF file (`public/models`, credited in `modelCredits.json`): a model with colours of its
 * own, unlit like the other markers (`MeshBasicMaterial`, so the exposure still applies), with the same dark outline (a
 * back-face shell pushed out along the normals). The file loads on demand (the glTF loader is its own chunk): until it
 * is there, and if it never comes, the figure is the flat figurine, so a marker is never missing. `whenMarkerModelsLoaded`
 * lets the export wait for it.
 */
import { AnimationMixer, BackSide, BufferGeometry, Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three'
import type { AnimationAction, Material, Object3D, Texture } from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { createParagliderFlat, FIGURE_MODELS } from './markerFigureModels'
import { MODEL_HEIGHT, OUTLINE } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { createPainter, loadFile, outlineRigid, outlineSkinned, pending } from './markerGlbKit'
import { wakeScene } from './renderOnDemand'

/** Dark of the outline of the wing, a neutral black (a blue ink looked cold on the coloured models). */
const OUTLINE_COLOR = '#1d1a18'
/** Height of the paraglider's wing and lines, in model units (the flat figurine is 2.4 tall, 3.2 wide). */
const PARAGLIDER_HEIGHT = 2.4

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
function createCharacter({ file, clip: clipName, hide, stand: standIn, ...colors }: CharacterSpec): MarkerModel {
  const stand = standIn()
  const root = new Group()
  root.add(stand.root)
  const painter = createPainter(colors)
  let mixer: AnimationMixer | null = null
  let action: AnimationAction | null = null
  let phase = 0

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

    const skinned: SkinnedMesh[] = []
    model.traverse((node: Object3D) => {
      if (!(node as Mesh).isMesh) return
      const mesh = node as Mesh
      mesh.material = painter.flat(mesh.material as Material & { color: Color; name: string; map?: Texture | null })
      if (hide?.includes(mesh.parent?.name ?? '')) mesh.visible = false
      mesh.frustumCulled = false
      if ((mesh as SkinnedMesh).isSkinnedMesh) skinned.push(mesh as SkinnedMesh)
    })
    outlineSkinned(root, skinned, painter)
    const clip = animations.find((a) => a.name.endsWith(`|${clipName}`))
    if (!clip) throw new Error(`no « ${clipName} » animation in ${file}`)
    mixer = new AnimationMixer(model)
    action = mixer.clipAction(clip)
    action.play()
    root.remove(stand.root)
    painter.paint()
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
      painter.setTrack(r, g, b)
      stand.setColor(r, g, b)
      painter.paint()
    },
    setLight(r, g, b) {
      painter.setLight(r, g, b)
      painter.paint()
    },
  }
}

/** A part of a vehicle that turns about its own centre: a wheel, a propeller. */
interface Spinner {
  /** node names it applies to */
  match: RegExp
  /** axis of the part in its own frame */
  axis: 'x' | 'y' | 'z'
  /** turns of the part for one turn of the phase */
  turns: number
  /** the part is made this many times thicker along its axis (a fat tyre) */
  thick?: number
}

/** A vehicle, and where a point of its file lands in its own frame (null until it is loaded): for the rider to sit on. */
export interface Vehicle extends MarkerModel {
  place(point: Vector3): Vector3 | null
  /** settles when the file is loaded (or failed) */
  loaded: Promise<void>
}

/** What differs between the vehicles: the file, the materials taking the colour of the track, the size and the way it faces. */
export interface VehicleSpec {
  file: string
  /** material in the colour of the track (the body) */
  main: string
  /** length of the vehicle (its longest side, horizontal), in model units */
  length: number
  /** turn about the vertical axis, so that the front looks along +Z */
  yaw: number
  spin?: Spinner[]
  /** parts added in code to the model, in the units of the file (a battery, a bag): coloured by `Material.name` as the file's own */
  extras?: (model: Group) => void
  /** base colour of the materials of the file that have none, by name */
  colors?: Record<string, string>
  /** the flat figure that stands in while the file loads, and if it never does */
  stand: () => MarkerModel
}

/**
 * A rigid glTF vehicle: its body in the colour of the track, the rest in its own colours, flat and outlined like the
 * other markers, its wheels or propeller turning with the phase. The flat figure stands in until the file is there.
 */
export function createVehicle({ file, main, length, yaw, spin = [], extras, colors, stand: standIn }: VehicleSpec): Vehicle {
  const stand = standIn()
  const root = new Group()
  root.add(stand.root)
  const painter = createPainter({ main, colors })
  const axes = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }
  const spinners: { node: Object3D; axis: Vector3; base: Quaternion; turns: number }[] = []
  /** from the units of the file to the vehicle's own frame, once loaded */
  let placement: Matrix4 | null = null
  const turn = new Quaternion()

  const loaded = loadFile(file).then(({ scene }) => {
    const model = scene.clone(true)
    const pivot = new Group()
    pivot.rotation.y = yaw
    pivot.add(model)
    extras?.(model)
    const meshes: Mesh[] = []
    model.traverse((node) => {
      if ((node as Mesh).isMesh) meshes.push(node as Mesh)
    })
    for (const mesh of meshes) {
      const rule = spin.find((s) => s.match.test(mesh.name))
      if (rule) {
        // a part that turns does so about its own centre: its node's origin moves there (the file bakes the place in the vertices)
        const geometry = mesh.geometry.clone()
        geometry.computeBoundingBox()
        const centre = geometry.boundingBox!.getCenter(new Vector3())
        geometry.translate(-centre.x, -centre.y, -centre.z)
        mesh.geometry = geometry
        mesh.position.add(centre.multiply(mesh.scale).applyQuaternion(mesh.quaternion))
        if (rule.thick) mesh.scale[rule.axis] *= rule.thick
        spinners.push({ node: mesh, axis: axes[rule.axis], base: mesh.quaternion.clone(), turns: rule.turns })
      }
      mesh.material = painter.flat(mesh.material as Material & { color: Color; name: string; map?: Texture | null })
      mesh.frustumCulled = false
    }
    // standing on the track point, `length` long, centred
    pivot.updateMatrixWorld(true)
    const box = new Box3().setFromObject(pivot)
    const size = box.getSize(new Vector3())
    const scale = length / Math.max(size.x, size.z)
    const group = new Group()
    group.add(pivot)
    group.scale.setScalar(scale)
    group.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale)
    root.add(group)
    group.updateMatrixWorld(true)
    placement = group.matrix.clone().multiply(pivot.matrix)
    outlineRigid(root, meshes, painter)
    root.remove(stand.root)
    painter.paint()
    wakeScene()
  })
  loaded.catch((error: unknown) => console.warn(`[marqueur] ${file} indisponible, figurine plate gardée :`, error))
  pending.add(loaded)

  return {
    root,
    loaded,
    place: (point) => (placement ? point.clone().applyMatrix4(placement) : null),
    pose(phase) {
      stand.pose(phase)
      for (const { node, axis, base, turns } of spinners) node.quaternion.copy(base).multiply(turn.setFromAxisAngle(axis, phase * turns))
    },
    setColor(r, g, b) {
      painter.setTrack(r, g, b)
      stand.setColor(r, g, b)
      painter.paint()
    },
    setLight(r, g, b) {
      painter.setLight(r, g, b)
      painter.paint()
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

/** The wheels of the Quaternius car turn about their axle (X), 3 turns for one turn of the phase. */
const WHEELS: Spinner = { match: /Wheel/, axis: 'x', turns: 3 }
export const createCarQuaternius = (): MarkerModel => createVehicle({ file: 'models/car.glb', main: 'Blue', length: 2.3, yaw: 0, spin: [WHEELS], stand: FIGURE_MODELS.voiture! })
export const createMotorbikeCartoon = (): MarkerModel => createVehicle({ file: 'models/motorcycle.glb', main: 'LightPurple', length: 1.9, yaw: Math.PI, stand: FIGURE_MODELS.moto! })
export const createPlaneLight = (): MarkerModel => createVehicle({ file: 'models/plane.glb', main: 'Material.004', length: 2.5, yaw: 0, spin: [{ match: /Cylinder\.001/, axis: 'y', turns: 6 }], stand: FIGURE_MODELS.avion! })
