/**
 * 3D models of the « figurine » markers (`MarkerSettings.model3d`): small figures built from three.js primitives, drawn
 * flat in one colour with a dark outline (a back-face shell, like a cel-shaded cartoon), no texture and no file. A model
 * stands on its track point, faces +Z (the marker turns it along the track) and is about `MODEL_HEIGHT` tall; `pose`
 * moves its limbs for a phase of the walk or the pedalling (`figureStride`), with no memory between calls, so any frame
 * of the film renders the same in isolation. `markerModelOf` says which figures have a model; the others keep their
 * pictogram.
 */
import { BackSide, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import type { MarkerFigure } from './markerSettings'

/** Height of a model in its own units (the rider on the bike, head included). */
export const MODEL_HEIGHT = 1.7
/** Thickness of the outline, in model units. */
const OUTLINE = 0.015
/** Dark of the outline, as the ink of the badges (`BADGE_INK`). */
const OUTLINE_COLOR = '#1C2A33'

/** A model: its group, the call that poses it, and the call that colours it. */
export interface MarkerModel {
  root: Group
  /** Pose for `phase` (radians: a full turn of the pedals); the phase stands still while the marker does (`figureStride`). */
  pose(phase: number): void
  /** Colour of the flat fill, already scaled by the exposure and the light of the scene. */
  setColor(r: number, g: number, b: number): void
}

const UP = new Vector3(0, 1, 0)
const SEGMENT_SEGMENTS = 18

interface Build {
  root: Group
  fill: MeshBasicMaterial
  outline: MeshBasicMaterial
}

function begin(): Build {
  return {
    root: new Group(),
    fill: new MeshBasicMaterial({ color: '#ffffff' }),
    outline: new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide }),
  }
}

/** A mesh with its outline shell as a child, so the outline follows the mesh's scale and pose. */
function solid(build: Build, geometry: BufferGeometry, shell: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, build.fill)
  mesh.add(new Mesh(shell, build.outline))
  build.root.add(mesh)
  return mesh
}

/** A sphere of `radius` at `at` (a head, a joint, a hand). */
function ball(build: Build, radius: number, at: Vector3 = new Vector3()): Mesh {
  const mesh = solid(build, new SphereGeometry(radius, 20, 14), new SphereGeometry(radius + OUTLINE, 20, 14))
  mesh.position.copy(at)
  return mesh
}

/** A rod of `radius` between two points, set again with `link`. Its outline is a wider rod: the joints at its ends cover the rest. */
interface Rod {
  mesh: Mesh
  link(a: Vector3, b: Vector3): void
}

const direction = new Vector3()
const middle = new Vector3()
const turn = new Quaternion()

function rod(build: Build, radius: number): Rod {
  const mesh = solid(
    build,
    new CylinderGeometry(radius, radius, 1, SEGMENT_SEGMENTS, 1),
    new CylinderGeometry(radius + OUTLINE, radius + OUTLINE, 1, SEGMENT_SEGMENTS, 1),
  )
  return {
    mesh,
    link(a, b) {
      direction.subVectors(b, a)
      const length = direction.length()
      middle.addVectors(a, b).multiplyScalar(0.5)
      mesh.position.copy(middle)
      if (length > 1e-6) mesh.quaternion.copy(turn.setFromUnitVectors(UP, direction.divideScalar(length)))
      // the length is the rod's own; the radius stays what it was built with
      mesh.scale.set(1, Math.max(length, 1e-4), 1)
    },
  }
}

/** A ring in the YZ plane (a wheel). */
function ring(build: Build, radius: number, tube: number): Mesh {
  const mesh = solid(build, new TorusGeometry(radius, tube, 10, 48), new TorusGeometry(radius, tube + OUTLINE, 10, 48))
  mesh.rotation.y = Math.PI / 2
  return mesh
}

const along = new Vector3()
const pole = new Vector3()
const knee = new Vector3()

/**
 * The middle joint (knee, elbow) of a limb of two bones `upper` and `lower` long from `root` to `end`, bent towards
 * `bend` (a direction the joint is pushed to). A reach too long is stretched straight, one too short is folded.
 */
