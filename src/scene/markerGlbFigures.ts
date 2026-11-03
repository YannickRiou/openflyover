/**
 * Figurine markers made from a glTF file (`public/models`, credited in `modelCredits.json`): a model with colours of its
 * own, unlit like the other markers (`MeshBasicMaterial`, so the exposure still applies), with the same dark outline (a
 * back-face shell pushed out along the normals). The file loads on demand (the glTF loader is its own chunk): until it
 * is there, and if it never comes, the figure is the flat figurine, so a marker is never missing. `whenMarkerModelsLoaded`
 * lets the export wait for it.
 */
import { BackSide, BufferGeometry, Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { Material, Texture } from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { createParagliderFlat } from './markerFigureModels'
import { OUTLINE } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { wakeScene } from './renderOnDemand'

/** Dark of the outline, as the ink of the badges (`markerModelKit.ts`). */
const OUTLINE_COLOR = '#1C2A33'
/** Height of the paraglider's wing and lines, in model units (the flat figurine is 2.4 tall, 3.2 wide). */
const PARAGLIDER_HEIGHT = 2.4

/** The scene of a glTF file, loaded once per file. */
const files = new Map<string, Promise<Group>>()
/** Loads under way (and done): what `whenMarkerModelsLoaded` waits for. */
const pending = new Set<Promise<unknown>>()

/** Resolve once every model asked for has loaded or failed (the export starts on the real model, not its stand-in). */
export async function whenMarkerModelsLoaded(): Promise<void> {
  await Promise.allSettled([...pending])
}

function loadScene(file: string): Promise<Group> {
  let scene = files.get(file)
  if (!scene) {
    scene = import('three/addons/loaders/GLTFLoader.js').then(async ({ GLTFLoader }) => (await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${file}`)).scene)
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

  const loaded = loadScene('models/parachute.glb').then((scene) => {
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
