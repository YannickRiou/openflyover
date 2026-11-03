/**
 * What the figures made from glTF files share (`markerGlbFigures.ts`, `markerGlbRiders.ts`): the loader of the files, the
 * colours of a figure and the normals its outline is pushed along.
 */
import { BackSide, BufferAttribute, BufferGeometry, Color, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three'
import type { AnimationClip, Bone, Group, Material, Object3D, Texture } from 'three'
import { OUTLINE } from './markerModelKit'

/** The outline of a part is that part's colour darkened: the share of the colour kept. */
export const OUTLINE_SHADE = 0.28

/** What a glTF file holds that a marker needs, loaded once per file. */
export interface Loaded {
  scene: Group
  animations: AnimationClip[]
}
const files = new Map<string, Promise<Loaded>>()
/** Loads under way (and done): what `whenMarkerModelsLoaded` waits for. */
export const pending = new Set<Promise<unknown>>()

/** Resolve once every model asked for has loaded or failed (the export starts on the real model, not its stand-in). */
export async function whenMarkerModelsLoaded(): Promise<void> {
  await Promise.allSettled([...pending])
}

export function loadFile(file: string): Promise<Loaded> {
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

/** The normals of `geometry` averaged over the vertices at the same place (a file splits them at hard edges): for the outline. */
export function smoothNormals(geometry: BufferGeometry): BufferAttribute {
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

/**
 * The colours of a glTF figure, flat: the materials named `main` take the colour of the track (`shade`: a darker tone of it,
 * `light`: a lighter one), the others keep their own, all scaled by the exposure and the light of the scene. The outline of
 * each part is that part's colour darkened (`OUTLINE_SHADE`).
 */
export function createPainter({ main, shade, light: lighter, colors = {} }: { main: string; shade?: string; light?: string; colors?: Record<string, string> }) {
  const parts: { material: MeshBasicMaterial; base: Color; role: 'main' | 'shade' | 'light' | 'fixed'; shells: MeshBasicMaterial[] }[] = []
  const cache = new Map<Material, MeshBasicMaterial>()
  const track = new Color('#ffffff')
  const light = new Color('#ffffff')
  const paint = () => {
    for (const { material, base, role, shells } of parts) {
      if (role === 'main') material.color.copy(track)
      else if (role === 'shade') material.color.copy(track).multiplyScalar(0.7)
      else if (role === 'light') material.color.copy(track).lerp(light, 0.45)
      else material.color.copy(base).multiply(light)
      for (const shell of shells) shell.color.copy(material.color).multiplyScalar(OUTLINE_SHADE)
    }
  }
  return {
    paint,
    setTrack: (r: number, g: number, b: number) => track.setRGB(r, g, b),
    setLight: (r: number, g: number, b: number) => light.setRGB(r, g, b),
    /** the flat material standing for a material of the file (one per material) */
    flat(source: Material & { color: Color; name: string; map?: Texture | null }): MeshBasicMaterial {
      let flat = cache.get(source)
      if (!flat) {
        flat = new MeshBasicMaterial({ map: source.map ?? null })
        cache.set(source, flat)
        // a file may carry no colour at all (white): `colors` gives the base colour of a material by name
        parts.push({ material: flat, base: colors[source.name] ? new Color(colors[source.name]) : source.color.clone(), role: source.name === main ? 'main' : source.name === shade ? 'shade' : source.name === lighter ? 'light' : 'fixed', shells: [] })
      }
      return flat
    },
    /** the material of the outline of a mesh drawn with `flat` */
    shell(flat: MeshBasicMaterial): MeshBasicMaterial {
      const shell = new MeshBasicMaterial({ side: BackSide })
      parts.find((part) => part.material === flat)?.shells.push(shell)
      return shell
    },
  }
}


/**
 * Poses a rigged character by turning each bone towards a direction, whatever clips the file has: the rest axis of a bone is
 * the direction of its first child at rest (an end bone, the shin, goes the way its parent does). Directions are world ones.
 */
export function createBoneAimer(model: Object3D, chains: readonly (readonly [string, string])[], ends: readonly (readonly [string, string])[]) {
  const bones = new Map<string, Bone>()
  model.traverse((o) => {
    if ((o as Bone).isBone) bones.set(o.name, o as Bone)
  })
  model.updateMatrixWorld(true)
  const bone = (name: string): Bone => {
    const found = bones.get(name)
    if (!found) throw new Error(`no bone « ${name} » in the model`)
    return found
  }
  const world = (o: Object3D) => o.getWorldPosition(new Vector3())
  const rotation = (o: Object3D) => o.getWorldQuaternion(new Quaternion())
  /** direction of a bone towards its child at rest, in its own frame */
  const axis = new Map<string, Vector3>()
  for (const [name, child] of chains) axis.set(name, world(bone(child)).sub(world(bone(name))).normalize().applyQuaternion(rotation(bone(name)).invert()))
  // an end bone (the shin) goes the way the bone it follows does
  for (const [name, like] of ends) axis.set(name, axis.get(like)!.clone().applyQuaternion(rotation(bone(like))).applyQuaternion(rotation(bone(name)).invert()))
  const turn = new Quaternion()
  return {
    bone,
    position: (name: string) => world(bone(name)),
    /** turn `name` so that it points along the world direction `to` */
    aim(name: string, to: Vector3) {
      const b = bone(name)
      b.updateWorldMatrix(true, true)
      const q = rotation(b)
      turn.setFromUnitVectors(axis.get(name)!.clone().applyQuaternion(q), to.clone().normalize())
      b.quaternion.copy(rotation(b.parent!).invert().multiply(turn.multiply(q)))
      b.updateWorldMatrix(false, true)
    },
  }
}

type Painter = ReturnType<typeof createPainter>

/**
 * Pushes the vertices of `material` out along their normals by the width of the outline in the units of `mesh` (a file
 * scales its parts differently). A uniform and not a number in the shader: three shares the program of materials whose
 * `onBeforeCompile` reads the same, so a number baked in would be the first mesh's for all.
 */
function pushOut(material: MeshBasicMaterial, root: Object3D, mesh: Object3D, skinned: boolean): void {
  const inRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
  const width = OUTLINE / Math.max(new Vector3().setFromMatrixScale(inRoot).x, 1e-6)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uOutline;')
    shader.vertexShader = skinned
      ? shader.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * uOutline;')
      : shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize( normal ) * uOutline;')
  }
}

/**
 * The outline of skinned meshes: the same mesh drawn from behind, pushed out along its normals (smoothed across the edges
 * the file splits, or the shell tears open there). The width is measured in the units of `root`.
 */
export function outlineSkinned(root: Object3D, skinned: readonly SkinnedMesh[], painter: Painter): void {
  root.updateMatrixWorld(true)
  for (const mesh of skinned.filter((m) => m.visible)) {
    const smooth = mesh.geometry.clone()
    smooth.setAttribute('normal', smoothNormals(mesh.geometry))
    const material = painter.shell(mesh.material as MeshBasicMaterial)
    const shell = new SkinnedMesh(smooth, material)
    shell.bind(mesh.skeleton, mesh.bindMatrix)
    shell.frustumCulled = false
    pushOut(material, root, mesh, true)
    mesh.parent?.add(shell)
  }
}

/** The outline of rigid meshes, as children of them (they turn with them). */
export function outlineRigid(root: Object3D, meshes: readonly Mesh[], painter: Painter): void {
  root.updateMatrixWorld(true)
  for (const mesh of meshes) {
    const smooth = mesh.geometry.clone()
    smooth.setAttribute('normal', smoothNormals(mesh.geometry))
    const material = painter.shell(mesh.material as MeshBasicMaterial)
    pushOut(material, root, mesh, false)
    const shell = new Mesh(smooth, material)
    shell.frustumCulled = false
    mesh.add(shell)
  }
}
