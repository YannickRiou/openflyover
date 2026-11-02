import { describe, expect, it } from 'vitest'
import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three'
import { DEFAULT_SETTINGS } from '../state/store'
import { applySnow } from './snowShader'
import { applyContours } from './contourShader'
import { applyVivid, setVividUniforms, vividColour, vividStrength, vividUniforms } from './vividShader'

const hsv = (r: number, g: number, b: number) => {
  const v = Math.max(r, g, b)
  const d = v - Math.min(r, g, b)
  const h = d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: v === 0 ? 0 : d / v, v }
}

describe('vividColour', () => {
  const colours: [number, number, number][] = [[0.8, 0.78, 0.7], [0.45, 0.5, 0.2], [0, 0, 0], [1, 1, 1], [0.2, 0.3, 0.6]]

  it('is the identity at 0', () => {
    for (const c of colours) expect(vividColour(c, 0)).toEqual(c)
  })

  it('keeps the result between 0 and 1', () => {
    for (const c of colours) for (const x of vividColour(c, 1)) expect(x >= 0 && x <= 1).toBe(true)
  })

  it('keeps a pale grey rock pale and nearly grey', () => {
    const rock: [number, number, number] = [0.72, 0.7, 0.67]
    const out = vividColour(rock, 1)
    expect(Math.abs(hsv(...out).h - hsv(...rock).h)).toBeLessThan(5)
    expect(hsv(...out).s).toBeLessThan(0.15)
    expect(Math.min(...out)).toBeGreaterThan(0.55)
  })

  it('makes a dull yellow-green meadow more saturated and a little greener', () => {
    const meadow: [number, number, number] = [0.45, 0.5, 0.25]
    const out = vividColour(meadow, 1)
    expect(hsv(...out).s).toBeGreaterThan(hsv(...meadow).s + 0.1)
    expect(hsv(...out).h).toBeGreaterThan(hsv(...meadow).h)
    expect(hsv(...out).h - hsv(...meadow).h).toBeLessThan(21)
  })

  it('grows with the strength', () => {
    const meadow: [number, number, number] = [0.45, 0.5, 0.25]
    expect(hsv(...vividColour(meadow, 0.5)).s).toBeGreaterThan(hsv(...meadow).s)
    expect(hsv(...vividColour(meadow, 0.5)).s).toBeLessThan(hsv(...vividColour(meadow, 1)).s)
  })
})

describe('vividStrength', () => {
  it('is the setting with the IGN photos only, and keeps the setting for any other imagery', () => {
    expect(vividStrength({ imagerySourceId: 'ign-ortho', imageryVivid: 0.4 })).toBe(0.4)
    expect(vividStrength({ imagerySourceId: 'ign-plan', imageryVivid: 1 })).toBe(0)
    expect(vividStrength({ imagerySourceId: DEFAULT_SETTINGS.imagerySourceId, imageryVivid: 1 })).toBe(0)
    expect(DEFAULT_SETTINGS.imageryVivid).toBe(1)
  })

  it('sets the uniform of every tile', () => {
    setVividUniforms({ imagerySourceId: 'ign-ortho', imageryVivid: 0.5 })
    expect(vividUniforms.imageryVivid.value).toBe(0.5)
    setVividUniforms({ imagerySourceId: 'swisstopo', imageryVivid: 0.5 })
    expect(vividUniforms.imageryVivid.value).toBe(0)
  })
})

// the patch rewrites the text of three's standard shader: this test fails when an upgrade moves that text

describe('applyVivid', () => {
  function compile() {
    const material = new MeshStandardMaterial()
    applySnow(material)
    applyContours(material)
    applyVivid(material)
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as never)
    return { material, shader }
  }

  it('livens the photo right after it is sampled, before the snow, and only when the strength is above 0', () => {
    const { shader } = compile()
    const f = shader.fragmentShader
    expect(f).toContain('if (imageryVivid > 0.0) {')
    expect(f.indexOf('#include <map_fragment>')).toBeLessThan(f.indexOf('vividColour(vividToSrgb'))
    expect(f.indexOf('vividColour(vividToSrgb')).toBeLessThan(f.indexOf('snowCover'))
    expect(f.indexOf('vividColour(vividToSrgb')).toBeLessThan(f.indexOf('#include <lights_physical_fragment>'))
    expect(shader.uniforms).toMatchObject({ imageryVivid: vividUniforms.imageryVivid })
  })

  it('keeps the program of the tiles shared', () => {
    expect(compile().material.customProgramCacheKey()).toBe(compile().material.customProgramCacheKey())
  })
})
