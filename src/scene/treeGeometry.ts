/**
 * The two tree shapes of the forests (scene/ForestLayer.tsx), as unit geometries: base at y = 0, height 1, crown radius
 * 1 (the instance matrix scales them to a real tree: height × `TREE_WIDTH_RATIO` wide). Few triangles on purpose: tens
 * of thousands are drawn at once. Colours are vertex colours (trunk and foliage); the instance colour only varies them.
 *
 * Pure (three is used for its primitives and their merge).
 */
import { BufferAttribute, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TreeKind } from './forestPoints'

/** Crown radius of a tree as a share of its height. */
export const TREE_WIDTH_RATIO: Readonly<Record<TreeKind, number>> = { conifer: 0.26, broadleaf: 0.32 }

const TRUNK = new Color('#5a4636')
const CONIFER_FOLIAGE = new Color('#2c4a30')
const BROADLEAF_FOLIAGE = new Color('#4a6e35')

/** `geometry` moved up to `y`, flat (non-indexed, positions and normals only) and painted `color`. */
function part(geometry: BufferGeometry, y: number, color: Color, scaleY = 1): BufferGeometry {
  geometry.scale(1, scaleY, 1)
  geometry.translate(0, y, 0)
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const colors = new Float32Array(flat.getAttribute('position').count * 3)
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i)
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  return flat
}

const trunk = (height: number) => part(new CylinderGeometry(0.06, 0.08, height, 5, 1, true), height / 2, TRUNK)
const cone = (radius: number, height: number, base: number) =>
  part(new ConeGeometry(radius, height, 8, 1, true), base + height / 2, CONIFER_FOLIAGE)

/** Conifer: a short trunk under two stacked cones (26 triangles). Broadleaf: a trunk under a flattened blob (30). */
export function createTreeGeometries(): Record<TreeKind, BufferGeometry> {
  return {
    conifer: mergeGeometries([trunk(0.25), cone(1, 0.62, 0.12), cone(0.65, 0.5, 0.5)])!,
    broadleaf: mergeGeometries([trunk(0.4), part(new IcosahedronGeometry(1, 0), 0.66, BROADLEAF_FOLIAGE, 0.4)])!,
  }
}
