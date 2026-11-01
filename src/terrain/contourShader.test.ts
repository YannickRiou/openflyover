import { MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { applyContours, contourUniforms, setContourUniforms } from './contourShader'
import { DEFAULT_CONTOURS, isValidContours } from './contours'
import { applySnow } from './snowShader'

describe('contour settings', () => {
  it('accepts the defaults and refuses values out of range or a bad colour', () => {
    expect(isValidContours(DEFAULT_CONTOURS)).toBe(true)
    expect(isValidContours({ ...DEFAULT_CONTOURS, intervalM: 5 })).toBe(false)
    expect(isValidContours({ ...DEFAULT_CONTOURS, intervalM: 600 })).toBe(false)
    expect(isValidContours({ ...DEFAULT_CONTOURS, opacity: 0 })).toBe(false)
    expect(isValidContours({ ...DEFAULT_CONTOURS, color: 'red' })).toBe(false)
  })

  it('draws no line when off, and sets the uniforms when on', () => {
    setContourUniforms({ ...DEFAULT_CONTOURS, enabled: false })
    expect(contourUniforms.contourOpacity.value).toBe(0)
    setContourUniforms({ enabled: true, intervalM: 100, opacity: 0.5, color: '#ff0000' })
    expect(contourUniforms.contourInterval.value).toBe(100)
    expect(contourUniforms.contourOpacity.value).toBe(0.5)
    expect(contourUniforms.contourColor.value.r).toBeGreaterThan(0.9)
  })
})

describe('applyContours', () => {
  const FRAGMENT = '#include <map_fragment>\n#include <color_fragment>\nvoid main() {}'
  const compile = (material: MeshStandardMaterial) => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
      fragmentShader: FRAGMENT,
    }
    material.onBeforeCompile(shader as never, null as never)
    return shader
  }

  it('adds the lines after the colour of the snow, in the same program as the snow', () => {
    const material = new MeshStandardMaterial()
    applySnow(material)
    applyContours(material)
    const shader = compile(material)
    expect(shader.uniforms).toHaveProperty('contourInterval')
    expect(shader.uniforms).toHaveProperty('snowLine')
    expect(shader.fragmentShader.indexOf('snowCover')).toBeGreaterThan(-1)
    expect(shader.fragmentShader.indexOf('contourLine')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'))
    expect(material.customProgramCacheKey()).toBe('openflyover-terrain-snow-contours')
  })

  it('throws when three no longer has the chunk it patches', () => {
    const material = new MeshStandardMaterial()
    applySnow(material)
    applyContours(material)
    const shader = { uniforms: {}, vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '#include <map_fragment>' }
    expect(() => material.onBeforeCompile(shader as never, null as never)).toThrow(/color_fragment/)
  })
})
