/**
 * Parts for the 3D models of the « figurine » markers (`MarkerSettings.model3d`): small figures built from three.js primitives, drawn
 * flat in one colour with a dark outline (a back-face shell, like a cel-shaded cartoon), no texture and no file. A model
 * stands on its track point, faces +Z (the marker turns it along the track) and is about `MODEL_HEIGHT` tall; `pose`
 * moves its limbs for a phase of the walk or the pedalling (`figureStride`), with no memory between calls, so any frame
 * of the film renders the same in isolation. `markerModelOf` says which figures have a model; the others keep their
 * pictogram.
 */
import { BackSide, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Shape, ShapeGeometry, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** Height of a model in its own units (the rider on the bike, head included). */
export const MODEL_HEIGHT = 1.7
/** Thickness of the outline, in model units. */
export const OUTLINE = 0.022
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
  /** the dark of the outline, as a flat colour of its own (windows, tyres, lines) */
  ink: MeshBasicMaterial
}

export function begin(): Build {
  return {
    root: new Group(),
    fill: new MeshBasicMaterial({ color: '#ffffff' }),
    outline: new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide }),
    ink: new MeshBasicMaterial({ color: OUTLINE_COLOR }),
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

export function rod(build: Build, radius: number, capped = false): Rod {
  // open at both ends unless `capped`: a flat end would stick out of a bend and show as a line across the joint, the balls at the ends close the rod
  const mesh = solid(
    build,
    new CylinderGeometry(radius, radius, 1, SEGMENT_SEGMENTS, 1, !capped),
    new CylinderGeometry(radius + OUTLINE, radius + OUTLINE, 1, SEGMENT_SEGMENTS, 1, !capped),
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

/** A thin dark line between `a` and `b` (a rope, a ski pole): no fill and no outline, so it stays fine. */
export function stroke(build: Build, radius: number, a: Vector3, b: Vector3): void {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, 1, 6, 1), build.ink)
  direction.subVectors(b, a)
  const length = direction.length()
  mesh.position.addVectors(a, b).multiplyScalar(0.5)
  mesh.quaternion.copy(turn.setFromUnitVectors(UP, direction.divideScalar(Math.max(length, 1e-6))))
  mesh.scale.set(1, Math.max(length, 1e-4), 1)
  build.root.add(mesh)
}

/** A flat dark shape (a window) in the plane facing `side` (+1: towards +X, -1: towards -X), `x` away from the axis; points are (z, y). */
export function pane(build: Build, points: [number, number][], x: number, side: 1 | -1): Mesh {
  const shape = new Shape()
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)))
  const mesh = new Mesh(new ShapeGeometry(shape), build.ink)
  // the shape's x becomes the model's z, so that its front faces `side`
  mesh.rotation.y = side * (Math.PI / 2)
  mesh.position.x = x * side
  build.root.add(mesh)
  return mesh
}

/** A solid whose side view is the polygon `profile` (z, y), `width` across, with rounded edges and an outline of even thickness. */
export function extrusion(build: Build, profile: [number, number][], width: number, round = 0.03): Mesh {
  const shape = new Shape()
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)))
  const geometry = new ExtrudeGeometry(shape, { depth: width - round * 2, bevelEnabled: true, bevelSize: round, bevelThickness: round, bevelSegments: 3, curveSegments: 4 })
  // the profile's x is the model's z, the extrusion goes along -X; centre it on the axis
  geometry.rotateY(-Math.PI / 2)
  geometry.translate(width / 2 - round, 0, 0)
  // one smooth outline: the vertices are welded and pushed out along their averaged normals
  const bare = geometry.clone()
  bare.deleteAttribute('normal')
  bare.deleteAttribute('uv')
  const welded = mergeVertices(bare, 1e-4)
  welded.computeVertexNormals()
  const position = welded.getAttribute('position')
  const normal = welded.getAttribute('normal')
  for (let i = 0; i < position.count; i++) position.setXYZ(i, position.getX(i) + normal.getX(i) * OUTLINE, position.getY(i) + normal.getY(i) * OUTLINE, position.getZ(i) + normal.getZ(i) * OUTLINE)
  return solid(build, geometry, welded)
}

/** A limb that narrows from `radiusA` at the first point of `link` to `radiusB` at the second; its outline narrows with it. */
export function limb(build: Build, radiusA: number, radiusB: number): Rod {
  const mesh = solid(
    build,
    new CylinderGeometry(radiusB, radiusA, 1, SEGMENT_SEGMENTS, 1, true),
    new CylinderGeometry(radiusB + OUTLINE, radiusA + OUTLINE, 1, SEGMENT_SEGMENTS, 1, true),
  )
  // a ball at each end closes the outline where the limb stops, and rounds the joints where two limbs meet
  const ends = [ball(build, radiusA), ball(build, radiusB)]
  return {
    mesh,
    link(a, b) {
      direction.subVectors(b, a)
      const length = direction.length()
      mesh.position.addVectors(a, b).multiplyScalar(0.5)
      if (length > 1e-6) mesh.quaternion.copy(turn.setFromUnitVectors(UP, direction.divideScalar(length)))
      mesh.scale.set(1, Math.max(length, 1e-4), 1)
      ends[0].position.copy(a)
      ends[1].position.copy(b)
    },
  }
}

/** A flat dark ellipsoid (a visor, a saddle, a sole): no fill and no outline. */
export function inkBall(build: Build, rx: number, ry: number, rz: number, at: Vector3 = new Vector3()): Mesh {
  const mesh = new Mesh(new SphereGeometry(1, 18, 12).scale(rx, ry, rz), build.ink)
  mesh.position.copy(at)
  build.root.add(mesh)
  return mesh
}

/** A tyre: a dark ring of `radius` and `tube` in the YZ plane, with a rim in the colour of the figure inside it. */
export function tyre(build: Build, radius: number, tube: number): Group {
  const dark = new Mesh(new TorusGeometry(radius, tube, 10, 48), build.ink)
  dark.rotation.y = Math.PI / 2
  build.root.add(dark)
  const rim = ring(build, radius - tube * 1.5, tube * 0.38)
  const group = new Group()
  group.add(dark, rim)
  build.root.add(group)
  return group
}
