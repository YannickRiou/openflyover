import { describe, expect, it } from 'vitest'
import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Ray,
  Vector3,
} from 'three'
import {
  FULL_SHADOW_AIM_M,
  MIN_SHADOW_DISTANCE_M,
  NEAR_SHADOW_DISTANCE_M,
  NORMAL_BIAS_TEXELS,
  SHADOW_DISTANCE_PER_HEIGHT,
  TerrainShadow,
  fitShadowFrustum,
  groundDistance,
  lastShadowPass,
  mayShadowView,
  shadowDistance,
  type ShadowFit,
} from './terrainShadow'

const MAP_SIZE = 1024
/** 40 km of terrain between 1000 m and 4000 m, centred on the origin */
const TERRAIN = new Box3(new Vector3(-20_000, 1000, -20_000), new Vector3(20_000, 4000, 20_000))

function viewCamera(position: Vector3, lookAt: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1.5, 1, 5e6)
  camera.position.copy(position)
  camera.lookAt(lookAt)
  camera.updateMatrixWorld()
  return camera
}

/** World → light view matrix of a sun shining from `towardsSun` (looking down -Z, like three's shadow camera). */
function lightView(towardsSun: Vector3): Matrix4 {
  const camera = new OrthographicCamera()
  camera.position.copy(towardsSun).normalize()
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera.matrixWorldInverse
}

function fit(camera: PerspectiveCamera, towardsSun: Vector3, maxDistance = 1e7, box = TERRAIN): ShadowFit | null {
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  )
  const forward = camera.getWorldDirection(new Vector3())
  return fitShadowFrustum(frustum, camera.position, forward, maxDistance, box, lightView(towardsSun), MAP_SIZE)
}

/** Light-space AABB of a box's corners. */
function lightSpaceBounds(box: Box3, towardsSun: Vector3) {
  const view = lightView(towardsSun)
  const out = new Box3()
  for (let c = 0; c < 8; c++) {
    const { min, max } = box
    out.expandByPoint(new Vector3(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z).applyMatrix4(view))
  }
  return out
}

const HIGH_SUN = new Vector3(0.3, 1, 0.2)
const LOW_SUN = new Vector3(-1, 0.03, 0.2) // ~1.7° above the western horizon

describe('shadowDistance', () => {
  it('never goes below the minimum, then grows with the camera height above the terrain', () => {
    expect(shadowDistance(1500, 1000)).toBe(MIN_SHADOW_DISTANCE_M)
    expect(shadowDistance(41_000, 1000)).toBe(SHADOW_DISTANCE_PER_HEIGHT * 40_000)
  })

  it('is the far distance, unchanged, from a camera that looks at ground 2 km away or farther, or at none', () => {
    for (const aim of [FULL_SHADOW_AIM_M, 3000, 12_000, Infinity]) expect(shadowDistance(1500, 1000, aim)).toBe(MIN_SHADOW_DISTANCE_M)
    // an overview camera is 40 km or more from the ground it looks at
    for (const aim of [40_000, 60_000, Infinity]) expect(shadowDistance(41_000, 1000, aim)).toBe(SHADOW_DISTANCE_PER_HEIGHT * 40_000)
  })

  it('falls with the square of the distance to the ground looked at, down to a floor', () => {
    expect(shadowDistance(2000, 0, 1000)).toBeCloseTo(MIN_SHADOW_DISTANCE_M / 4)
    expect(shadowDistance(2000, 0, 700)).toBeCloseTo(MIN_SHADOW_DISTANCE_M * 0.35 ** 2)
    expect(shadowDistance(2000, 0, 300)).toBe(NEAR_SHADOW_DISTANCE_M)
    expect(shadowDistance(2000, 0, 0)).toBe(NEAR_SHADOW_DISTANCE_M)
    // never farther than a far camera's
    expect(shadowDistance(2000, 0, 1900)).toBeLessThanOrEqual(MIN_SHADOW_DISTANCE_M)
  })
})

