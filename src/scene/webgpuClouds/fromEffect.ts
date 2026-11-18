/**
 * The parameters of the WebGPU clouds (`layout.ts`) read from the clouds the scene draws: the uniforms and defines the
 * library's materials have for this frame (`CloudsEffect.update` has just run, without drawing, `bridge.ts`), the
 * camera, and the irradiances WebGL computed (`webglSide.ts`). Pure apart from reading three.js objects.
 */
import type { CloudsEffect } from '@takram/three-clouds'
import { Matrix4, Vector3 } from 'three'
import type { Camera, DataTexture, Matrix4 as Matrix4Type, Vector2, Vector4 } from 'three'
import type { CloudMarch, CloudParamsInput, ShadowMarch } from './layout'

interface DensityProfileVectors {
  expTerms: Vector4
  exponents: Vector4
  linearTerms: Vector4
  constantTerms: Vector4
}

type U<T> = { value: T }

/** The uniforms of the clouds material this file reads (the parameter and layer ones are shared with the shadow map). */
export interface CloudUniforms {
  bottomRadius: U<number>
  worldToECEFMatrix: U<Matrix4Type>
  ecefToWorldMatrix: U<Matrix4Type>
  altitudeCorrection: U<Vector3>
  sunDirection: U<Vector3>
  cameraHeight: U<number>
  cameraNear: U<number>
  viewMatrix: U<Matrix4Type>
  inverseProjectionMatrix: U<Matrix4Type>
  inverseViewMatrix: U<Matrix4Type>
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
  shadowTopHeight: U<number>
  shadowBottomHeight: U<number>
  densityProfile: U<DensityProfileVectors>
  skyLightScale: U<number>
  groundBounceScale: U<number>
  powderScale: U<number>
  powderExponent: U<number>
  mipLevelScale: U<number>
  maxIterationCount: U<number>
  minStepSize: U<number>
  maxStepSize: U<number>
  maxRayDistance: U<number>
  perspectiveStepScale: U<number>
  minDensity: U<number>
  minExtinction: U<number>
  minTransmittance: U<number>
  maxIterationCountToSun: U<number>
  maxIterationCountToGround: U<number>
  minSecondaryStepSize: U<number>
  secondaryStepScale: U<number>
  shadowIntervals: U<Vector2[]>
  shadowMatrices: U<Matrix4Type[]>
  shadowFar: U<number>
  maxShadowFilterRadius: U<number>
  /** added by CloudsLayer (`addNightFill`, `addRegionalCoverage`) */
  nightIrradiance?: U<Vector3>
  regionalCoverage?: U<DataTexture>
  regionalFrame?: U<Vector3>
  regionalAmount?: U<number>
}

/** The uniforms of the shadow map material this file reads. */
export interface ShadowUniforms {
  inverseShadowMatrices: U<Matrix4Type[]>
  maxIterationCount: U<number>
  minStepSize: U<number>
  maxStepSize: U<number>
  minDensity: U<number>
  minExtinction: U<number>
  minTransmittance: U<number>
  opticalDepthTailScale: U<number>
  shadowLayerMask: U<Vector4>
}

export const cloudUniformsOf = (effect: CloudsEffect) => effect.cloudsPass.currentMaterial.uniforms as unknown as CloudUniforms
export const shadowUniformsOf = (effect: CloudsEffect) => effect.shadowPass.currentMaterial.uniforms as unknown as ShadowUniforms
type Defines = Record<string, string | number | boolean | undefined>
export const cloudDefinesOf = (effect: CloudsEffect) => effect.cloudsPass.currentMaterial.defines as Defines
export const shadowDefinesOf = (effect: CloudsEffect) => effect.shadowPass.currentMaterial.defines as Defines

/** The sun and sky irradiances of the library's vertex shader (`webglSide.ts` computes them with its atmosphere). */
export interface Irradiances {
  groundSun: readonly [number, number, number]
  groundSky: readonly [number, number, number]
  minSun: readonly [number, number, number]
  minSky: readonly [number, number, number]
  maxSun: readonly [number, number, number]
  maxSky: readonly [number, number, number]
}

const v4 = (v: Vector4) => [v.x, v.y, v.z, v.w] as const
const v3 = (v: Vector3) => [v.x, v.y, v.z] as const
const v2 = (v: Vector2) => [v.x, v.y] as const
const num = (value: string | number | boolean | undefined, fallback: number) => (value === undefined ? fallback : Number(value))

const _ecef = new Vector3()
const _viewToEcef = new Matrix4()

