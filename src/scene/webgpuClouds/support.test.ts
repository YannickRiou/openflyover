import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { unsupportedReason, type CloudConfig } from './support'
import { patchCloudsRead, patchShadowRead } from './webglSide'

const CONFIG: CloudConfig = {
  clouds: { SHAPE_DETAIL: '1', POWDER: '1', GROUND_BOUNCE: '1', LOCAL_WEATHER_CHANNELS: 'rgba' },
  shadow: { SHAPE_DETAIL: '1' },
  temporalUpscale: false,
  shadowTemporalPass: false,
  cascades: 3,
  shadowSize: [256, 256],
  perspective: true,
}

describe('when the WebGPU clouds stand in for the WebGL ones', () => {
  it('draw the export qualities « Standard » and « Haute » (the library\'s « low » and « medium »)', () => {
    expect(unsupportedReason(CONFIG)).toBeNull()
  })

  it('leave to WebGL what they do not port: the light shafts, the accurate light, the haze, the turbulence', () => {
    for (const name of ['SHADOW_LENGTH', 'ACCURATE_SUN_SKY_LIGHT', 'HAZE', 'TURBULENCE', 'ACCURATE_PHASE_FUNCTION']) {
      expect(unsupportedReason({ ...CONFIG, clouds: { ...CONFIG.clouds, [name]: '1' } })).toBe(name)
    }
  })

  it('and the preview (upscaled), an odd shadow map, other channels of the weather', () => {
    expect(unsupportedReason({ ...CONFIG, temporalUpscale: true })).toBe('temporalUpscale')
    expect(unsupportedReason({ ...CONFIG, shadowSize: [200, 200] })).toMatch(/ombre/)
    expect(unsupportedReason({ ...CONFIG, clouds: { ...CONFIG.clouds, LOCAL_WEATHER_CHANNELS: 'rrrr' } })).toMatch(/LOCAL_WEATHER/)
  })
})

describe('the patches of the installed clouds library', () => {
  const effect = new CloudsEffect(new PerspectiveCamera())

  it('make the clouds pass read the WebGPU march instead of marching, once', () => {
    const source = effect.cloudsPass.currentMaterial.fragmentShader
    const patched = patchCloudsRead(source)
    expect(patched).not.toBe(source)
    expect(patched).toContain('color = texelFetch(webgpuColor, ivec2(gl_FragCoord.xy), 0);')
    expect(patched).toMatch(/} else {\s*color = marchClouds\(/)
    expect(patchCloudsRead(patched)).toBe(patched)
  })

  it('make the shadow map pass write the WebGPU shadow map in every cascade', () => {
    const source = effect.shadowPass.currentMaterial.fragmentShader
    const patched = patchShadowRead(source)
    expect(patched).not.toBe(source)
    expect(patched).toContain('outputColor = texelFetch(webgpuShadow, ivec3(ivec2(gl_FragCoord.xy), cascadeIndex), 0);')
    expect(patchShadowRead(patched)).toBe(patched)
  })

  it('leave a source without the expected text unchanged', () => {
    expect(patchCloudsRead('void main() {}')).toBe('void main() {}')
    expect(patchShadowRead('void main() {}')).toBe('void main() {}')
  })
})