describe('groundDistance', () => {
  const flat = () => 0
  const ahead = (pitchDeg: number) => new Vector3(0, -Math.sin((pitchDeg * Math.PI) / 180), -Math.cos((pitchDeg * Math.PI) / 180))

  it('finds the ground along the axis within one step (8 %)', () => {
    const d = groundDistance(new Vector3(0, 500, 0), ahead(30), flat, 5000)
    expect(d).toBeGreaterThanOrEqual(1000)
    expect(d).toBeLessThan(1000 * 1.09)
  })

  it('is the same for the same view, and Infinity for the sky, the unknown or ground beyond the limit', () => {
    const eye = new Vector3(0, 500, 0)
    expect(groundDistance(eye, ahead(30), flat, 5000)).toBe(groundDistance(eye, ahead(30), flat, 5000))
    expect(groundDistance(eye, ahead(-10), flat, 5000)).toBe(Infinity)
    expect(groundDistance(eye, ahead(30), () => undefined, 5000)).toBe(Infinity)
    expect(groundDistance(eye, ahead(5), flat, 2000)).toBe(Infinity)
  })

  it('follows a rising slope: ground met sooner than on the flat', () => {
    const slope = (p: Vector3) => -p.z * 0.3
    expect(groundDistance(new Vector3(0, 500, 0), ahead(10), slope, 5000)).toBeLessThan(groundDistance(new Vector3(0, 500, 0), ahead(10), flat, 5000))
  })
})

