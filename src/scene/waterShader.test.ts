import { describe, expect, it } from 'vitest'
import { ShaderLib, Uniform, type WebGLProgramParametersWithUniforms } from 'three'
import { NO_SNOW_LINE_M, snowUniforms } from '../terrain/snowShader'
import { MAX_STREAM_WIDENING, createWaterMaterial } from './WaterLayer'

// the patch rewrites the text of three's standard shader: this test fails when an upgrade moves that text

function compile() {
  const material = createWaterMaterial({ waterTime: new Uniform(0) })
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader }
  material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as never)
  return shader
}

describe('water material', () => {
  it('freezes a lake from the snow uniforms of the terrain: no waves, matt, opaque, ice albedo', () => {
    const { fragmentShader, uniforms } = compile()
    expect(uniforms.snowLine).toBe(snowUniforms.snowLine)
    expect(uniforms.snowBand).toBe(snowUniforms.snowBand)
    expect(uniforms.snowExaggeration).toBe(snowUniforms.snowExaggeration)
    expect(fragmentShader).toContain('waterIce = smoothstep(-0.5 * snowBand, 0.5 * snowBand, iceAlt - snowLine);')
    expect(fragmentShader).toContain(`snowLine < ${NO_SNOW_LINE_M.toFixed(1)} * 0.5`)
    // only a lake freezes: not a river, a ribbon or the sea
    expect(fragmentShader).toContain('vWaterLake > 0.5')
    expect(fragmentShader).toContain('(1.0 - waterIce) * amplitude')
    expect(fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, 1.0, waterIce);')
    expect(fragmentShader).toContain('indirectSpecular += sky * fresnel * waterStrength * (1.0 - waterIce)')
    expect(fragmentShader).toContain(', 1.0, waterIce) * waterStrength;')
    // the albedo is set before the lights read it
    expect(fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb')).toBeLessThan(fragmentShader.indexOf('#include <lights_physical_fragment>'))
  })

  it('widens the banks of a ribbon in the vertex shader, never beyond the cap', () => {
    const { vertexShader } = compile()
    expect(vertexShader).toContain('transformed.xz += waterEdge * (waterWiden - 1.0);')
    expect(vertexShader).toContain(`1.0, ${MAX_STREAM_WIDENING.toFixed(1)});`)
    // before the position is used for the world position and the projection
    expect(vertexShader.indexOf('waterWiden - 1.0')).toBeLessThan(vertexShader.indexOf('vWaterPos = '))
    expect(vertexShader.indexOf('waterWiden - 1.0')).toBeLessThan(vertexShader.indexOf('#include <project_vertex>'))
  })
})
