/**
 * Figurines of a rider on a vehicle (`markerGlbFigures.ts` for the vehicle alone): the vehicle is a glTF file, the rider the
 * « Adventurer » character (Quaternius, CC0) posed bone by bone on its saddle and handlebar, its legs following the
 * pedals with the phase. The flat figure stands in until both files are there, and if one never comes.
 */
import { BoxGeometry, Box3, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import type { Material, Object3D, SkinnedMesh } from 'three'
import type { Color, Texture } from 'three'
import { createVehicle } from './markerGlbFigures'
import type { Vehicle, VehicleSpec } from './markerGlbFigures'
import { createBoneAimer, createPainter, loadFile, outlineSkinned, pending } from './markerGlbKit'
import { joint, MODEL_HEIGHT } from './markerModelKit'
import type { MarkerModel } from './markerModelKit'
import { wakeScene } from './renderOnDemand'

type Source = Material & { color: Color; name: string; map?: Texture | null }

/** Bones the rider is posed with: from the pelvis to the head, each leg and each arm. */
const CHAINS = [
  ['Hips', 'Abdomen'], ['Abdomen', 'Torso'], ['Torso', 'Chest'], ['Chest', 'Neck'], ['Neck', 'Head'],
  ['UpperLegL', 'LowerLegL'], ['UpperLegR', 'LowerLegR'], ['UpperArmL', 'LowerArmL'], ['UpperArmR', 'LowerArmR'],
  ['LowerArmL', 'WristL'], ['LowerArmR', 'WristR'],
] as const
const ENDS = [['LowerLegL', 'UpperLegL'], ['LowerLegR', 'UpperLegR']] as const
/** The pelvis sits this high above the saddle, in model units. */
const PELVIS_UP = 0.1
/** Reach of a pedal from the bottom bracket. */
const CRANK = 0.17
/** Pedals are this far from the middle of the bike, and the feet this much above them. */
const PEDAL_SIDE = 0.11
const ANKLE_UP = 0.08

/** Where the rider sits on a bike, in the units of the bike's file (it faces -Z there). */
interface BikeAnchors {
  saddle: Vector3
  bottomBracket: Vector3
  /** the right grip of the handlebar (the left one mirrors it) */
  grip: Vector3
}

export interface BikeSpec {
  /** the bike alone */
  bike: Omit<VehicleSpec, 'stand'>
  anchors: BikeAnchors
  /** the trunk's lean forward over the saddle, degrees */
  lean: number
  /** the flat figure that stands in */
  stand: () => MarkerModel
}

/** A bike with its rider. */
export function createBikeRider({ bike: bikeSpec, anchors, lean, stand: standIn }: BikeSpec): MarkerModel {
  const stand = standIn()
  const root = new Group()
  root.add(stand.root)
  // the bike shows nothing of its own while it loads: the flat figure, rider included, does
  const noStand = (): MarkerModel => ({ root: new Group(), pose: () => undefined, setColor: () => undefined })
  const bike: Vehicle = createVehicle({ ...bikeSpec, stand: noStand })
  bike.root.visible = false
  root.add(bike.root)
  const painter = createPainter({ main: '', shade: 'Green', light: 'LightGreen' })
  let ready: { aimer: ReturnType<typeof createBoneAimer>; lengths: { upperLeg: number; lowerLeg: number; upperArm: number; lowerArm: number }; points: { bottomBracket: Vector3; gripR: Vector3; gripL: Vector3 } } | null = null

  const loaded = Promise.all([loadFile('models/adventurer.glb'), import('three/addons/utils/SkeletonUtils.js'), bike.loaded]).then(([{ scene }, { clone }]) => {
    const man = clone(scene) as Group
    const holder = new Group()
    holder.add(man)
    man.updateMatrixWorld(true)
    const box = new Box3().setFromObject(man, true)
    holder.scale.setScalar(MODEL_HEIGHT / box.getSize(new Vector3()).y)
    root.add(holder)
    root.updateMatrixWorld(true)
    const aimer = createBoneAimer(man, CHAINS, ENDS)
    const skinned: SkinnedMesh[] = []
    man.traverse((node: Object3D) => {
      if (!(node as SkinnedMesh).isMesh) return
      const mesh = node as SkinnedMesh
      mesh.material = painter.flat(mesh.material as Source)
      mesh.frustumCulled = false
      // no backpack: the bags are on the bike
      if (mesh.parent?.name === 'Backpack') mesh.visible = false
      if (mesh.isSkinnedMesh) skinned.push(mesh)
    })
    outlineSkinned(root, skinned, painter)
    // measured at rest, in the units of the root
    const at = (name: string) => aimer.position(name).applyMatrix4(root.matrixWorld.clone().invert())
    const length = (a: string, b: string) => at(a).distanceTo(at(b))
    const lengths = {
      upperLeg: length('UpperLegL', 'LowerLegL'),
      lowerLeg: length('LowerLegL', 'FootL'),
      upperArm: length('UpperArmL', 'LowerArmL'),
      lowerArm: length('LowerArmL', 'WristL') + 0.05,
    }
    const saddle = bike.place(anchors.saddle)!
    const hips = at('Hips')
    holder.position.copy(saddle).add(new Vector3(0, PELVIS_UP, 0)).sub(hips)
    root.updateMatrixWorld(true)
    const gripA = bike.place(anchors.grip)!
    const gripB = bike.place(new Vector3(-anchors.grip.x, anchors.grip.y, anchors.grip.z))!
    // the left hand takes the grip on its side (the character's left is its +X)
    const [gripL, gripR] = gripA.x > gripB.x ? [gripA, gripB] : [gripB, gripA]
    ready = { aimer, lengths, points: { bottomBracket: bike.place(anchors.bottomBracket)!, gripL, gripR } }
    root.remove(stand.root)
    bike.root.visible = true
    painter.paint()
    wakeScene()
  })
  loaded.catch((error: unknown) => console.warn('[marqueur] vélo 3D indisponible, figurine plate gardée :', error))
  pending.add(loaded)

  const up = new Vector3()
  const hip = new Vector3()
  const ankle = new Vector3()
  const kneeAt = new Vector3()
  const shoulder = new Vector3()
  const elbow = new Vector3()
  const bend = new Vector3()
  const dir = new Vector3()
  const world = new Vector3()
  const inverse = new Matrix4()
  type Aimer = ReturnType<typeof createBoneAimer>
  const aimLocal = (aimer: Aimer, name: string, direction: Vector3) => aimer.aim(name, dir.copy(direction).transformDirection(root.matrixWorld))
  const local = (aimer: Aimer, name: string, out: Vector3) => out.copy(aimer.position(name)).applyMatrix4(inverse)

  const posture = (phase: number) => {
    if (!ready) return
    const { aimer, lengths, points } = ready
    root.updateWorldMatrix(true, true)
    inverse.copy(root.matrixWorld).invert()
    // the trunk leans forward over the handlebar, a little more curved at the shoulders
    const rad = (deg: number) => (deg * Math.PI) / 180
    const spine = (deg: number) => up.set(0, Math.cos(rad(deg)), Math.sin(rad(deg)))
    aimLocal(aimer, 'Hips', spine(lean + 8))
    aimLocal(aimer, 'Abdomen', spine(lean + 3))
    aimLocal(aimer, 'Torso', spine(lean - 2))
    aimLocal(aimer, 'Chest', spine(lean - 6))
    aimLocal(aimer, 'Neck', up.set(0, 1, 0.5))
    for (const [side, grip, sx] of [['L', points.gripL, 1], ['R', points.gripR, -1]] as const) {
      local(aimer, `UpperArm${side}`, shoulder)
      joint(shoulder, grip, lengths.upperArm, lengths.lowerArm, bend.set(sx * 0.6, -1, -0.2), elbow)
      aimLocal(aimer, `UpperArm${side}`, up.copy(elbow).sub(shoulder))
      aimLocal(aimer, `LowerArm${side}`, up.copy(grip).sub(elbow))
      // the legs: the two pedals are opposite
      const a = phase + (side === 'L' ? 0 : Math.PI)
      local(aimer, `UpperLeg${side}`, hip)
      ankle.set(points.bottomBracket.x + sx * PEDAL_SIDE, points.bottomBracket.y + CRANK * Math.sin(a) + ANKLE_UP, points.bottomBracket.z + CRANK * Math.cos(a))
      joint(hip, ankle, lengths.upperLeg, lengths.lowerLeg, bend.set(sx * 0.15, 0.1, 1), kneeAt)
      aimLocal(aimer, `UpperLeg${side}`, up.copy(kneeAt).sub(hip))
      aimLocal(aimer, `LowerLeg${side}`, up.copy(ankle).sub(kneeAt))
      // the foot goes with the ankle (its own bone, not a child of the shin)
      const foot = aimer.bone(`Foot${side}`)
      foot.parent!.updateWorldMatrix(true, false)
      foot.position.copy(foot.parent!.worldToLocal(world.copy(ankle).applyMatrix4(root.matrixWorld)))
      foot.updateWorldMatrix(false, true)
    }
  }

  return {
    root,
    pose(phase) {
      stand.pose(phase)
      bike.pose(phase)
      posture(phase)
    },
    setColor(r, g, b) {
      stand.setColor(r, g, b)
      bike.setColor(r, g, b)
      painter.setTrack(r, g, b)
      painter.paint()
    },
    setLight(r, g, b) {
      bike.setLight?.(r, g, b)
      painter.setLight(r, g, b)
      painter.paint()
    },
  }
}

/** A box added in code to a model, with its colour. */
export function addBox(model: Group, name: string, color: string, size: [number, number, number], at: [number, number, number], along?: Vector3): void {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ color, name }))
  mesh.name = name
  mesh.position.set(...at)
  if (along) mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), along.clone().normalize())
  model.add(mesh)
}

