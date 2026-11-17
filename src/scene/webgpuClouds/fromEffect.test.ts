import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { cloudParamsFrom, uniformsOf } from './fromEffect'
import { CLOUD_MARCH, packParams } from './layout'

describe('the WebGPU march reads the clouds of the scene', () => {
  it('takes the layers, the cover and the frame of the library, and the camera in ECEF', () => {
    const camera = new PerspectiveCamera(50, 9 / 16, 1, 1e7)
    camera.position.set(100, 200, 300)
    const effect = new CloudsEffect(camera)
    effect.coverage = 0.42
    const uniforms = uniformsOf(effect)
    uniforms.worldToECEFMatrix.value.makeTranslation(10, 20, 30)
    uniforms.altitudeCorrection.value.set(0, 0, 5)
    const params = cloudParamsFrom(uniforms, camera, 1080, 1920, CLOUD_MARCH.high)
    expect(params.coverage).toBeCloseTo(0.42)
    expect(params.cameraEcef).toEqual([110, 220, 335])
    // the view frame: the camera's world matrix, moved into ECEF
    expect(params.viewToEcef[12]).toBe(110)
    expect(params.inverseProjection).toEqual(camera.projectionMatrixInverse.elements)
    expect(params.bottomRadius).toBeGreaterThan(6e6)
    expect(params.densityLinearTerms).toHaveLength(4)
    expect(() => packParams({ ...params, frame: 0 })).not.toThrow()
  })
})
