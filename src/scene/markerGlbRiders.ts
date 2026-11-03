/**
 * Figurines of a rider on a vehicle (`markerGlbFigures.ts` for the vehicle alone): the vehicle is a glTF file, the rider the
 * « Adventurer » character (Quaternius, CC0) posed bone by bone on its saddle and handlebar, its legs following the
 * pedals with the phase. The flat figure stands in until both files are there, and if one never comes.
 */
import { BoxGeometry, Box3, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three'
import type { Material, Object3D, SkinnedMesh } from 'three'
import type { Color, Texture } from 'three'
import { createVehicle } from './markerGlbFigures'
import type { Vehicle, VehicleSpec } from './markerGlbFigures'
import { createBoneAimer, createPainter, loadFile, outlineRigid, outlineSkinned, pending } from './markerGlbKit'
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

/** What a figure's pose function can set: where each hand and each ankle goes, and how the trunk leans. */
export interface Rig {
  /** the pelvis goes to `point` (the units of the figure) */
  seat(point: Vector3): void
  /** the trunk leans forward by `degrees` from the vertical, a little more curved at the shoulders */
  spine(degrees: number): void
  /** the neck looks along `direction` */
  neck(direction: Vector3): void
  /** the arm on `side` ('L' is the character's left, +X) reaches `hand`, the elbow pushed towards `bend` */
  arm(side: 'L' | 'R', hand: Vector3, bend: Vector3): void
  /** where the head is (the base of the skull), in the units of the figure */
  head(out: Vector3): Vector3
  /** the leg on `side` reaches `ankle`, the knee pushed towards `bend`; the foot goes with the ankle */
  leg(side: 'L' | 'R', ankle: Vector3, bend: Vector3): void
}

/** Parts added in code to a figure, coloured and outlined like the rest, that move with the pose. */
export interface Parts {
  /** a box of `size`, centred on its origin, in the colour of the material `name` */
  box(name: string, color: string, size: [number, number, number]): Mesh
  /** a ball of `radius`, centred on its origin */
  ball(name: string, color: string, radius: number): Mesh
  /** a thin cylinder that `link` stretches from one point to another */
  rod(name: string, color: string, radius: number): { mesh: Mesh; link(from: Vector3, to: Vector3): void }
}

export interface FigureSpec {
  /** the flat figure that stands in while the files load, and if one never does */
  stand: () => MarkerModel
  /** material in the colour of the track (the hull, the skis); the rider's jacket is a darker shade of it */
  main: string
  /** a glTF vehicle under the rider, if any */
  vehicle?: Omit<VehicleSpec, 'stand'>
  /** meshes of the character left out, by the name of their group (the bags are on the bike) */
  hide?: string[]
  /** once everything is loaded: the pose of each frame, from the phase */
  setup(context: { rig: Rig; vehicle: Vehicle | null; parts: Parts }): (phase: number) => void
}

const AXIS_Y = new Vector3(0, 1, 0)

/** A rider, the « Adventurer » (Quaternius, CC0), posed bone by bone, on a vehicle or with props. */
export function createFigure({ stand: standIn, main, vehicle: vehicleSpec, hide = [], setup }: FigureSpec): MarkerModel {
  const stand = standIn()
  const root = new Group()
  root.add(stand.root)
  // the vehicle shows nothing of its own while it loads: the flat figure, rider included, does
  const noStand = (): MarkerModel => ({ root: new Group(), pose: () => undefined, setColor: () => undefined })
  const vehicle: Vehicle | null = vehicleSpec ? createVehicle({ ...vehicleSpec, stand: noStand }) : null
  if (vehicle) {
    vehicle.root.visible = false
    root.add(vehicle.root)
  }
  const painter = createPainter({ main, shade: 'Green', light: 'LightGreen' })
  let posture: ((phase: number) => void) | null = null

  const loaded = Promise.all([loadFile('models/adventurer.glb'), import('three/addons/utils/SkeletonUtils.js'), vehicle?.loaded]).then(([{ scene }, { clone }]) => {
    const man = clone(scene) as Group
    const holder = new Group()
    holder.add(man)
    man.updateMatrixWorld(true)
    holder.scale.setScalar(MODEL_HEIGHT / new Box3().setFromObject(man, true).getSize(new Vector3()).y)
    root.add(holder)
    root.updateMatrixWorld(true)
    const aimer = createBoneAimer(man, CHAINS, ENDS)
    const skinned: SkinnedMesh[] = []
    man.traverse((node: Object3D) => {
      if (!(node as SkinnedMesh).isMesh) return
      const mesh = node as SkinnedMesh
      mesh.material = painter.flat(mesh.material as Source)
      mesh.frustumCulled = false
      if (hide.includes(mesh.parent?.name ?? '')) mesh.visible = false
      if (mesh.isSkinnedMesh) skinned.push(mesh)
    })
    outlineSkinned(root, skinned, painter)

    // measured at rest, in the units of the root
    const inverse = new Matrix4()
    const world = new Vector3()
    const dir = new Vector3()
    const local = (name: string, out: Vector3) => out.copy(aimer.position(name)).applyMatrix4(inverse)
    inverse.copy(root.matrixWorld).invert()
    const reach = (a: string, b: string) => local(a, new Vector3()).distanceTo(local(b, new Vector3()))
    const lengths = { upperLeg: reach('UpperLegL', 'LowerLegL'), lowerLeg: reach('LowerLegL', 'FootL'), upperArm: reach('UpperArmL', 'LowerArmL'), lowerArm: reach('LowerArmL', 'WristL') + 0.05 }
    const aim = (name: string, direction: Vector3) => aimer.aim(name, dir.copy(direction).transformDirection(root.matrixWorld))
    const up = new Vector3()
    const hip = new Vector3()
    const knee = new Vector3()
    const shoulder = new Vector3()
    const elbow = new Vector3()
    const rig: Rig = {
      seat(point) {
        root.updateWorldMatrix(true, true)
        inverse.copy(root.matrixWorld).invert()
        holder.position.add(up.copy(point).sub(local('Hips', world)))
        holder.updateMatrixWorld(true)
      },
      spine(degrees) {
        const lean = (deg: number) => up.set(0, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180))
        aim('Hips', lean(degrees + 8))
        aim('Abdomen', lean(degrees + 3))
        aim('Torso', lean(degrees - 2))
        aim('Chest', lean(degrees - 6))
      },
      neck: (direction) => aim('Neck', direction),
      head: (out) => local('Head', out),
      arm(side, hand, bend) {
        local(`UpperArm${side}`, shoulder)
        joint(shoulder, hand, lengths.upperArm, lengths.lowerArm, bend, elbow)
        aim(`UpperArm${side}`, up.copy(elbow).sub(shoulder))
        aim(`LowerArm${side}`, up.copy(hand).sub(elbow))
      },
      leg(side, ankle, bend) {
        local(`UpperLeg${side}`, hip)
        joint(hip, ankle, lengths.upperLeg, lengths.lowerLeg, bend, knee)
        aim(`UpperLeg${side}`, up.copy(knee).sub(hip))
        aim(`LowerLeg${side}`, up.copy(ankle).sub(knee))
        // the foot goes with the ankle (its own bone, not a child of the shin)
        const foot = aimer.bone(`Foot${side}`)
        foot.parent!.updateWorldMatrix(true, false)
        foot.position.copy(foot.parent!.worldToLocal(world.copy(ankle).applyMatrix4(root.matrixWorld)))
        foot.updateWorldMatrix(false, true)
      },
    }
    const parts: Parts = {
      box(name, color, size) {
        const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ color, name }))
        mesh.material = painter.flat(mesh.material as Source)
        root.add(mesh)
        outlineRigid(root, [mesh], painter)
        return mesh
      },
      ball(name, color, radius) {
        const mesh = new Mesh(new SphereGeometry(radius, 16, 12), new MeshBasicMaterial({ color, name }))
        mesh.material = painter.flat(mesh.material as Source)
        root.add(mesh)
        outlineRigid(root, [mesh], painter)
        return mesh
      },
      rod(name, color, radius) {
        // one unit long along Y, stretched by `link`
        const mesh = new Mesh(new CylinderGeometry(radius, radius, 1, 10).translate(0, 0.5, 0), new MeshBasicMaterial({ color, name }))
        mesh.material = painter.flat(mesh.material as Source)
        root.add(mesh)
        outlineRigid(root, [mesh], painter)
        const along = new Vector3()
        return {
          mesh,
          link(from, to) {
            along.subVectors(to, from)
            mesh.position.copy(from)
            mesh.scale.set(1, Math.max(along.length(), 1e-4), 1)
            mesh.quaternion.setFromUnitVectors(AXIS_Y, along.normalize())
          },
        }
      },
    }
    posture = setup({ rig, vehicle, parts })
    root.remove(stand.root)
    if (vehicle) vehicle.root.visible = true
    painter.paint()
    wakeScene()
  })
  loaded.catch((error: unknown) => console.warn('[marqueur] modèle 3D indisponible, figurine plate gardée :', error))
  pending.add(loaded)

  return {
    root,
    pose(phase) {
      stand.pose(phase)
      vehicle?.pose(phase)
      if (posture) {
        // the matrices of the frame, before the bones are turned
        root.updateWorldMatrix(true, true)
        posture(phase)
      }
    },
    setColor(r, g, b) {
      stand.setColor(r, g, b)
      vehicle?.setColor(r, g, b)
      painter.setTrack(r, g, b)
      painter.paint()
    },
    setLight(r, g, b) {
      vehicle?.setLight?.(r, g, b)
      painter.setLight(r, g, b)
      painter.paint()
    },
  }
}

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