describe('fitShadowFrustum', () => {
  it('covers the whole terrain when the camera sees all of it, snapped and padded', () => {
    const camera = viewCamera(new Vector3(0, 120_000, 1), new Vector3(0, 0, 0))
    const result = fit(camera, HIGH_SUN)!
    const expected = lightSpaceBounds(TERRAIN, HIGH_SUN)
    expect(result.left).toBeLessThanOrEqual(expected.min.x)
    expect(result.right).toBeGreaterThanOrEqual(expected.max.x)
    expect(result.bottom).toBeLessThanOrEqual(expected.min.y)
    expect(result.top).toBeGreaterThanOrEqual(expected.max.y)
    // quantised up by at most one 2^(1/8) step plus the padding
    expect(result.right - result.left).toBeLessThan((expected.max.x - expected.min.x) * 1.1 + 4 * result.texelSize)
    // the light view looks down -Z: the box lies between near and far
    expect(result.near).toBeLessThanOrEqual(-expected.max.z)
    expect(result.far).toBeGreaterThanOrEqual(-expected.min.z)
    // whole texels
    const texelX = (result.right - result.left) / MAP_SIZE
    expect(Math.abs(result.left / texelX - Math.round(result.left / texelX))).toBeLessThan(1e-6)
  })

  it('shrinks to the part of the terrain in view, cut at maxDistance', () => {
    // low camera at the south edge looking north, as in the flyover chase
    const camera = viewCamera(new Vector3(0, 3000, 19_000), new Vector3(0, 1500, 15_000))
    const full = fit(camera, HIGH_SUN)!
    const near = fit(camera, HIGH_SUN, 8000)!
    const all = lightSpaceBounds(TERRAIN, HIGH_SUN)
    expect(full.right - full.left).toBeLessThan(all.max.x - all.min.x)
    expect(near.right - near.left).toBeLessThan(full.right - full.left)
    expect(near.texelSize).toBeLessThan(full.texelSize)
    expect(near.texelSize).toBeLessThan(16_000 / MAP_SIZE)
  })

  it('gives a texel of about 1 m close to the ground and the far texel from a far camera, at the same map size', () => {
    const close = viewCamera(new Vector3(0, 1500, 19_000), new Vector3(0, 1000, 18_400))
    const farView = viewCamera(new Vector3(0, 3000, 19_000), new Vector3(0, 1500, 15_000))
    const closeFit = fit(close, HIGH_SUN, shadowDistance(1500, 1000, 700), new Box3(new Vector3(-20_000, 1000, -20_000), new Vector3(20_000, 4000, 20_000)))!
    const farFit = fit(farView, HIGH_SUN, shadowDistance(3000, 1000, 2500))!
    // 1024 texels here: 4096 on a desktop divides these by 4
    expect(closeFit.texelSize).toBeLessThan(farFit.texelSize / 4)
    expect(shadowDistance(3000, 1000, 2500)).toBe(shadowDistance(3000, 1000))
  })

  it('keeps the bounds, extent and texel grid for a move of a metre and an aim that varies by 1 %', () => {
    const at = (x: number, aim: number) => fit(viewCamera(new Vector3(x, 1500, 19_000), new Vector3(x, 1000, 18_400)), HIGH_SUN, shadowDistance(1500, 1000, aim))!
    const a = at(0, 700)
    const b = at(1, 707)
    expect(b.right - b.left).toBe(a.right - a.left)
    expect(b.top - b.bottom).toBe(a.top - a.bottom)
    for (const f of [a, b]) {
      const texelX = (f.right - f.left) / MAP_SIZE
      const texelY = (f.top - f.bottom) / MAP_SIZE
      expect(Math.abs(f.left / texelX - Math.round(f.left / texelX))).toBeLessThan(1e-6)
      expect(Math.abs(f.bottom / texelY - Math.round(f.bottom / texelY))).toBeLessThan(1e-6)
    }
  })

  it('reaches the casters between the view and a low sun', () => {
    // looking east, away from a western sun: the ridges to the west are behind the camera
    const camera = viewCamera(new Vector3(0, 2500, 0), new Vector3(5000, 1500, 0))
    const result = fit(camera, LOW_SUN, 10_000)!
    const all = lightSpaceBounds(TERRAIN, LOW_SUN)
    expect(result.near).toBeLessThanOrEqual(-all.max.z)
  })

  it('returns null when no terrain is in view', () => {
    const camera = viewCamera(new Vector3(0, 10_000, 0), new Vector3(0, 20_000, 1))
    expect(fit(camera, HIGH_SUN)).toBeNull()
    expect(fit(camera, HIGH_SUN, 1e7, new Box3())).toBeNull()
  })

  it('keeps the same bounds for a camera move smaller than a texel', () => {
    const a = fit(viewCamera(new Vector3(0, 60_000, 30_000), new Vector3(0, 0, 0)), HIGH_SUN)!
    const b = fit(viewCamera(new Vector3(0.5, 60_000, 30_000), new Vector3(0.5, 0, 0)), HIGH_SUN)!
    expect(b.right - b.left).toBe(a.right - a.left)
    expect(b.top - b.bottom).toBe(a.top - a.bottom)
  })
})

