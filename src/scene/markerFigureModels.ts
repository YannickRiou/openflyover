/**
 * 3D models of the figures that are not a bicycle (`markerModels.ts` has the cyclist and the registry): the walkers, the
 * runners, the skiers, the swimmer, the kayak, the horse, the paraglider, the motorbike, the car and the plane. Same rules
 * as the cyclist: primitives of `markerModelKit`, one flat colour, a dark outline, +Z forward, `pose(phase)` without memory.
 */
import { Group, Vector3 } from 'three'
import type { MarkerFigure } from './markerSettings'
import { ball, bar, begin, drum, ellipsoid, extrusion, inkBall, joint, limb, pane, rod, stroke, tyre } from './markerModelKit'
import type { Build, MarkerModel } from './markerModelKit'

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z)
const SIDES = [-1, 1] as const
/** Height of an ankle above the ground. */
const ANKLE = 0.05

/** What moves in a rider or a walker: the trunk, the head, the feet and the hands (model space). */
interface State {
  hip: Vector3
  shoulder: Vector3
  head: Vector3
  foot: [Vector3, Vector3]
  hand: [Vector3, Vector3]
  phase: number
}

type Rest = Pick<State, 'hip' | 'shoulder' | 'head'>
type Hat = 'helmet' | 'cap' | 'hat' | 'swim' | 'none'

interface Spec {
  hip: Vector3
  shoulder: Vector3
  head: Vector3
  hat: Hat
  legBend?: Vector3
  armBend?: (side: number) => Vector3
  /** Sets the targets of the feet and hands (and moves the trunk) for `phase`. */
  motion(phase: number, s: State, rest: Rest): void
  /** More parts that follow the figure; returns what moves them after each pose. */
  extras?(build: Build, s: State): ((s: State) => void) | void
}

/** A hat on the head: [half axes, offset from the head] of each part. */
const HATS: Record<Exclude<Hat, 'none'>, [Vector3, Vector3][]> = {
  helmet: [
    [v(0.115, 0.09, 0.147), v(0, 0.04, -0.02)],
    [v(0.075, 0.018, 0.075), v(0, 0.03, 0.13)],
  ],
  cap: [
    [v(0.1, 0.07, 0.115), v(0, 0.05, -0.005)],
    [v(0.07, 0.015, 0.08), v(0, 0.035, 0.115)],
  ],
  hat: [
    [v(0.1, 0.07, 0.1), v(0, 0.065, 0)],
    [v(0.21, 0.02, 0.21), v(0, 0.04, 0)],
  ],
  swim: [[v(0.095, 0.085, 0.105), v(0, 0.03, -0.01)]],
}

