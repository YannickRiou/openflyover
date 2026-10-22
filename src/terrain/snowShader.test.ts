import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three'
import { NO_SNOW_LINE_M, applySnow, snowUniforms } from './snowShader'

// the patch rewrites the text of three's standard shader: this test fails when an upgrade moves that text

describe('applySnow', () => {
  function compile(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
    const material = new MeshStandardMaterial()
    applySnow(material)
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    }
    material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as never)
    return shader
  }

  it('blends the snow over the imagery albedo, from the world position and the slope', () => {
    const { vertexShader, fragmentShader, uniforms } = compile()
    expect(vertexShader).toContain('vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;')
    expect(vertexShader).toContain('vSnowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(fragmentShader).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, snowCover * 0.94);')
    // after the imagery is read, before the lights
    expect(fragmentShader.indexOf('#include <map_fragment>')).toBeLessThan(fragmentShader.indexOf('snowCover'))
    expect(fragmentShader.indexOf('snowCover')).toBeLessThan(fragmentShader.indexOf('#include <lights_physical_fragment>'))
    // no texture is read for the snow
    expect(fragmentShader).not.toMatch(/texture2D\(snow|sampler2D snow/)
    expect(uniforms.snowLine).toBe(snowUniforms.snowLine)
  })

  it('shares one program between the tiles and draws no snow until a line is set', () => {
    const a = new MeshStandardMaterial()
    const b = new MeshStandardMaterial()
    applySnow(a)
    applySnow(b)
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey())
    expect(snowUniforms.snowLine.value).toBe(NO_SNOW_LINE_M)
  })
})