describe('TerrainShadow', () => {
  function scene() {
    const terrain = new Group()
    const geometry = new BoxGeometry(10_000, 2000, 10_000).translate(0, 2000, 0)
    geometry.computeBoundingBox()
    terrain.add(new Mesh(geometry))
    const light = new DirectionalLight()
    light.position.copy(HIGH_SUN).normalize()
    light.updateMatrixWorld()
    light.target.updateMatrixWorld()
    const camera = viewCamera(new Vector3(0, 30_000, 20_000), new Vector3(0, 2000, 0))
    return { terrain, light, camera }
  }

  it('fits its camera and biases to the visible terrain when the renderer updates it', () => {
    const { terrain, light, camera } = scene()
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    shadow.updateMatrices(light, camera)
    const ortho = shadow.camera
    const width = ortho.right - ortho.left
    expect(width).toBeGreaterThan(10_000)
    expect(width).toBeLessThan(20_000)
    expect(shadow.normalBias).toBeCloseTo((NORMAL_BIAS_TEXELS * Math.max(width, ortho.top - ortho.bottom)) / MAP_SIZE)
    expect(shadow.bias).toBeLessThan(0)
    expect(shadow.mapSize.x).toBe(MAP_SIZE)
  })

  it('fits a smaller shadow when the camera flies close to the ground it is given', () => {
    const { terrain, light } = scene()
    const camera = viewCamera(new Vector3(0, 2300, 4000), new Vector3(0, 2000, 3500))
    const widthWith = (groundUnder?: (point: Vector3) => number | undefined) => {
      const shadow = new TerrainShadow(terrain, MAP_SIZE, groundUnder)
      shadow.updateMatrices(light, camera)
      return shadow.camera.right - shadow.camera.left
    }
    expect(widthWith(() => 2000)).toBeLessThan(widthWith() / 2)
    // ground unknown: as before
    expect(widthWith(() => undefined)).toBe(widthWith())
  })

  it('counts the tiles and triangles of the shadow pass, the off-screen casters apart', () => {
    const { terrain, light, camera } = scene()
    // looking east from the middle of the terrain, a western sun: a ridge behind the camera casts into the view
    light.position.copy(LOW_SUN).normalize()
    light.updateMatrixWorld()
    camera.position.set(0, 2500, 0)
    camera.lookAt(5000, 1500, 0)
    camera.updateMatrixWorld()
    const ridge = new BoxGeometry(2000, 2000, 2000).translate(-6000, 2000, 0)
    ridge.computeBoundingBox()
    terrain.add(new Mesh(ridge))
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    shadow.updateMatrices(light, camera)
    expect(lastShadowPass).toEqual({ tiles: 2, triangles: 24, offscreenTiles: 1, offscreenTriangles: 12 })
    // a hidden tile is not drawn
    terrain.children[1].visible = false
    shadow.updateMatrices(light, camera)
    expect(lastShadowPass).toMatchObject({ tiles: 1, offscreenTiles: 0 })
  })

  it('leaves the default projection when no terrain mesh is visible', () => {
    const { terrain, light, camera } = scene()
    terrain.children[0].visible = false
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    const before = shadow.camera.right
    shadow.updateMatrices(light, camera)
    expect(shadow.camera.right).toBe(before)
  })
})