/** A figure on two legs: trunk, head, hat, two arms and two legs, plus what `spec.extras` adds. */
function createBiped(spec: Spec): MarkerModel {
  const build = begin()
  const rest: Rest = { hip: spec.hip.clone(), shoulder: spec.shoulder.clone(), head: spec.head.clone() }
  const s: State = { hip: rest.hip.clone(), shoulder: rest.shoulder.clone(), head: rest.head.clone(), foot: [v(), v()], hand: [v(), v()], phase: 0 }
  const legBend = spec.legBend ?? v(0, 0.1, 1)
  const armBend = spec.armBend ?? ((side: number) => v(0.5 * side, -0.8, -0.6))

  const torso = limb(build, 0.088, 0.108)
  const hipBall = ball(build, 0.088)
  const shoulders = rod(build, 0.062)
  const pelvis = rod(build, 0.07)
  const neck = rod(build, 0.045)
  const ends = [ball(build, 0.062), ball(build, 0.062), ball(build, 0.07), ball(build, 0.07)]
  const sockets = SIDES.map(() => ball(build, 0.07))
  const headBall = ball(build, 0.088)
  const hats = spec.hat === 'none' ? [] : HATS[spec.hat].map(([size, offset]) => ({ mesh: ellipsoid(build, size.x, size.y, size.z), offset }))

  const arms = SIDES.map((side) => ({ side, upper: limb(build, 0.052, 0.04), lower: limb(build, 0.04, 0.032), elbow: ball(build, 0.04), hand: ball(build, 0.038) }))
  const legs = SIDES.map((side) => ({ side, thigh: limb(build, 0.07, 0.052), shin: limb(build, 0.052, 0.038), knee: ball(build, 0.052), foot: ellipsoid(build, 0.05, 0.045, 0.09), sole: inkBall(build, 0.052, 0.012, 0.092) }))
  const goggles = spec.hat === 'helmet' || spec.hat === 'swim' ? inkBall(build, 0.082, 0.026, 0.03) : null
  const after = spec.extras?.(build, s)

  const a = v()
  const b = v()
  const root = v()
  const middle = v()
  const layout = () => {
    torso.link(s.hip, s.shoulder)
    hipBall.position.copy(s.hip)
    shoulders.link(a.set(-0.16, s.shoulder.y - 0.02, s.shoulder.z), b.set(0.16, s.shoulder.y - 0.02, s.shoulder.z))
    ends[0].position.copy(a)
    ends[1].position.copy(b)
    pelvis.link(a.set(-0.09, s.hip.y, s.hip.z), b.set(0.09, s.hip.y, s.hip.z))
    ends[2].position.copy(a)
    ends[3].position.copy(b)
    neck.link(a.set(0, s.shoulder.y, s.shoulder.z), s.head)
    headBall.position.copy(s.head)
    goggles?.position.copy(s.head).add(a.set(0, 0.014, 0.068))
    for (const { mesh, offset } of hats) mesh.position.copy(s.head).add(offset)
    arms.forEach(({ side, upper, lower, elbow, hand }, i) => {
      root.set(0.16 * side, s.shoulder.y - 0.02, s.shoulder.z)
      joint(root, s.hand[i], 0.28, 0.26, armBend(side), middle)
      upper.link(root, middle)
      lower.link(middle, s.hand[i])
      elbow.position.copy(middle)
      hand.position.copy(s.hand[i])
    })
    legs.forEach(({ side, thigh, shin, knee, foot, sole }, i) => {
      root.set(0.09 * side, s.hip.y, s.hip.z)
      sockets[i].position.copy(root)
      joint(root, s.foot[i], 0.43, 0.43, legBend, middle)
      thigh.link(root, middle)
      shin.link(middle, s.foot[i])
      knee.position.copy(middle)
      foot.position.copy(s.foot[i]).add(a.set(0, -0.005, 0.035))
      sole.position.copy(s.foot[i]).add(a.set(0, -0.043, 0.035))
    })
  }

  const model: MarkerModel = {
    root: build.root,
    pose(phase) {
      s.phase = phase
      s.hip.copy(rest.hip)
      s.shoulder.copy(rest.shoulder)
      s.head.copy(rest.head)
      spec.motion(phase, s, rest)
      layout()
      after?.(s)
    },
    setColor(r, g, bl) {
      build.fill.color.setRGB(r, g, bl)
    },
  }
  model.pose(0)
  return model
}

interface Gait {
  stride: number
  lift: number
  /** swing of the hands */
  swing: number
  /** how far the trunk leans forward */
  lean?: number
  bounce?: number
  /** how far under the shoulders the hands hang */
  armDrop: number
  /** how far in front of the shoulders the hands are held */
  handForward?: number
}

/** The motion of a walker or a runner: the feet follow the phase, the hands swing the other way. */
function gait(g: Gait): Spec['motion'] {
  return (phase, s, rest) => {
    const lean = g.lean ?? 0
    const up = (g.bounce ?? 0) * Math.cos(2 * phase)
    s.hip.y = rest.hip.y + up
    s.shoulder.y = rest.shoulder.y + up
    s.shoulder.z = rest.shoulder.z + lean
    s.head.y = rest.head.y + up
    s.head.z = rest.head.z + lean * 1.4
    SIDES.forEach((side, i) => {
      const angle = phase + (i === 0 ? Math.PI : 0)
      s.foot[i].set(0.1 * side, ANKLE + g.lift * Math.max(0, Math.cos(angle)), rest.hip.z + g.stride * Math.sin(angle))
      s.hand[i].set(0.2 * side, s.shoulder.y - g.armDrop, s.shoulder.z + (g.handForward ?? 0) - g.swing * Math.sin(angle))
    })
  }
}

