/**
 * PROTOTYPE (branch lab/marker-looks, never merged): a comparison of three looks for the 3D figurine markers, chosen with
 * `?marker-lab=current|a|b` in the page address.
 *   current  the flat figurine of `markerFigureModels.ts`
 *   a        the same primitives, toon-shaded by the sun of the scene, several colours, a contact shadow, livelier motion
 *   b        a rigged and animated glTF character (Quaternius « Adventurer », CC0), same shading, same outline
 */
import { BackSide, Scene, CanvasTexture, CircleGeometry, Color, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three'

export type LabMode = 'current' | 'a' | 'b'

export const labMode: LabMode = (() => {
  try {
    const value = new URLSearchParams(location.search).get('marker-lab')
    return value === 'a' || value === 'b' ? value : 'current'
  } catch {
    return 'current'
  }
})()

/** World direction towards the sun, written every frame by the atmosphere (`setLabSun`). */
export const SUN = { value: new Vector3(0.4, 0.8, 0.3).normalize() }

const world = new Matrix4()
export function setLabSun(ecefDirection: Vector3, worldToEcef: Matrix4): void {
  SUN.value.copy(ecefDirection).transformDirection(world.copy(worldToEcef).invert()).normalize()
}

/**
 * A flat material (`MeshBasicMaterial`, so the colour goes through the same exposure as the other markers) whose colour is cut
 * in three tones by the angle between the surface and the sun: lit, turned away, in the shade. Works on skinned meshes too.
 */
export function toonMaterial(hex: string): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: hex })
  material.userData.base = new Color(hex)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSun = SUN
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vToonN;')
      .replace(
        '#include <begin_vertex>',
        `#if !( defined( USE_ENVMAP ) || defined( USE_SKINNING ) )
  vec3 objectNormal = vec3( normal );
  #include <defaultnormal_vertex>
#endif
vToonN = inverseTransformDirection( transformedNormal, viewMatrix );
#include <begin_vertex>`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vToonN;\nuniform vec3 uSun;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float d = dot( normalize( vToonN ), uSun );
  float tone = mix( 0.52, 0.78, smoothstep( -0.32, -0.26, d ) );
  tone = mix( tone, 1.0, smoothstep( 0.22, 0.28, d ) );
  diffuseColor.rgb *= tone;
}`,
      )
  }
  return material
}

/** The colours of a figure: one toon material per part. `main` is the colour of the track; the others keep their own, scaled by the light of the scene. */
export type PartName = 'jacket' | 'pack' | 'skin' | 'trousers' | 'boots' | 'hat' | 'pole' | 'wing' | 'wingLight'
export interface Palette {
  parts: Record<PartName, MeshBasicMaterial>
  /** the colour of the track, and the factor of the light of the scene (exposure, tint) */
  setColor(r: number, g: number, b: number): void
  setLight(r: number, g: number, b: number): void
}

const FIXED: Record<Exclude<PartName, 'jacket' | 'pack' | 'wing' | 'wingLight'>, string> = {
  skin: '#E3B08D',
  trousers: '#46505C',
  boots: '#5B4632',
  hat: '#D9CBA4',
  pole: '#9AA3AB',
}

export function createPalette(): Palette {
  const main = new Color('#ffffff')
  const light = new Color('#ffffff')
  const parts = {
    jacket: toonMaterial('#ffffff'),
    pack: toonMaterial('#ffffff'),
    wing: toonMaterial('#ffffff'),
    wingLight: toonMaterial('#ffffff'),
    skin: toonMaterial(FIXED.skin),
    trousers: toonMaterial(FIXED.trousers),
    boots: toonMaterial(FIXED.boots),
    hat: toonMaterial(FIXED.hat),
    pole: toonMaterial(FIXED.pole),
  }
  const apply = () => {
    parts.jacket.color.copy(main)
    parts.pack.color.copy(main).multiplyScalar(0.62)
    parts.wing.color.copy(main)
    // the lighter stripe of a wing: the colour of the track pulled towards white
    parts.wingLight.color.copy(main).lerp(light, 0.55)
    for (const name of Object.keys(FIXED) as (keyof typeof FIXED)[]) parts[name].color.copy(parts[name].userData.base as Color).multiply(light)
  }
  return {
    parts,
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

const OUTLINE_COLOR = '#1C2A33'
export const outlineMaterial = () => new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide })

let shadowTexture: CanvasTexture | null = null
function softDisc(): CanvasTexture {
  if (shadowTexture) return shadowTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(0,0,0,0.9)')
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.5)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  shadowTexture = new CanvasTexture(canvas)
  return shadowTexture
}

const heading = new Quaternion()
const away = new Vector3()
/**
 * A soft shadow on the ground under a figure: a disc that slides away from the sun (and fades as the sun gets low or sets).
 * It is a child of `model` (so it follows its place and scale) and measured in model units (a figure is 1.7 tall).
 */
export function contactShadow(model: Group, radius = 0.62): Mesh {
  const material = new MeshBasicMaterial({ color: '#000000', map: softDisc(), transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
  const disc = new Mesh(new CircleGeometry(radius, 24), material)
  disc.rotation.x = -Math.PI / 2
  disc.matrixAutoUpdate = false
  disc.renderOrder = 1
  const flat = new Matrix4()
  disc.onBeforeRender = () => {
    const sun = SUN.value
    heading.copy(model.quaternion).invert()
    // the horizontal part of the direction of the sun, in the frame of the model: the shadow falls the other way
    away.set(sun.x, 0, sun.z).applyQuaternion(heading)
    const low = 1 - Math.min(1, Math.max(0, sun.y * 2.2))
    const stretch = 1 + 0.7 * low
    flat.makeTranslation(-away.x * 0.22, 0.012, -away.z * 0.22)
    disc.matrix.copy(flat).multiply(new Matrix4().makeRotationX(-Math.PI / 2)).multiply(new Matrix4().makeScale(1, stretch, 1))
    disc.matrixWorld.multiplyMatrices(model.matrixWorld, disc.matrix)
    material.opacity = 0.45 * Math.min(1, Math.max(0, sun.y * 4))
  }
  model.add(disc)
  return disc
}

/** Time (ms) of one render of `root` alone, at the current size of the canvas, averaged over `n` renders (SwiftShader in the lab: only the ratio between looks means something). */
export function labBench(gl: { render(scene: Scene, camera: unknown): void; getContext(): WebGL2RenderingContext }, root: Group | null, camera: unknown, n = 20): number {
  const parent = root?.parent
  const scene = new Scene()
  if (root) scene.add(root)
  const context = gl.getContext()
  const pixel = new Uint8Array(4)
  const sync = () => context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel)
  gl.render(scene, camera)
  sync()
  const start = performance.now()
  for (let i = 0; i < n; i++) {
    root?.updateMatrixWorld(true)
    gl.render(scene, camera)
  }
  sync()
  const time = (performance.now() - start) / n
  if (root) parent?.add(root)
  return time
}
