import { describe, expect, it } from 'vitest'
import { AerialPerspectiveEffect } from '@takram/three-atmosphere'
import { CloudsEffect } from '@takram/three-clouds'
import { patchCloudShadow, patchRegionalCoverage } from './cloudShaders'

// the patches rewrite the text of the libraries' shaders: these tests fail when an upgrade moves that text

describe('patchRegionalCoverage', () => {
  const effect = new CloudsEffect()

  it.each([
    ['clouds', effect.cloudsPass.currentMaterial.fragmentShader],
    ['shadow map', effect.shadowPass.currentMaterial.fragmentShader],
  ])('reads the coverage of each layer from the field in the %s shader', (_name, source) => {
    const patched = patchRegionalCoverage(source)
    expect(patched).not.toBe(source)
    expect(patched).toContain('uniform sampler2D regionalCoverage;')
    expect(patched).toContain('textureLod(regionalCoverage')
    expect(patched).toContain('vec4 factor = 1.0 - localCoverage * heightScale;')
    expect(patched).not.toContain('1.0 - coverage * heightScale')
    // applied once
    expect(patchRegionalCoverage(patched)).toBe(patched)
  })

  it('leaves another shader alone', () => {
    expect(patchRegionalCoverage('void main() {}')).toBe('void main() {}')
  })
})

describe('patchCloudShadow', () => {
  const source = new AerialPerspectiveEffect().getFragmentShader()

  it('dims the unlit colour by the sun share and the transmittance of the clouds, reading the shadow map only when asked', () => {
    const patched = patchCloudShadow(source)
    expect(patched).not.toBe(source)
    expect(patched).toContain('uniform float cloudShadowStrength;')
    expect(patched).toContain('if (cloudShadowStrength > 0.0) {')
    expect(patched).toContain('radiance *= mix(1.0, sunTransmittance, cloudShadowStrength * cloudSunShare);')
    expect(patchCloudShadow(patched)).toBe(patched)
  })

  it('leaves another shader alone', () => {
    expect(patchCloudShadow('void main() {}')).toBe('void main() {}')
  })
})