const WALK = gait({ stride: 0.26, lift: 0.09, swing: 0.2, lean: 0.04, bounce: 0.012, armDrop: 0.5, handForward: 0 })
const RUN = gait({ stride: 0.4, lift: 0.28, swing: 0.32, lean: 0.12, bounce: 0.035, armDrop: 0.3, handForward: 0.12 })
const STAND = { hip: v(0, 0.84, 0), shoulder: v(0, 1.36, 0.02), head: v(0, 1.52, 0.04) }
const LEAN_RUN = { hip: v(0, 0.8, 0), shoulder: v(0, 1.31, 0.04), head: v(0, 1.47, 0.06) }

/** A pack on the back: an ellipsoid that follows the trunk. */
function pack(size: Vector3, along: number, behind: number) {
  return (build: Build, s: State) => {
    const mesh = ellipsoid(build, size.x, size.y, size.z)
    const place = (st: State) => mesh.position.lerpVectors(st.hip, st.shoulder, along).add(v(0, 0, -behind))
    place(s)
    return place
  }
}

function createHiker(): MarkerModel {
  return createBiped({ ...STAND, hat: 'hat', motion: WALK, extras: pack(v(0.14, 0.24, 0.1), 0.62, 0.17) })
}

function createMountaineer(): MarkerModel {
  return createBiped({
    ...STAND,
    hat: 'helmet',
    motion: gait({ stride: 0.2, lift: 0.1, swing: 0.1, lean: 0.07, bounce: 0.01, armDrop: 0.5 }),
    extras(build, s) {
      const place = pack(v(0.15, 0.26, 0.11), 0.6, 0.17)(build, s)
      // the ice axe: a shaft with a crossbar, in the right hand
      const shaft = rod(build, 0.018, true)
      const head = rod(build, 0.016, true)
      return (st) => {
        place(st)
        const hand = st.hand[1]
        shaft.link(v(hand.x, hand.y + 0.05, hand.z), v(hand.x, hand.y - 0.62, hand.z + 0.1))
        head.link(v(hand.x, hand.y + 0.06, hand.z - 0.1), v(hand.x, hand.y + 0.06, hand.z + 0.12))
      }
    },
  })
}

function createRunner(): MarkerModel {
  return createBiped({ ...LEAN_RUN, hat: 'none', motion: RUN })
}

function createTrailRunner(): MarkerModel {
  return createBiped({ ...LEAN_RUN, hat: 'cap', motion: RUN, extras: pack(v(0.13, 0.17, 0.07), 0.64, 0.12) })
}

/** A pair of skis under the feet, and poles from the hands to the ground. */
function skis(length: number, behind: number, poles: boolean) {
  return (build: Build): ((s: State) => void) => {
    const planks = SIDES.map(() => ({ plank: rod(build, 0.024, true), tip: ball(build, 0.024) }))
    const sticks = poles ? SIDES.map(() => ({ stick: rod(build, 0.014, true), basket: ball(build, 0.035) })) : []
    return (s) => {
      planks.forEach(({ plank, tip }, i) => {
        const f = s.foot[i]
        plank.link(v(f.x, f.y - 0.03, f.z - behind), v(f.x, f.y - 0.03, f.z + length - behind))
        tip.position.set(f.x, f.y - 0.03, f.z + length - behind)
      })
      sticks.forEach(({ stick, basket }, i) => {
        const h = s.hand[i]
        const ground = v(h.x + 0.04 * (i === 0 ? -1 : 1), 0.02, h.z - 0.55)
        stick.link(h, ground)
        basket.position.copy(ground)
      })
    }
  }
}

function createSkier(): MarkerModel {
  return createBiped({
    hip: v(0, 0.7, -0.04),
    shoulder: v(0, 1.12, 0.14),
    head: v(0, 1.28, 0.22),
    hat: 'helmet',
    armBend: (side) => v(0.8 * side, -0.4, -0.3),
    motion(phase, s, rest) {
      // a slow rock on the skis: the knees bend and stretch
      const rock = 0.035 * Math.sin(phase * 0.5)
      s.hip.y = rest.hip.y + rock
      s.shoulder.y = rest.shoulder.y + rock
      s.head.y = rest.head.y + rock
      SIDES.forEach((side, i) => {
        s.foot[i].set(0.11 * side, ANKLE, 0.02)
        s.hand[i].set(0.3 * side, 0.82, 0.52)
      })
    },
    extras: (build) => skis(1.7, 0.75, true)(build),
  })
}

