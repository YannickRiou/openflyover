/**
 * PROTOTYPE (variant B of `markerLab.ts`): the hiker as a rigged and animated glTF character (Quaternius « Adventurer »,
 * CC0, `public/lab/adventurer-walk.glb`: the Walk clip only, quantised). Posed by the same phase as the figurines: one
 * stride of the clip is one turn of the phase. Same toon shading, same outline and same contact shadow as variant A.
 */
import { AnimationMixer, Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3 } from 'three'
import type { AnimationAction, Material, Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { MODEL_HEIGHT, OUTLINE } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { contactShadow, outlineMaterial, toonMaterial } from './markerLab'
import { wakeScene } from './renderOnDemand'

/** The candidates: the file, the glTF materials that take the colour of the track, a shade of it, and the ones left out (a weapon). */
const CANDIDATES: Record<string, { file: string; main: string[]; shade: string[]; light: string[]; hide: string[] }> = {
  adventurer: { file: 'adventurer-walk.glb', main: ['Green'], shade: [], light: ['LightGreen'], hide: [] },
  adventurerF: { file: 'adventurer-f-walk.glb', main: ['LightGreen'], shade: ['Green'], light: [], hide: [] },
  rogue: { file: 'rogue-walk.glb', main: ['Shirt'], shade: [], light: ['UnderShirt'], hide: ['Material.006'] },
}
const choice = (() => {
  try {
    return new URLSearchParams(location.search).get('glb') ?? 'adventurer'
  } catch {
    return 'adventurer'
  }
})()
const CANDIDATE = CANDIDATES[choice] ?? CANDIDATES.adventurer
const MAIN = new Set(CANDIDATE.main)
const SHADE = new Set(CANDIDATE.shade)
const MAIN_LIGHT = new Set(CANDIDATE.light)
const URL = `${import.meta.env.BASE_URL}lab/${CANDIDATE.file}`

let loading: ReturnType<GLTFLoader['loadAsync']> | null = null
const load = () => (loading ??= new GLTFLoader().loadAsync(URL))

export function createGlbHiker(): MarkerModel {
  const root = new Group()
  const pivot = new Group()
  root.add(pivot)
  const toons: { material: MeshBasicMaterial; base: Color; role: 'main' | 'shade' | 'light' | 'fixed' }[] = []
  const main = new Color('#ffffff')
  const light = new Color('#ffffff')
  let mixer: AnimationMixer | null = null
  let action: AnimationAction | null = null
  let lastPhase = 0

  const apply = () => {
    for (const { material, base, role } of toons) {
      if (role === 'main') material.color.copy(main)
      else if (role === 'shade') material.color.copy(main).multiplyScalar(0.7)
      else if (role === 'light') material.color.copy(main).lerp(light, 0.45)
      else material.color.copy(base).multiply(light)
    }
  }
  const pose = (phase: number) => {
    lastPhase = phase
    if (!action || !mixer) return
    const turn = ((phase / (2 * Math.PI)) % 1 + 1) % 1
    action.time = turn * action.getClip().duration
    mixer.update(0)
  }

  load().then((gltf) => {
    const model = clone(gltf.scene) as Group
    pivot.add(model)
    // stand on the ground, 1.7 tall, facing +Z
    model.updateMatrixWorld(true)
    const box = new Box3().setFromObject(model, true)
    const size = box.getSize(new Vector3())
    const scale = MODEL_HEIGHT / size.y
    pivot.scale.setScalar(scale)
    pivot.position.y = -box.min.y * scale
    pivot.position.x = -((box.min.x + box.max.x) / 2) * scale
    pivot.position.z = -((box.min.z + box.max.z) / 2) * scale
    root.updateMatrixWorld(true)
    const cache = new Map<Material, MeshBasicMaterial>()
    const inRoot = new Matrix4()
    const skinned: SkinnedMesh[] = []
    model.traverse((node: Object3D) => {
      if (!(node instanceof Mesh)) return
      const source = node.material as Material & { color?: Color; name: string }
      let toon = cache.get(source)
      if (!toon) {
        const base = source.color ?? new Color('#999999')
        toon = toonMaterial('#ffffff')
        // the glTF colours are already linear
        toon.color.copy(base)
        const role = MAIN.has(source.name) ? 'main' : SHADE.has(source.name) ? 'shade' : MAIN_LIGHT.has(source.name) ? 'light' : 'fixed'
        toons.push({ material: toon, base: base.clone(), role })
        cache.set(source, toon)
      }
      node.material = toon
      if (CANDIDATE.hide.includes(source.name)) node.visible = false
      node.frustumCulled = false
      if (node instanceof SkinnedMesh) skinned.push(node)
    })
    // the outline: the same skinned mesh, drawn from behind and pushed out along its normals
    for (const mesh of skinned) {
      if (!mesh.visible) continue
      const shell = new SkinnedMesh(mesh.geometry, outlineMaterial())
      shell.bind(mesh.skeleton, mesh.bindMatrix)
      shell.frustumCulled = false
      inRoot.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
      const s = new Vector3().setFromMatrixScale(inRoot)
      const out = OUTLINE / Math.max(s.x, 1e-6)
      const material = shell.material as MeshBasicMaterial
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * ${out.toFixed(6)};`)
      }
      mesh.parent?.add(shell)
    }
    mixer = new AnimationMixer(model)
    const clip = gltf.animations.find((a) => /walk/i.test(a.name)) ?? gltf.animations[0]
    action = mixer.clipAction(clip)
    action.play()
    apply()
    pose(lastPhase)
    wakeScene()
  })

  contactShadow(root)
  return {
    root,
    pose,
    setColor(r, g, b) {
      main.setRGB(r, g, b)
      apply()
    },
    setLight(r, g, b) {
      light.setRGB(r, g, b)
      apply()
    },
  }
}
