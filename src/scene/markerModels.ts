/**
 * 3D models of the « figurine » markers (`MarkerSettings.model3d`): small figures built from three.js primitives, drawn
 * flat in one colour with a dark outline (a back-face shell, like a cel-shaded cartoon), no texture and no file. A model
 * stands on its track point, faces +Z (the marker turns it along the track); `pose` moves its limbs for a phase of the
 * walk or the pedalling (`figureStride`), with no memory between calls, so any frame of the film renders the same in
 * isolation. `hasMarkerModel` says which figures have a model; the others keep their pictogram.
 */
import { Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import type { MarkerFigure } from './markerSettings'
import { MODEL_HEIGHT, UP, ball, begin, inkBall, joint, limb, rod, tyre } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { FIGURE_MODELS } from './markerFigureModels'

export { MODEL_HEIGHT, joint }
export type { MarkerModel }

const FORWARD = new Vector3(0, 0, 1)

/** The rider and the bike seen from behind and the side: a road or mountain bike with its rider crouched on it. */
export function createCyclist(options: { bags?: boolean; battery?: boolean; fat?: boolean } = {}): MarkerModel {
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
    tyre(build, wheelRadius - 0.03, options.fat ? 0.04 : 0.027).position.set(0, wheelRadius, z)
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

  if (options.bags) {
    // bikepacking: a saddle bag and a roll on the handlebar
    ball(build, 0.1, new Vector3(0, 0.84, -0.5)).scale.set(0.95, 0.9, 1.9)
    ball(build, 0.075, new Vector3(0, 0.98, 0.5)).scale.set(2, 1, 1.1)
  }
  if (options.battery) ball(build, 0.06, new Vector3(0, 0.52, 0.2)).scale.set(0.9, 2.2, 0.9)

  // the rider: hips on the saddle, back leaning forward, head up
  const hip = new Vector3(0, 0.95, -0.2)
  const shoulder = new Vector3(0, 1.36, 0.06)
  const head = new Vector3(0, 1.55, 0.16)
  limb(build, 0.088, 0.108).link(hip, shoulder)
  ball(build, 0.088, hip)
  // shoulders and pelvis: a bar across, so that the arms and legs are fixed to the trunk
  const shoulderBar = 0.17
  frame(0.062, new Vector3(-shoulderBar, shoulder.y - 0.02, shoulder.z), new Vector3(shoulderBar, shoulder.y - 0.02, shoulder.z))
  frame(0.07, new Vector3(-0.09, hip.y, hip.z), new Vector3(0.09, hip.y, hip.z))
  // neck
  frame(0.045, new Vector3(0, shoulder.y, shoulder.z), new Vector3(0, 1.5, 0.14))
  // the head, and over it a helmet: a long dome with a short peak
  ball(build, 0.088, head)
  inkBall(build, 0.082, 0.026, 0.03, new Vector3(head.x, head.y + 0.014, head.z + 0.068))
  const helmet = ball(build, 0.115, new Vector3(head.x, head.y + 0.04, head.z - 0.02))
  helmet.scale.set(1, 0.78, 1.28)
  const peak = ball(build, 0.08, new Vector3(head.x, head.y + 0.03, head.z + 0.13))
  peak.scale.set(1.15, 0.22, 1)

  const sides = [-1, 1] as const
  const arms = sides.map((side) => {
    const upper = limb(build, 0.052, 0.04)
    const lower = limb(build, 0.04, 0.032)
    const elbow = ball(build, 0.04)
    const hand = ball(build, 0.038, new Vector3(0.2 * side, 0.93, 0.45))
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
    thigh: limb(build, 0.07, 0.052),
    shin: limb(build, 0.052, 0.038),
    knee: ball(build, 0.052),
    foot: ball(build, 0.05),
  }))
  ball(build, 0.07, new Vector3(-0.09, hip.y, hip.z))
  ball(build, 0.07, new Vector3(0.09, hip.y, hip.z))
  inkBall(build, 0.045, 0.028, 0.13, new Vector3(0, 0.9, -0.17))
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

/** The figures that have a 3D model, and what builds it. */
const BUILDERS: Partial<Record<MarkerFigure, () => MarkerModel>> = {
  cycliste: createCyclist,
  vtt: () => createCyclist({ fat: true }),
  vae: () => createCyclist({ battery: true }),
  bikepacking: () => createCyclist({ bags: true }),
  ...FIGURE_MODELS,
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