export function joint(root: Vector3, end: Vector3, upper: number, lower: number, bend: Vector3, target = knee): Vector3 {
  along.subVectors(end, root)
  const reach = Math.min(Math.max(along.length(), Math.abs(upper - lower) + 1e-3), upper + lower - 1e-3)
  along.normalize()
  // distance along the line to the foot of the joint's height, and that height
  const a = (upper * upper - lower * lower + reach * reach) / (2 * reach)
  const h = Math.sqrt(Math.max(0, upper * upper - a * a))
  // the part of `bend` across the line gives the side the joint goes to
  pole.copy(bend).addScaledVector(along, -bend.dot(along))
  if (pole.lengthSq() < 1e-9) pole.set(1, 0, 0).addScaledVector(along, -along.x)
  pole.normalize()
  return target.copy(root).addScaledVector(along, a).addScaledVector(pole, h)
}

const FORWARD = new Vector3(0, 0, 1)

/** The rider and the bike seen from behind and the side: a road or mountain bike with its rider crouched on it. */
export function createCyclist(): MarkerModel {
  const build = begin()
  const wheelRadius = 0.34
  const bottomBracket = new Vector3(0, 0.3, 0)
  const rearAxle = new Vector3(0, wheelRadius, -0.55)
  const frontAxle = new Vector3(0, wheelRadius, 0.56)
  const seat = new Vector3(0, 0.86, -0.17)
  const headLow = new Vector3(0, 0.62, 0.4)
  const headTop = new Vector3(0, 0.86, 0.43)
  const stem = new Vector3(0, 0.92, 0.45)

  for (const z of [rearAxle.z, frontAxle.z]) {
    const wheel = ring(build, wheelRadius - 0.025, 0.022)
    wheel.position.set(0, wheelRadius, z)
  }
  // a ball at each end hides the seam where two bars meet
  const frame = (radius: number, a: Vector3, b: Vector3) => {
    rod(build, radius).link(a, b)
    ball(build, radius, a)
    ball(build, radius, b)
  }
  frame(0.016, bottomBracket, seat)
  frame(0.016, seat, new Vector3(0, 0.8, 0.41))
  frame(0.018, bottomBracket, headLow)
  frame(0.018, headLow, headTop)
  frame(0.013, bottomBracket, rearAxle)
  frame(0.012, seat, rearAxle)
  frame(0.014, headTop, frontAxle)
  frame(0.014, new Vector3(-0.21, 0.93, 0.45), new Vector3(0.21, 0.93, 0.45))
  frame(0.014, headTop, stem)

  // the rider: hips on the saddle, back leaning forward, head up
  const hip = new Vector3(0, 0.95, -0.2)
  const shoulder = new Vector3(0, 1.36, 0.06)
  const head = new Vector3(0, 1.55, 0.16)
  rod(build, 0.095).link(hip, shoulder)
  ball(build, 0.095, hip)
  // shoulders and pelvis: a bar across, so that the arms and legs are fixed to the trunk
  const shoulderBar = 0.17
  frame(0.062, new Vector3(-shoulderBar, shoulder.y - 0.02, shoulder.z), new Vector3(shoulderBar, shoulder.y - 0.02, shoulder.z))
  frame(0.07, new Vector3(-0.09, hip.y, hip.z), new Vector3(0.09, hip.y, hip.z))
  // neck
  frame(0.045, new Vector3(0, shoulder.y, shoulder.z), new Vector3(0, 1.5, 0.14))
  // the head, and over it a helmet: a long dome with a short peak
  ball(build, 0.088, head)
  const helmet = ball(build, 0.115, new Vector3(head.x, head.y + 0.04, head.z - 0.02))
  helmet.scale.set(1, 0.78, 1.28)
  const peak = ball(build, 0.08, new Vector3(head.x, head.y + 0.03, head.z + 0.13))
  peak.scale.set(1.15, 0.22, 1)

  const sides = [-1, 1] as const
  const arms = sides.map((side) => {
    const upper = rod(build, 0.04)
    const lower = rod(build, 0.035)
    const elbow = ball(build, 0.042)
    const hand = ball(build, 0.042, new Vector3(0.2 * side, 0.93, 0.45))
    return { side, upper, lower, elbow, hand }
  })
  const armJoint = new Vector3()
  const armBend = new Vector3()
  const armRoot = new Vector3()
  for (const { side, upper, lower, elbow, hand } of arms) {
    armRoot.set(shoulderBar * side, shoulder.y - 0.02, shoulder.z)
    joint(armRoot, hand.position, 0.28, 0.28, armBend.set(0.7 * side, -0.9, -0.4), armJoint)
    upper.link(armRoot, armJoint)
    lower.link(armJoint, hand.position)
    elbow.position.copy(armJoint)
  }

  const legs = sides.map((side) => ({
    side,
    thigh: rod(build, 0.062),
    shin: rod(build, 0.048),
    knee: ball(build, 0.058),
    foot: ball(build, 0.05),
  }))
  const legRoot = new Vector3()
  const legFoot = new Vector3()
  const legJoint = new Vector3()
  const legBend = new Vector3(0, 0.15, 1)
  const crank = 0.17

  const model: MarkerModel = {
    root: build.root,
    pose(phase) {
      for (const { side, thigh, shin, knee: kneeBall, foot } of legs) {
        // the two pedals are opposite
        const angle = phase + (side < 0 ? Math.PI : 0)
        legFoot.set(0.1 * side, bottomBracket.y + crank * Math.sin(angle), bottomBracket.z + crank * Math.cos(angle))
        legRoot.set(0.09 * side, hip.y, hip.z)
        joint(legRoot, legFoot, 0.43, 0.43, legBend, legJoint)
        thigh.link(legRoot, legJoint)
        shin.link(legJoint, legFoot)
        kneeBall.position.copy(legJoint)
        foot.position.copy(legFoot)
      }
    },
    setColor(r, g, b) {
      build.fill.color.setRGB(r, g, b)
    },
  }
  model.pose(0)
  return model
}