/** A bike with its rider: the legs follow the pedals, the hands hold the handlebar. */
export function createBikeRider({ bike, anchors, lean, stand }: BikeSpec): MarkerModel {
  return createFigure({
    stand,
    main: bike.main,
    vehicle: bike,
    hide: ['Backpack'],
    setup({ rig, vehicle }) {
      const bb = vehicle!.place(anchors.bottomBracket)!
      const gripA = vehicle!.place(anchors.grip)!
      const gripB = vehicle!.place(new Vector3(-anchors.grip.x, anchors.grip.y, anchors.grip.z))!
      // the left hand takes the grip on its side (the character's left is its +X)
      const [gripL, gripR] = gripA.x > gripB.x ? [gripA, gripB] : [gripB, gripA]
      rig.seat(vehicle!.place(anchors.saddle)!.add(new Vector3(0, PELVIS_UP, 0)))
      const ankle = new Vector3()
      const bendArm = new Vector3()
      const bendLeg = new Vector3()
      const forward = new Vector3(0, 1, 0.5)
      return (phase) => {
        rig.spine(lean)
        rig.neck(forward)
        for (const [side, grip, sx] of [['L', gripL, 1], ['R', gripR, -1]] as const) {
          rig.arm(side, grip, bendArm.set(sx * 0.6, -1, -0.2))
          // the two pedals are opposite
          const a = phase + (side === 'L' ? 0 : Math.PI)
          ankle.set(bb.x + sx * PEDAL_SIDE, bb.y + CRANK * Math.sin(a) + ANKLE_UP, bb.z + CRANK * Math.cos(a))
          rig.leg(side, ankle, bendLeg.set(sx * 0.15, 0.1, 1))
        }
      }
    },
  })
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

const SIDES = [['L', 1], ['R', -1]] as const
/** Height of the ankle above the ground or the snow, as for the flat figures. */
const ANKLE = 0.05
const BLACK = '#2b2d30'

/** The kayaker: « Canoe » (Kenney, CC0) with a double paddle, the trunk upright, the legs stretched forward; the paddle rocks with the phase. */
export const kayaker = (stand: () => MarkerModel): MarkerModel =>
  createFigure({
    stand,
    main: 'wood',
    vehicle: { file: 'models/canoe.glb', main: 'wood', length: 3, yaw: 0, colors: { leafsFall: '#3a3f45' } },
    hide: ['Backpack'],
    setup({ rig, parts }) {
      const shaft = parts.rod('Paddle', BLACK, 0.02)
      const blades = SIDES.map(() => parts.box('Paddle', BLACK, [0.36, 0.16, 0.05]))
      rig.seat(new Vector3(0, 0.34, -0.1))
      const centre = new Vector3()
      const along = new Vector3()
      const point = new Vector3()
      const hand = new Vector3()
      const ankle = new Vector3()
      const knee = new Vector3(0, 1, 0)
      const bend = new Vector3()
      const look = new Vector3(0, 1, 0.1)
      return (phase) => {
        const tilt = 0.4 * Math.sin(phase)
        centre.set(0, 0.66 + 0.04 * Math.cos(phase), 0.3)
        along.set(Math.cos(tilt), Math.sin(tilt), 0)
        rig.spine(6)
        rig.neck(look)
        for (const [side, sx] of SIDES) {
          rig.leg(side, ankle.set(0.12 * sx, 0.2, 0.52), knee)
          rig.arm(side, hand.copy(centre).addScaledVector(along, 0.3 * sx), bend.set(sx * 0.6, -1, 0))
        }
        shaft.link(point.copy(centre).addScaledVector(along, -1.05), hand.copy(centre).addScaledVector(along, 1.05))
        blades.forEach((blade, i) => {
          blade.position.copy(centre).addScaledVector(along, i === 0 ? 1.12 : -1.12)
          blade.rotation.z = tilt
        })
      }
    },
  })

/** The two skis under the feet, and the two poles from the hands to the snow. */
function skiGear(parts: Parts, length: number, behind: number) {
  const skis = SIDES.map(() => parts.box('Ski', '#ffffff', [0.1, 0.04, length]))
  const poles = SIDES.map(() => parts.rod('Pole', BLACK, 0.018))
  const ground = new Vector3()
  return {
    /** the ski on side `i` under the foot at `foot`, the pole in the hand at `hand` */
    place(i: number, foot: Vector3, hand: Vector3) {
      skis[i].position.set(foot.x, foot.y - 0.03, foot.z + length / 2 - behind)
      poles[i].link(hand, ground.set(hand.x + 0.04 * SIDES[i][1], 0.02, hand.z - 0.55))
    },
  }
}

/** The downhill skier: the knees bend and stretch on the skis, the trunk leans forward, the poles point back. */
export const skier = (stand: () => MarkerModel): MarkerModel =>
  createFigure({
    stand,
    main: 'Ski',
    hide: ['Backpack'],
    setup({ rig, parts }) {
      const gear = skiGear(parts, 1.7, 0.75)
      const hip = new Vector3()
      const ankle = new Vector3()
      const hand = new Vector3()
      const knee = new Vector3(0, 0.2, 1)
      const bend = new Vector3()
      const look = new Vector3(0, 1, 0.3)
      return (phase) => {
        // a slow rock on the skis: the knees bend and stretch
        rig.seat(hip.set(0, 0.7 + 0.035 * Math.sin(phase * 0.5), -0.04))
        rig.spine(23)
        rig.neck(look)
        SIDES.forEach(([side, sx], i) => {
          rig.leg(side, ankle.set(0.11 * sx, ANKLE, 0.02), knee)
          rig.arm(side, hand.set(0.3 * sx, 0.82, 0.52), bend.set(sx * 0.8, -0.4, -0.3))
          gear.place(i, ankle, hand)
        })
      }
    },
  })

/** The ski tourer: a walker on skis, its backpack on its back, the feet sliding with the stride. */
export const skiTourer = (stand: () => MarkerModel): MarkerModel =>
  createFigure({
    stand,
    main: 'Ski',
    setup({ rig, parts }) {
      const gear = skiGear(parts, 1.6, 0.7)
      const hip = new Vector3()
      const ankle = new Vector3()
      const hand = new Vector3()
      const knee = new Vector3(0, 0.1, 1)
      const bend = new Vector3()
      const look = new Vector3(0, 1, 0.2)
      return (phase) => {
        rig.seat(hip.set(0, 0.84 + 0.008 * Math.cos(2 * phase), 0))
        rig.spine(5)
        rig.neck(look)
        SIDES.forEach(([side, sx], i) => {
          const angle = phase + (i === 0 ? Math.PI : 0)
          rig.leg(side, ankle.set(0.1 * sx, ANKLE + 0.02 * Math.max(0, Math.cos(angle)), 0.2 * Math.sin(angle)), knee)
          rig.arm(side, hand.set(0.2 * sx, 0.91, 0.07 + 0.2 - 0.18 * Math.sin(angle)), bend.set(sx * 0.6, -1, -0.2))
          gear.place(i, ankle, hand)
        })
      }
    },
  })

/** The swimmer: the character lies in the water and does the crawl, its feet beating behind it, its cap in the colour of the track. */
export const swimmer = (stand: () => MarkerModel): MarkerModel =>
  createFigure({
    stand,
    main: 'Cap',
    hide: ['Backpack'],
    setup({ rig, parts }) {
      const cap = parts.ball('Cap', '#ffffff', 0.12)
      cap.scale.set(1, 0.9, 1.1)
      const head = new Vector3()
      const hip = new Vector3(0, 0.1, -0.38)
      const ankle = new Vector3()
      const hand = new Vector3()
      const kneeBend = new Vector3(0, 1, -0.2)
      const elbowBend = new Vector3(0.2, 1, 0)
      const look = new Vector3(0, 0.25, 1)
      return (phase) => {
        rig.seat(hip)
        rig.spine(90)
        rig.neck(look)
        for (const [side, sx] of SIDES) {
          const a = phase + (side === 'L' ? Math.PI : 0)
          // the kick: the feet beat up and down behind the body
          rig.leg(side, ankle.set(0.07 * sx, 0.1 + 0.09 * Math.sin(2 * a), -1.2), kneeBend)
          // the crawl: the hand reaches in front, pulls back under the body, comes back over the water
          const reach = Math.cos(a)
          rig.arm(side, hand.set(0.2 * sx, 0.1 + (Math.sin(a) > 0 ? 0.26 * Math.sin(a) : 0.12 * Math.sin(a)), 0.3 + 0.32 * reach), elbowBend)
        }
        cap.position.copy(rig.head(head)).add(look.clone().multiplyScalar(0.1))
      }
    },
  })

/** The mountaineer: a walker with a helmet in the colour of the track, an ice axe in its right hand, its backpack on its back. */
export const mountaineer = (stand: () => MarkerModel): MarkerModel =>
  createFigure({
    stand,
    main: 'Helmet',
    setup({ rig, parts }) {
      const helmet = parts.ball('Helmet', '#ffffff', 0.13)
      helmet.scale.set(1, 0.85, 1.05)
      const shaft = parts.rod('IceAxe', BLACK, 0.02)
      const crossbar = parts.box('IceAxe', BLACK, [0.28, 0.04, 0.04])
      const head = new Vector3()
      const hip = new Vector3()
      const ankle = new Vector3()
      const hand = new Vector3()
      const tip = new Vector3()
      const knee = new Vector3(0, 0.1, 1)
      const bend = new Vector3()
      const look = new Vector3(0, 1, 0.2)
      const offset = new Vector3()
      return (phase) => {
        const bounce = 0.01 * Math.cos(2 * phase)
        rig.seat(hip.set(0, 0.84 + bounce, 0))
        rig.spine(7)
        rig.neck(look)
        for (const [side, sx] of SIDES) {
          const angle = phase + (side === 'L' ? Math.PI : 0)
          rig.leg(side, ankle.set(0.1 * sx, ANKLE + 0.1 * Math.max(0, Math.cos(angle)), 0.2 * Math.sin(angle)), knee)
          rig.arm(side, hand.set(0.2 * sx, 1.36 + bounce - 0.5, 0.09 - 0.1 * Math.sin(angle)), bend.set(sx * 0.6, -1, -0.2))
          if (side === 'R') {
            // the ice axe held by the head, its spike on the ground in front
            tip.set(hand.x, 0.04, hand.z + 0.1)
            shaft.link(hand, tip)
            crossbar.position.copy(hand).add(offset.set(0, 0.03, 0))
          }
        }
        helmet.position.copy(rig.head(head)).add(offset.set(0, 0.1, 0.01))
      }
    },
  })