/** A cylinder across the bike (along X) added in code. */
export function addRoll(model: Group, name: string, color: string, radius: number, length: number, at: [number, number, number]): void {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 14), new MeshBasicMaterial({ color, name }))
  mesh.name = name
  mesh.rotation.z = Math.PI / 2
  mesh.position.set(...at)
  model.add(mesh)
}

/** « SquareFrameBicycle » (Quaternius, CC0): the frame in the colour of the track, the wheels and saddle dark; it faces -Z in its file. */
const ROAD_BIKE: Omit<VehicleSpec, 'stand'> = {
  file: 'models/bicycle.glb',
  main: 'Material.001',
  length: 1.8,
  yaw: Math.PI,
  spin: [{ match: /Wheel/, axis: 'y', turns: 2.5 }],
  colors: { 'Material.002': '#2b2d30', 'Material.003': '#1f2022' },
}
const ANCHORS: BikeAnchors = { saddle: new Vector3(0, 1.85, 1.25), bottomBracket: new Vector3(0, 0.15, 0.75), grip: new Vector3(0.7, 2.12, -1.15) }
const FRAME_FRONT = new Vector3(0, 1.15, -1.05)

export const roadBike = (stand: () => MarkerModel): MarkerModel => createBikeRider({ bike: ROAD_BIKE, anchors: ANCHORS, lean: 38, stand })