/** The figures that have a 3D model, and what builds it. The bikes share the cyclist until each has its own. */
const BUILDERS: Partial<Record<MarkerFigure, () => MarkerModel>> = {
  cycliste: createCyclist,
  vtt: createCyclist,
  vae: createCyclist,
  bikepacking: createCyclist,
}

/** True when `figure` has a 3D model. */
export function hasMarkerModel(figure: MarkerFigure): boolean {
  return BUILDERS[figure] !== undefined
}

/** A new model of `figure`, null when it has none. */
export function createMarkerModel(figure: MarkerFigure): MarkerModel | null {
  return BUILDERS[figure]?.() ?? null
}

/** Release what a model holds on the graphics card. */
export function disposeMarkerModel(model: MarkerModel): void {
  const geometries = new Set<BufferGeometry>()
  model.root.traverse((node) => {
    if (node instanceof Mesh) geometries.add(node.geometry)
  })
  geometries.forEach((g) => g.dispose())
  const materials = new Set<MeshBasicMaterial>()
  model.root.traverse((node) => {
    if (node instanceof Mesh) materials.add(node.material as MeshBasicMaterial)
  })
  materials.forEach((m) => m.dispose())
}

const heading = new Matrix4()
const origin = new Vector3()
const backwards = new Vector3()

/**
 * Stand `model` at `position`, facing `ahead` (a world direction along the track, its slope tilting the model), scaled so
 * that it is `worldHeight` tall. Its up stays the scene's up: it never rolls over on a bend.
 */
export function standModel(model: MarkerModel, position: Vector3, ahead: Vector3, worldHeight: number): void {
  const { root } = model
  root.position.copy(position)
  // +Z of the model towards `ahead` (a lookAt matrix points -Z at its target: aim it the other way)
  backwards.copy(ahead).negate()
  if (backwards.lengthSq() < 1e-12) backwards.copy(FORWARD).negate()
  heading.lookAt(origin, backwards, UP)
  root.quaternion.setFromRotationMatrix(heading)
  root.scale.setScalar(worldHeight / MODEL_HEIGHT)
  root.updateMatrixWorld(true)
}
