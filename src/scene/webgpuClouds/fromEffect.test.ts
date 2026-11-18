import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { cloudParamsFrom, cloudUniformsOf } from './fromEffect'
import { packParams } from './layout'

const IRRADIANCES = { groundSun: [1, 1, 1], groundSky: [0.2, 0.2, 0.2], minSun: [2, 2, 2], minSky: [0.3, 0.3, 0.3], maxSun: [3, 3, 3], maxSky: [0.4, 0.4, 0.4] } as const

describe('the WebGPU clouds read the clouds of the scene', () => {
  it('takes the layers, the cover, the march and the shadow map of the library, and the camera in ECEF', () => {
    const camera = new PerspectiveCamera(50, 9 / 16, 1, 1e7)
    camera.position.set(100, 200, 300)
    camera.updateMatrixWorld()
    const effect = new CloudsEffect(camera)
    effect.coverage = 0.42
    effect.qualityPreset = 'medium'
    const uniforms = cloudUniformsOf(effect)
    uniforms.worldToECEFMatrix.value.makeTranslation(10, 20, 30)
    uniforms.altitudeCorrection.value.set(0, 0, 5)
    const params = cloudParamsFrom(effect, camera, 1080, 1920, IRRADIANCES)
    expect(params.coverage).toBeCloseTo(0.42)
    expect(params.cameraEcef).toEqual([110, 220, 335])
    // the view frame: the camera's world matrix, moved into ECEF
    expect(params.viewToEcef[12]).toBe(110)
    expect(params.bottomRadius).toBeGreaterThan(6e6)
    expect(params.densityLinearTerms).toHaveLength(4)
    expect(params.sunIrradianceMax).toEqual([3, 3, 3])
    // the « medium » preset of the library
    expect(params.march).toMatchObject({ maxIterationCount: 500, minDensity: 1e-4, maxIterationCountToGround: 1, turbulence: false })
    expect(params.cascadeCount).toBe(effect.shadowMaps.cascadeCount)
    expect(params.shadowMatrices).toHaveLength(params.cascadeCount)
    expect(params.shadowSize).toBe(effect.shadowMaps.mapSize.x)
    expect(() => packParams({ ...params, frame: 0, firstSlice: true })).not.toThrow()
  })
})