function createSkiTourer(): MarkerModel {
  return createBiped({
    ...STAND,
    hat: 'cap',
    motion: gait({ stride: 0.2, lift: 0.02, swing: 0.18, lean: 0.05, bounce: 0.008, armDrop: 0.45, handForward: 0.2 }),
    extras(build, s) {
      const place = pack(v(0.14, 0.24, 0.1), 0.62, 0.17)(build, s)
      const on = skis(1.6, 0.7, true)(build)
      return (st) => {
        place(st)
        on(st)
      }
    },
  })
}
function createSwimmer(): MarkerModel {
  return createBiped({
    hip: v(0, 0.1, -0.38),
    shoulder: v(0, 0.12, 0.14),
    head: v(0, 0.17, 0.36),
    hat: 'swim',
    legBend: v(0, 1, -0.2),
    armBend: () => v(0.2, 1, 0),
    motion(phase, s) {
      SIDES.forEach((side, i) => {
        const a = phase + (i === 0 ? Math.PI : 0)
        // the kick: the feet beat up and down behind the body
        s.foot[i].set(0.07 * side, 0.1 + 0.09 * Math.sin(2 * a), -1.2)
        // the crawl: the hand reaches in front, pulls back under the body, comes back over the water
        const reach = Math.cos(a)
        s.hand[i].set(0.2 * side, 0.1 + (Math.sin(a) > 0 ? 0.26 * Math.sin(a) : 0.12 * Math.sin(a)), 0.3 + 0.32 * reach)
      })
    },
  })
}

function createKayaker(): MarkerModel {
  const paddleAt = (phase: number) => {
    const tilt = 0.4 * Math.sin(phase)
    return { tilt, centre: v(0, 0.66 + 0.04 * Math.cos(phase), 0.3), along: v(Math.cos(tilt), Math.sin(tilt), 0) }
  }
  return createBiped({
    hip: v(0, 0.3, -0.1),
    shoulder: v(0, 0.8, -0.05),
    head: v(0, 0.96, 0),
    hat: 'cap',
    legBend: v(0, 1, 0),
    motion(phase, s) {
      const { centre, along } = paddleAt(phase)
      SIDES.forEach((side, i) => {
        s.foot[i].set(0.12 * side, 0.2, 0.52)
        s.hand[i].copy(centre).addScaledVector(along, 0.3 * side)
      })
    },
    extras(build) {
      ellipsoid(build, 0.3, 0.17, 1.5, v(0, 0.13, 0.1))
      const shaft = rod(build, 0.018, true)
      const blades = SIDES.map(() => ellipsoid(build, 0.17, 0.07, 0.025))
      return (st) => {
        const { tilt, centre, along } = paddleAt(st.phase)
        shaft.link(centre.clone().addScaledVector(along, -1.05), centre.clone().addScaledVector(along, 1.05))
        blades.forEach((blade, i) => {
          blade.position.copy(centre).addScaledVector(along, 1.12 * (i === 0 ? -1 : 1))
          blade.rotation.z = tilt
        })
      }
    },
  })
}

