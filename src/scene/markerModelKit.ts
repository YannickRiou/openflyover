/**
 * Parts for the 3D models of the « figurine » markers (`MarkerSettings.model3d`): small figures built from three.js primitives, drawn
 * flat in one colour with a dark outline (a back-face shell, like a cel-shaded cartoon), no texture and no file. A model
 * stands on its track point, faces +Z (the marker turns it along the track) and is about `MODEL_HEIGHT` tall; `pose`
 * moves its limbs for a phase of the walk or the pedalling (`figureStride`), with no memory between calls, so any frame
 * of the film renders the same in isolation. `markerModelOf` says which figures have a model; the others keep their
 * pictogram.
 */
import { BackSide, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'

/** Height of a model in its own units (the rider on the bike, head included). */
export const MODEL_HEIGHT = 1.7
/** Thickness of the outline, in model units. */
export const OUTLINE = 0.015
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

export const UP = new Vector3(0, 1, 0)
const SEGMENT_SEGMENTS = 18

export interface Build {
  root: Group
  fill: MeshBasicMaterial
  outline: MeshBasicMaterial
}

export function begin(): Build {
  return {
    root: new Group(),
    fill: new MeshBasicMaterial({ color: '#ffffff' }),
    outline: new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide }),
  }
}

/** A mesh with its outline shell as a child, so the outline follows the mesh's scale and pose. */
export function solid(build: Build, geometry: BufferGeometry, shell: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, build.fill)
  mesh.add(new Mesh(shell, build.outline))
  build.root.add(mesh)
  return mesh
}

/** A sphere of `radius` at `at` (a head, a joint, a hand). */
export function ball(build: Build, radius: number, at: Vector3 = new Vector3()): Mesh {
  const mesh = solid(build, new SphereGeometry(radius, 20, 14), new SphereGeometry(radius + OUTLINE, 20, 14))
  mesh.position.copy(at)
  return mesh
}

/** A rod of `radius` between two points, set again with `link`. Its outline is a wider rod: the joints at its ends cover the rest. */
export interface Rod {
  mesh: Mesh
  link(a: Vector3, b: Vector3): void
}

const direction = new Vector3()
const middle = new Vector3()
const turn = new Quaternion()

export function rod(build: Build, radius: number): Rod {
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
export function ring(build: Build, radius: number, tube: number): Mesh {
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


/** A box of `size` (x, y, z) centred on `at`, with its outline. */
export function block(build: Build, size: Vector3, at: Vector3 = new Vector3()): Mesh {
  const grown = size.clone().addScalar(OUTLINE * 2)
  const mesh = solid(build, new BoxGeometry(size.x, size.y, size.z), new BoxGeometry(grown.x, grown.y, grown.z))
  mesh.position.copy(at)
  return mesh
}

/** A cylinder of `radius` and `length` lying along X (a car wheel), with its outline. */
export function drum(build: Build, radius: number, length: number, at: Vector3): Mesh {
  const mesh = solid(
    build,
    new CylinderGeometry(radius, radius, length, 24, 1),
    new CylinderGeometry(radius + OUTLINE, radius + OUTLINE, length + OUTLINE * 2, 24, 1),
  )
  mesh.rotation.z = Math.PI / 2
  mesh.position.copy(at)
  return mesh
}

/** An ellipsoid with half-axes `rx`, `ry`, `rz` centred on `at`; the outline keeps its thickness on every axis (a scaled mesh would not). */
export function ellipsoid(build: Build, rx: number, ry: number, rz: number, at: Vector3 = new Vector3()): Mesh {
  const mesh = solid(
    build,
    new SphereGeometry(1, 22, 14).scale(rx, ry, rz),
    new SphereGeometry(1, 22, 14).scale(rx + OUTLINE, ry + OUTLINE, rz + OUTLINE),
  )
  mesh.position.copy(at)
  return mesh
}

/** A bar of `radius` between `a` and `b`, rounded at both ends. */
export function bar(build: Build, radius: number, a: Vector3, b: Vector3): void {
  rod(build, radius).link(a, b)
  ball(build, radius, a)
  ball(build, radius, b)
}