/** The input of `packParams` for this frame, without the slice. `width` × `height`: the cloud pass. */
export function cloudParamsFrom(effect: CloudsEffect, camera: Camera, width: number, height: number, irradiances: Irradiances): Omit<CloudParamsInput, 'frame' | 'firstSlice'> {
  const u = cloudUniformsOf(effect)
  const s = shadowUniformsOf(effect)
  const defines = cloudDefinesOf(effect)
  const cameraEcef = _ecef.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(u.worldToECEFMatrix.value).add(u.altitudeCorrection.value)
  _viewToEcef.multiplyMatrices(u.worldToECEFMatrix.value, camera.matrixWorld)
  const profile = u.densityProfile.value
  const cascades = effect.shadowMaps.cascadeCount
  const march: CloudMarch = {
    maxIterationCount: u.maxIterationCount.value,
    minStepSize: u.minStepSize.value,
    maxStepSize: u.maxStepSize.value,
    maxRayDistance: u.maxRayDistance.value,
    perspectiveStepScale: u.perspectiveStepScale.value,
    minDensity: u.minDensity.value,
    minExtinction: u.minExtinction.value,
    minTransmittance: u.minTransmittance.value,
    maxIterationCountToSun: u.maxIterationCountToSun.value,
    maxIterationCountToGround: u.maxIterationCountToGround.value,
    minSecondaryStepSize: u.minSecondaryStepSize.value,
    secondaryStepScale: u.secondaryStepScale.value,
    multiScatteringOctaves: num(defines.MULTI_SCATTERING_OCTAVES, 8),
    shapeDetail: defines.SHAPE_DETAIL !== undefined,
    turbulence: defines.TURBULENCE !== undefined,
  }
  const shadowMarch: ShadowMarch = {
    maxIterationCount: s.maxIterationCount.value,
    minStepSize: s.minStepSize.value,
    maxStepSize: s.maxStepSize.value,
    minDensity: s.minDensity.value,
    minExtinction: s.minExtinction.value,
    minTransmittance: s.minTransmittance.value,
    opticalDepthTailScale: s.opticalDepthTailScale.value,
  }
  const regional = u.regionalFrame?.value
  return {
    inverseProjection: u.inverseProjectionMatrix.value.elements.slice(),
    viewToEcef: _viewToEcef.elements.slice(),
    view: u.viewMatrix.value.elements.slice(),
    worldToEcef: u.worldToECEFMatrix.value.elements.slice(),
    ecefToWorld: u.ecefToWorldMatrix.value.elements.slice(),
    altitudeCorrection: v3(u.altitudeCorrection.value),
    cameraEcef: v3(cameraEcef),
    cameraHeight: u.cameraHeight.value,
    cameraNear: u.cameraNear.value,
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
    groundBounceScale: u.groundBounceScale.value,
    powder: defines.POWDER !== undefined,
    groundBounce: defines.GROUND_BOUNCE !== undefined,
    powderScale: u.powderScale.value,
    powderExponent: u.powderExponent.value,
    turbulenceDisplacement: u.turbulenceDisplacement.value,
    mipLevelScale: u.mipLevelScale.value,
    scatterAnisotropy: [num(defines.SCATTER_ANISOTROPY_1, 0.7), num(defines.SCATTER_ANISOTROPY_2, -0.2), num(defines.SCATTER_ANISOTROPY_MIX, 0.5)],
    localWeatherRepeat: v2(u.localWeatherRepeat.value),
    localWeatherOffset: v2(u.localWeatherOffset.value),
    shapeRepeat: v3(u.shapeRepeat.value),
    shapeOffset: v3(u.shapeOffset.value),
    shapeDetailRepeat: v3(u.shapeDetailRepeat.value),
    shapeDetailOffset: v3(u.shapeDetailOffset.value),
    turbulenceRepeat: v2(u.turbulenceRepeat.value),
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
    sunIrradianceMin: irradiances.minSun,
    sunIrradianceMax: irradiances.maxSun,
    skyIrradianceMin: irradiances.minSky,
    skyIrradianceMax: irradiances.maxSky,
    groundSunIrradiance: irradiances.groundSun,
    groundSkyIrradiance: irradiances.groundSky,
    nightIrradiance: u.nightIrradiance ? v3(u.nightIrradiance.value) : [0, 0, 0],
    regionalFrame: regional ? v3(regional) : [0, 0, 0],
    regionalAmount: u.regionalAmount?.value ?? 0,
    cascadeCount: cascades,
    shadowSize: effect.shadowMaps.mapSize.x,
    shadowMatrices: u.shadowMatrices.value.slice(0, cascades).map((m) => m.elements.slice()),
    inverseShadowMatrices: s.inverseShadowMatrices.value.slice(0, cascades).map((m) => m.elements.slice()),
    shadowIntervals: u.shadowIntervals.value.slice(0, cascades).map((v) => v2(v)),
    shadowFar: u.shadowFar.value,
    shadowTopHeight: u.shadowTopHeight.value,
    shadowBottomHeight: u.shadowBottomHeight.value,
    shadowLayerMask: v4(s.shadowLayerMask.value),
    maxShadowFilterRadius: u.maxShadowFilterRadius.value,
    shadowSampleCount: num(defines.SHADOW_SAMPLE_COUNT, 8),
    march,
    shadowMarch,
  }
}