function createRider(): MarkerModel {
  const reach = [v(-0.13, 0.82, 0.4), v(0.13, 0.82, 0.4), v(-0.13, 0.84, -0.42), v(0.13, 0.84, -0.42)]
  return createBiped({
    hip: v(0, 1.2, -0.04),
    shoulder: v(0, 1.64, 0.04),
    head: v(0, 1.8, 0.08),
    hat: 'helmet',
    motion(phase, s) {
      const bob = 0.015 * Math.cos(2 * phase)
      s.hip.y += bob
      s.shoulder.y += bob
      SIDES.forEach((side, i) => {
        s.foot[i].set(0.3 * side, 0.74, 0.04)
        s.hand[i].set(0.1 * side, 1.38, 0.46)
      })
    },
    extras(build) {
      // the horse: a barrel, a neck that rises from the chest, a head that points down, a tail
      ellipsoid(build, 0.19, 0.24, 0.6, v(0, 0.95, 0))
      ellipsoid(build, 0.17, 0.05, 0.2, v(0, 1.17, -0.04))
      limb(build, 0.12, 0.075).link(v(0, 1.04, 0.44), v(0, 1.52, 0.76))
      // the head points forward and down from the top of the neck
      limb(build, 0.08, 0.045).link(v(0, 1.54, 0.8), v(0, 1.3, 1.0))
      for (const side of SIDES) ellipsoid(build, 0.022, 0.06, 0.022, v(0.05 * side, 1.64, 0.76))
      limb(build, 0.05, 0.016).link(v(0, 1.12, -0.58), v(0, 0.72, -0.8))
      const limbs = reach.map((top, i) => ({ top, upper: limb(build, 0.075, 0.048), lower: limb(build, 0.048, 0.034), knee: ball(build, 0.048), hoof: ball(build, 0.04), offset: [0, 0.45, Math.PI, Math.PI + 0.45][i] }))
      const middle = v()
      const target = v()
      return (st) => {
        limbs.forEach(({ top, upper, lower, knee, hoof, offset }, i) => {
          const angle = st.phase + offset
          target.set(top.x, ANKLE + 0.12 * Math.max(0, Math.cos(angle)), top.z + 0.14 * Math.sin(angle))
          joint(top, target, 0.4, 0.4, v(0, 0, i < 2 ? 1 : -1), middle)
          upper.link(top, middle)
          lower.link(middle, target)
          knee.position.copy(middle)
          hoof.position.copy(target)
        })
      }
    },
  })
}

function createParaglider(): MarkerModel {
  return createBiped({
    hip: v(0, 0.45, 0),
    shoulder: v(0, 0.95, -0.12),
    head: v(0, 1.13, -0.08),
    hat: 'helmet',
    legBend: v(0, 1, 0.3),
    armBend: (side) => v(0.6 * side, 0, -0.5),
    motion(phase, s) {
      SIDES.forEach((side, i) => {
        s.foot[i].set(0.1 * side, 0.12, 0.5 + 0.04 * Math.sin(phase + i * Math.PI))
        s.hand[i].set(0.22 * side, 1.4, -0.02)
      })
    },
    extras(build) {
      ellipsoid(build, 0.17, 0.08, 0.22, v(0, 0.38, -0.02))
      // the wing: five slabs along an arc, seen from the front it is a shallow vault
      const wing: Vector3[] = []
      for (let k = -2; k <= 2; k++) {
        const slab = ellipsoid(build, 0.34, 0.05, 0.55, v(k * 0.62, 2.35 - 0.06 * k * k, 0.08))
        slab.rotation.z = -k * 0.12
        if (Math.abs(k) >= 1) wing.push(v(k * 0.62, 2.32 - 0.06 * k * k, 0.08))
      }
      for (const point of wing) stroke(build, 0.006, point, v(0.16 * Math.sign(point.x), 0.98, -0.12))
    },
  })
}

/** A two-wheeled machine: wheels, then what each machine adds. The returned model has no rider. */
function wheels(build: Build, radius: number, tube: number, z: number): void {
  for (const at of [-z, z]) tyre(build, radius - tube, tube).position.set(0, radius, at)
}

function createMotorbike(): MarkerModel {
  return createBiped({
    hip: v(0, 0.84, -0.24),
    shoulder: v(0, 1.28, 0.1),
    head: v(0, 1.43, 0.24),
    hat: 'helmet',
    legBend: v(0.2, 0.1, 1),
    armBend: (side) => v(0.8 * side, -0.6, -0.2),
    motion(phase, s) {
      const shake = 0.004 * Math.sin(phase * 9)
      s.hip.y += shake
      SIDES.forEach((side, i) => {
        s.foot[i].set(0.2 * side, 0.4, 0.02)
        s.hand[i].set(0.28 * side, 0.97, 0.38)
      })
    },
    extras(build) {
      wheels(build, 0.33, 0.045, 0.63)
      ellipsoid(build, 0.15, 0.17, 0.26, v(0, 0.42, 0))
      ellipsoid(build, 0.17, 0.12, 0.28, v(0, 0.76, 0.14))
      ellipsoid(build, 0.08, 0.08, 0.08, v(0, 0.86, 0.5))
      bar(build, 0.03, v(0, 0.33, 0.63), v(0, 0.88, 0.4))
      bar(build, 0.03, v(0, 0.4, -0.05), v(0, 0.33, -0.63))
      bar(build, 0.07, v(0, 0.76, -0.12), v(0, 0.74, -0.52))
      bar(build, 0.02, v(-0.3, 0.97, 0.38), v(0.3, 0.97, 0.38))
      bar(build, 0.035, v(0.14, 0.3, -0.1), v(0.16, 0.4, -0.66))
    },
  })
}

