import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three'
import type { GlacierPolygon } from '../osm/glacier'
import { createGlacierMaterial } from './glacierMaterial'
import { buildGlacierMesh, fillHeights } from './glacierMesh'

const M = 111_320
const LAT = 45.9
const K = Math.cos((LAT * Math.PI) / 180) * M

/** Square of `sideM` metres centred on (6.93, 45.9), as an open [lon, lat] ring. */
function square(sideM: number): [number, number][] {
  const h = sideM / 2
  return [
    [6.93 - h / K, LAT - h / M],
    [6.93 + h / K, LAT - h / M],
    [6.93 + h / K, LAT + h / M],
    [6.93 - h / K, LAT + h / M],
  ]
}

function area(mesh: ReturnType<typeof buildGlacierMesh>): number {
  const xy = (i: number) => [(mesh.lonLat[2 * i] - 6.93) * K, (mesh.lonLat[2 * i + 1] - LAT) * M]
  let sum = 0
  for (let t = 0; t < mesh.index.length; t += 3) {
    const [a, b, c] = [xy(mesh.index[t]), xy(mesh.index[t + 1]), xy(mesh.index[t + 2])]
    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  return sum
}

describe('buildGlacierMesh', () => {
  const glacier: GlacierPolygon = { id: 'way/1', outer: square(1000), holes: [] }

  it('covers the glacier on the grid of the water, holes left out, with vertices inside', () => {
    const mesh = buildGlacierMesh(glacier)
    expect(area(mesh)).toBeCloseTo(1_000_000, -3)
    expect(mesh.lonLat.length / 2).toBeGreaterThan(200)
    expect(area(buildGlacierMesh({ ...glacier, holes: [square(200)] }))).toBeCloseTo(960_000, -3)
  })

  it('fades from the edge (0) to the inside (1, beyond 40 m)', () => {
    const { fade } = buildGlacierMesh(glacier)
    expect(Math.min(...fade)).toBe(0)
    expect(Math.max(...fade)).toBe(1)
  })
})

describe('fillHeights', () => {
  it('gives the median of the known heights to the vertices whose relief is not loaded', () => {
    expect(Array.from(fillHeights([1000, Number.NaN, 1200, 1100])!)).toEqual([1000, 1100, 1200, 1100])
  })

  it('waits (null) when no height is known', () => {
    expect(fillHeights([Number.NaN, Number.NaN])).toBeNull()
    expect(fillHeights([])).toBeNull()
  })
})

// the patch rewrites the text of three's standard shader: this test fails when an upgrade moves that text
describe('createGlacierMaterial', () => {
  function compile(material: MeshStandardMaterial) {
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as never)
    return shader
  }

  it('draws over the relief without writing depth, with the snow noise and albedo, no texture', () => {
    const material = createGlacierMaterial()
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.polygonOffset).toBe(true)
    const { vertexShader, fragmentShader } = compile(material)
    expect(vertexShader).toContain('vGlacierUp = normalize(mat3(modelMatrix) * objectNormal).y;')
    expect(fragmentShader).toContain('float snowNoise(vec2 p, float size)')
    expect(fragmentShader).toContain('vec3(0.80, 0.83, 0.88)')
    // the colour is set after the imagery's slot and before the lights; the shade is tinted after them
    expect(fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(fragmentShader.indexOf('glacierCracks *='))
    expect(fragmentShader.indexOf('glacierCracks *=')).toBeLessThan(fragmentShader.indexOf('#include <lights_physical_fragment>'))
    expect(fragmentShader.indexOf('#include <lights_fragment_end>')).toBeLessThan(fragmentShader.indexOf('reflectedLight.indirectDiffuse *='))
    expect(fragmentShader).not.toMatch(/texture2D\(glacier|sampler2D glacier/)
  })

  it('has its own program, not the terrain’s', () => {
    expect(createGlacierMaterial().customProgramCacheKey()).toBe('openflyover-glacier')
  })
})