/** « Bicycle » (same pack), a rounder frame on fat tyres, the trunk more upright. */
export const mountainBike = (stand: () => MarkerModel): MarkerModel =>
  createBikeRider({
    bike: { ...ROAD_BIKE, file: 'models/bicycle-round.glb', main: 'Bike', spin: [{ match: /Wheel/, axis: 'y', turns: 2.5, thick: 2.4 }], colors: { Wheel: '#2b2d30', 'Material.003': '#1f2022' } },
    anchors: ANCHORS,
    lean: 28,
    stand,
  })

/** The road bike with a battery along the down tube. */
export const electricBike = (stand: () => MarkerModel): MarkerModel =>
  createBikeRider({
    bike: {
      ...ROAD_BIKE,
      extras(model) {
        const tube = FRAME_FRONT.clone().sub(ANCHORS.bottomBracket)
        const at = ANCHORS.bottomBracket.clone().addScaledVector(tube, 0.48)
        addBox(model, 'Battery', '#59616a', [0.34, 0.3, 1.3], [at.x, at.y, at.z], tube)
      },
    },
    anchors: ANCHORS,
    lean: 34,
    stand,
  })

/** The road bike with a saddle bag, a frame bag and a roll on the handlebar. */
export const bikepackingBike = (stand: () => MarkerModel): MarkerModel =>
  createBikeRider({
    bike: {
      ...ROAD_BIKE,
      extras(model) {
        addBox(model, 'BagSaddle', '#6b5a43', [0.5, 0.5, 1.0], [0, 1.55, 2.05])
        addBox(model, 'BagFrame', '#4c5a44', [0.24, 0.8, 1.1], [0, 0.95, 0.2])
        addRoll(model, 'BagRoll', '#6b5a43', 0.22, 1.5, [0, 2.3, -1.6])
      },
    },
    anchors: ANCHORS,
    lean: 34,
    stand,
  })