/** A car or a plane has no limbs: a model of its own, with a moving part or none. */
function plain(size: number, parts: (build: Build) => ((phase: number) => void) | void): MarkerModel {
  const build = begin()
  const move = parts(build)
  // the parts are drawn at the scale of a person; `size` brings a car or a plane to the size of a marker
  const holder = new Group()
  holder.add(...build.root.children)
  holder.scale.setScalar(size)
  build.root.add(holder)
  const model: MarkerModel = {
    root: build.root,
    pose(phase) {
      move?.(phase)
    },
    setColor(r, g, b) {
      build.fill.color.setRGB(r, g, b)
    },
  }
  model.pose(0)
  return model
}

function createCar(): MarkerModel {
  return plain(0.7, (build) => {
    // the side view of the body: a hood, a cabin, a trunk
    extrusion(build, [[-1.1, 0.22], [-1.1, 0.56], [-0.92, 0.64], [-0.55, 0.68], [-0.32, 1.02], [0.34, 1.02], [0.66, 0.7], [1.0, 0.64], [1.12, 0.52], [1.12, 0.22]], 0.9)
    for (const side of SIDES) {
      pane(build, [[-0.5, 0.72], [-0.31, 0.97], [0.3, 0.97], [0.55, 0.72]], 0.5, side)
      for (const z of [-0.72, 0.72]) {
        // the tyre in the dark, the rim in the colour of the car
        const x = 0.5 * side
        const tyre = drum(build, 0.28, 0.2, v(x, 0.28, z))
        tyre.material = build.ink
        tyre.clear()
        drum(build, 0.15, 0.22, v(x, 0.28, z))
      }
    }
  })
}

function createPlane(): MarkerModel {
  return plain(0.8, (build) => {
    ellipsoid(build, 0.2, 0.2, 0.95, v(0, 0.55, 0))
    ellipsoid(build, 1.25, 0.035, 0.2, v(0, 0.76, 0.14))
    ellipsoid(build, 0.5, 0.03, 0.13, v(0, 0.62, -0.84))
    ellipsoid(build, 0.03, 0.3, 0.14, v(0, 0.8, -0.86))
    ellipsoid(build, 0.1, 0.1, 0.12, v(0, 0.55, 0.98))
    for (const side of SIDES) pane(build, [[-0.12, 0.62], [0.02, 0.76], [0.3, 0.76], [0.42, 0.62]], 0.17, side)
    for (const side of SIDES) {
      bar(build, 0.012, v(0.45 * side, 0.76, 0.12), v(0.14 * side, 0.45, 0.12))
      bar(build, 0.014, v(0.15 * side, 0.4, 0.18), v(0.28 * side, 0.1, 0.18))
      drum(build, 0.09, 0.06, v(0.28 * side, 0.09, 0.18))
    }
    drum(build, 0.08, 0.05, v(0, 0.09, 0.7))
    bar(build, 0.014, v(0, 0.4, 0.7), v(0, 0.09, 0.7))
    const blade = rod(build, 0.028, true)
    const hub = v(0, 0.55, 1.1)
    return (phase) => {
      const a = phase * 3
      blade.link(v(0.5 * Math.cos(a), hub.y + 0.5 * Math.sin(a), hub.z), v(-0.5 * Math.cos(a), hub.y - 0.5 * Math.sin(a), hub.z))
    }
  })
}

/** The figures of this file and what builds each one. */
export const FIGURE_MODELS: Partial<Record<MarkerFigure, () => MarkerModel>> = {
  randonneur: createHiker,
  alpiniste: createMountaineer,
  coureur: createRunner,
  traileur: createTrailRunner,
  skieur: createSkier,
  'ski-rando': createSkiTourer,
  nageur: createSwimmer,
  kayak: createKayaker,
  cavalier: createRider,
  parapente: createParaglider,
  moto: createMotorbike,
  voiture: createCar,
  avion: createPlane,
}
