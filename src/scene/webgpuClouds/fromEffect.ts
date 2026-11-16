/**
 * The parameters of the WebGPU march (`layout.ts`) read from the clouds the scene draws: the uniforms of the library's
 * material as the last frame left them (layers, cover, drift, sun, ECEF frame) and the camera. The march settings are the
 * export's (`CLOUD_MARCH`), the preview runs the cheapest ones.
 */
import type { CloudsEffect } from '@takram/three-clouds'
import { Matrix4, Vector3 } from 'three'
import type { Camera, Vector2, Vector4 } from 'three'
import type { CloudMarch, CloudParamsInput } from './layout'

interface DensityProfileVectors {
  expTerms: Vector4
  exponents: Vector4
  linearTerms: Vector4
  constantTerms: Vector4
}

type U<T> = { value: T }

/** The uniforms this file reads (shared by the library's materials). */
export interface CloudUniforms {
  bottomRadius: U<number>
  worldToECEFMatrix: U<Matrix4>
  altitudeCorrection: U<Vector3>
  sunDirection: U<Vector3>
  cameraHeight: U<number>
  scatteringCoefficient: U<number>
  absorptionCoefficient: U<number>
  coverage: U<number>
  localWeatherRepeat: U<Vector2>
  localWeatherOffset: U<Vector2>
  shapeRepeat: U<Vector3>
  shapeOffset: U<Vector3>
  shapeDetailRepeat: U<Vector3>
  shapeDetailOffset: U<Vector3>
  turbulenceRepeat: U<Vector2>
  turbulenceDisplacement: U<number>
  minLayerHeights: U<Vector4>
  maxLayerHeights: U<Vector4>
  minIntervalHeights: U<Vector3>
  maxIntervalHeights: U<Vector3>
  densityScales: U<Vector4>
  shapeAmounts: U<Vector4>
  shapeDetailAmounts: U<Vector4>
  weatherExponents: U<Vector4>
  shapeAlteringBiases: U<Vector4>
  coverageFilterWidths: U<Vector4>
  minHeight: U<number>
  maxHeight: U<number>
  densityProfile: U<DensityProfileVectors>
  skyLightScale: U<number>
  powderScale: U<number>
  powderExponent: U<number>
}

const v4 = (v: Vector4) => [v.x, v.y, v.z, v.w] as const
const v3 = (v: Vector3) => [v.x, v.y, v.z] as const

/**
 * Irradiance of the sun and of the sky on the clouds, for the measure only: the library takes them from the atmosphere's
 * tables (a later step). Their values change the picture, not the work.
 */
const SUN_IRRADIANCE = [1, 0.98, 0.94] as const
const SKY_IRRADIANCE = [0.25, 0.32, 0.45] as const

const _ecef = new Vector3()
const _viewToEcef = new Matrix4()

/** The input of `packParams` for `camera`, at `width` × `height`, without the slice index. */
export function cloudParamsFrom(
  uniforms: CloudUniforms,
  camera: Camera & { near?: number },
  width: number,
  height: number,
  march: CloudMarch,
): Omit<CloudParamsInput, 'frame'> {
  const u = uniforms
  camera.updateMatrixWorld()
  const cameraEcef = _ecef.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(u.worldToECEFMatrix.value).add(u.altitudeCorrection.value)
  _viewToEcef.multiplyMatrices(u.worldToECEFMatrix.value, camera.matrixWorld)
  const profile = u.densityProfile.value
  return {
    inverseProjection: camera.projectionMatrixInverse.elements.slice(),
    viewToEcef: _viewToEcef.elements.slice(),
    cameraEcef: v3(cameraEcef),
    cameraHeight: u.cameraHeight.value,
    cameraNear: camera.near ?? 0.1,
    sunDirection: v3(u.sunDirection.value),
    width,
    height,
    bottomRadius: u.bottomRadius.value,
    minHeight: u.minHeight.value,
    maxHeight: u.maxHeight.value,
    coverage: u.coverage.value,
    scatteringCoefficient: u.scatteringCoefficient.value,
    absorptionCoefficient: u.absorptionCoefficient.value,
    skyLightScale: u.skyLightScale.value,
    powderScale: u.powderScale.value,
    powderExponent: u.powderExponent.value,
    turbulenceDisplacement: u.turbulenceDisplacement.value,
    localWeatherRepeat: [u.localWeatherRepeat.value.x, u.localWeatherRepeat.value.y],
    localWeatherOffset: [u.localWeatherOffset.value.x, u.localWeatherOffset.value.y],
    shapeRepeat: v3(u.shapeRepeat.value),
    shapeOffset: v3(u.shapeOffset.value),
    shapeDetailRepeat: v3(u.shapeDetailRepeat.value),
    shapeDetailOffset: v3(u.shapeDetailOffset.value),
    turbulenceRepeat: [u.turbulenceRepeat.value.x, u.turbulenceRepeat.value.y],
    minLayerHeights: v4(u.minLayerHeights.value),
    maxLayerHeights: v4(u.maxLayerHeights.value),
    minIntervalHeights: v3(u.minIntervalHeights.value),
    maxIntervalHeights: v3(u.maxIntervalHeights.value),
    densityScales: v4(u.densityScales.value),
    shapeAmounts: v4(u.shapeAmounts.value),
    shapeDetailAmounts: v4(u.shapeDetailAmounts.value),
    weatherExponents: v4(u.weatherExponents.value),
    shapeAlteringBiases: v4(u.shapeAlteringBiases.value),
    coverageFilterWidths: v4(u.coverageFilterWidths.value),
    densityExpTerms: v4(profile.expTerms),
    densityExponents: v4(profile.exponents),
    densityLinearTerms: v4(profile.linearTerms),
    densityConstantTerms: v4(profile.constantTerms),
    sunIrradianceMin: SUN_IRRADIANCE,
    sunIrradianceMax: SUN_IRRADIANCE,
    skyIrradianceMin: SKY_IRRADIANCE,
    skyIrradianceMax: SKY_IRRADIANCE,
    march,
  }
}

/** The uniforms of the clouds the scene draws now. */
export function uniformsOf(effect: CloudsEffect): CloudUniforms {
  return effect.cloudsPass.currentMaterial.uniforms as unknown as CloudUniforms
}