describe('casters that cannot shade the view', () => {
  /** 16 x 16 tiles of 4 km, ridges up to ~4 km: the boxes are the engine's tile bounds. */
  function mountains() {
    const terrain = new Group()
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const height = 800 + 700 * (Math.sin(i * 0.9 + 1) + Math.cos(j * 0.7) + 2)
        const geometry = new BoxGeometry(4000, height, 4000, 8, 2, 8).translate(-30_000 + i * 4000, height / 2, -30_000 + j * 4000)
        geometry.computeBoundingBox()
        terrain.add(new Mesh(geometry))
      }
    }
    return terrain
  }

  const cases = [
    { name: 'sun mid-height', sun: new Vector3(-1, 0.7, 0.2), from: new Vector3(0, 2600, 12_000), to: new Vector3(0, 1800, 0) },
    { name: 'low sun', sun: new Vector3(-1, 0.1, 0.2), from: new Vector3(0, 3000, 0), to: new Vector3(5000, 1800, 0) },
    { name: 'high sun', sun: new Vector3(0.3, 1, 0.2), from: new Vector3(-15_000, 4500, -15_000), to: new Vector3(0, 1500, 0) },
  ]

  function setup(sunDirection: Vector3, from: Vector3, to: Vector3) {
    const terrain = mountains()
    const light = new DirectionalLight()
    light.position.copy(sunDirection).normalize()
    light.updateMatrixWorld()
    light.target.updateMatrixWorld()
    const camera = viewCamera(from, to)
    camera.far = 20_000 // what the flyover sees of a tile pyramid: far ground is coarse and small
    camera.updateProjectionMatrix()
    const shadow = new TerrainShadow(terrain, MAP_SIZE)
    shadow.updateMatrices(light, camera)
    return { terrain, camera, shadow, sun: light.position.clone() }
  }

  it.each(cases)('never drops a tile that shades a point the view sees ($name)', ({ sun, from, to }) => {
    const { terrain, camera, shadow, sun: towardsSun } = setup(sun, from, to)
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    // receivers: points of the view between the lowest and the highest ground (a superset of the visible surface)
    let seed = 12345
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const receivers: Vector3[] = []
    for (let n = 0; n < 40_000 && receivers.length < 4000; n++) {
      const point = new Vector3(random() * 2 - 1, random() * 2 - 1, 0.5).unproject(camera)
      point.sub(camera.position).normalize().multiplyScalar(100 + random() * 60_000).add(camera.position)
      if (point.y >= 0 && point.y <= 4000 && frustum.containsPoint(point)) receivers.push(point)
    }
    expect(receivers.length).toBeGreaterThan(500)
    const ray = new Ray(new Vector3(), towardsSun)
    const meshes = terrain.children as Mesh[]
    let shading = 0
    for (const mesh of meshes) {
      const shades = receivers.some((receiver) => ray.origin.copy(receiver) && ray.intersectsBox(mesh.geometry.boundingBox!))
      if (shades) shading++
      if (shades) expect(mesh.castShadow).toBe(true)
    }
    const casting = meshes.filter((mesh) => mesh.castShadow).length
    expect(shading).toBeGreaterThan(0)
    expect(casting).toBeLessThan(meshes.length)
    // what the pass then draws is never more than before
    expect(lastShadowPass.tiles).toBeLessThanOrEqual(casting)
    expect(shadow.camera.far).toBeGreaterThan(shadow.camera.near)
  })

  it('draws under 70 % of the tiles and triangles it drew (141 to 45 tiles here), a low camera over mountains and a sun side-on', () => {
    const { terrain, shadow } = setup(cases[0].sun, cases[0].from, cases[0].to)
    const after = { ...lastShadowPass }
    for (const mesh of terrain.children as Mesh[]) mesh.castShadow = true
    const meshes = terrain.children as Mesh[]
    // the pass before the selection: every visible tile the shadow camera's frustum meets
    const before = { tiles: 0, triangles: 0 }
    for (const mesh of meshes) {
      if (!shadow.getFrustum().intersectsObject(mesh)) continue
      before.tiles++
      before.triangles += mesh.geometry.index!.count / 3
    }
    expect(after.tiles).toBeLessThan(before.tiles * 0.7)
    expect(after.triangles).toBeLessThan(before.triangles * 0.7)
  })

  it('restores the engine default when the shadow is disposed', () => {
    const { terrain, shadow } = setup(cases[0].sun, cases[0].from, cases[0].to)
    expect((terrain.children as Mesh[]).some((mesh) => !mesh.castShadow)).toBe(true)
    shadow.dispose()
    expect((terrain.children as Mesh[]).every((mesh) => mesh.castShadow)).toBe(true)
  })

  it('keeps a box whose sun ray crosses the view and drops one that is behind it', () => {
    const camera = viewCamera(new Vector3(0, 100, 0), new Vector3(0, 100, -1000))
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const sun = new Vector3(0, 1, 1).normalize() // the sun behind the camera
    const ahead = new Box3(new Vector3(-50, 500, -3000), new Vector3(50, 600, -2900))
    const behind = new Box3(new Vector3(-50, 500, 2900), new Vector3(50, 600, 3000))
    // the ground is at 0: a box ahead and high shades ground in view only with the sun in front of it
    expect(mayShadowView(ahead, new Vector3(0, 1, -1).normalize(), frustum, 0, 1e6, 0)).toBe(true)
    expect(mayShadowView(behind, sun, frustum, 0, 1e6, 0)).toBe(false)
    expect(mayShadowView(ahead, sun, frustum, 0, 1e6, 0)).toBe(true) // already in the view itself
  })
})
