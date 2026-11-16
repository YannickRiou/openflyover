/**
 * Clouds marched in a WebGPU compute shader, step 1 (ROADMAP « V9 »): the parameters of the march, packed for the GPU.
 * One list of fields gives both the WGSL struct (`paramsStruct`) and the offsets of `packParams`, so the two cannot drift
 * apart. Pure (tested): no WebGPU here.
 *
 * The march settings of each export quality are those of the clouds library's presets (`@takram/three-clouds`,
 * qualityPresets.ts, not exported by the package), so that a measure compares the same work.
 */
import type { CloudQuality } from '../../weather/sceneClouds'

type Vec3 = readonly [number, number, number]
type Vec4 = readonly [number, number, number, number]

/** A 4 × 4 matrix, column-major (three.js `Matrix4.elements`). */
export type Mat4 = ArrayLike<number>

export interface CloudMarch {
  maxIterationCount: number
  minStepSize: number
  maxStepSize: number
  maxRayDistance: number
  perspectiveStepScale: number
  minDensity: number
  minExtinction: number
  minTransmittance: number
  maxIterationCountToSun: number
  minSecondaryStepSize: number
  secondaryStepScale: number
  multiScatteringOctaves: number
  shapeDetail: boolean
  turbulence: boolean
}

const BASE_MARCH: CloudMarch = {
  maxIterationCount: 500,
  minStepSize: 50,
  maxStepSize: 1000,
  maxRayDistance: 2e5,
  perspectiveStepScale: 1.01,
  minDensity: 1e-5,
  minExtinction: 1e-5,
  minTransmittance: 1e-2,
  maxIterationCountToSun: 2,
  minSecondaryStepSize: 100,
  secondaryStepScale: 2,
  multiScatteringOctaves: 8,
  shapeDetail: true,
  turbulence: true,
}

/** The library's « low », « medium » and « high » presets, march part (the export's cloud qualities). */
export const CLOUD_MARCH: Record<CloudQuality, CloudMarch> = {
  low: {
    ...BASE_MARCH,
    maxIterationCount: 200,
    minStepSize: 100,
    maxRayDistance: 1e5,
    minDensity: 1e-4,
    minExtinction: 1e-4,
    minTransmittance: 1e-1,
    maxIterationCountToSun: 1,
    shapeDetail: false,
    turbulence: false,
  },
  medium: { ...BASE_MARCH, minDensity: 1e-4, minExtinction: 1e-4, maxIterationCountToSun: 2, turbulence: false },
  high: BASE_MARCH,
}

/** What the march reads, in the units of the clouds library (metres, ECEF). */
export interface CloudParamsInput {
  /** clip space → view space */
  inverseProjection: Mat4
  /** view space → ECEF (the library's `worldToECEFMatrix` × the camera's `matrixWorld`) */
  viewToEcef: Mat4
  /** camera position in ECEF, altitude correction included */
  cameraEcef: Vec3
  /** height of the camera above the bottom radius, m */
  cameraHeight: number
  cameraNear: number
  sunDirection: Vec3
  width: number
  height: number
  /** index of the noise slice: picks the jitter */
  frame: number
  bottomRadius: number
  /** bottom of the lowest layer and top of the highest, m */
  minHeight: number
  maxHeight: number
  coverage: number
  scatteringCoefficient: number
  absorptionCoefficient: number
  skyLightScale: number
  powderScale: number
  powderExponent: number
  turbulenceDisplacement: number
  localWeatherRepeat: readonly [number, number]
  localWeatherOffset: readonly [number, number]
  shapeRepeat: Vec3
  shapeOffset: Vec3
  shapeDetailRepeat: Vec3
  shapeDetailOffset: Vec3
  turbulenceRepeat: readonly [number, number]
  minLayerHeights: Vec4
  maxLayerHeights: Vec4
  minIntervalHeights: Vec3
  maxIntervalHeights: Vec3
  densityScales: Vec4
  shapeAmounts: Vec4
  shapeDetailAmounts: Vec4
  weatherExponents: Vec4
  shapeAlteringBiases: Vec4
  coverageFilterWidths: Vec4
  densityExpTerms: Vec4
  densityExponents: Vec4
  densityLinearTerms: Vec4
  densityConstantTerms: Vec4
  /** sun and sky irradiance at the bottom and at the top of the clouds (the library's non-accurate sun and sky light) */
  sunIrradianceMin: Vec3
  sunIrradianceMax: Vec3
  skyIrradianceMin: Vec3
  skyIrradianceMax: Vec3
  march: CloudMarch
}

type Field = readonly [name: string, kind: 'mat4x4f' | 'vec4f', values: (p: CloudParamsInput) => ArrayLike<number>]

const v3 = (v: Vec3, w = 0): Vec4 => [v[0], v[1], v[2], w]
const flag = (b: boolean) => (b ? 1 : 0)

/** The fields of `Params`, in the order of the uniform buffer. Every field is 16-byte aligned (WGSL uniform layout). */
export const PARAM_FIELDS: readonly Field[] = [
  ['inverseProjection', 'mat4x4f', (p) => p.inverseProjection],
  ['viewToEcef', 'mat4x4f', (p) => p.viewToEcef],
  // xyz: camera in ECEF; w: its height
  ['camera', 'vec4f', (p) => v3(p.cameraEcef, p.cameraHeight)],
  // xyz: towards the sun; w: near plane
  ['sun', 'vec4f', (p) => v3(p.sunDirection, p.cameraNear)],
  // width, height, frame, octaves of multiple scattering
  ['frame', 'vec4f', (p) => [p.width, p.height, p.frame, p.march.multiScatteringOctaves]],
  // bottom radius, min height, max height, max ray distance
  ['radii', 'vec4f', (p) => [p.bottomRadius, p.minHeight, p.maxHeight, p.march.maxRayDistance]],
  ['march', 'vec4f', (p) => [p.march.maxIterationCount, p.march.minStepSize, p.march.maxStepSize, p.march.perspectiveStepScale]],
  // min density, min extinction, min transmittance, coverage
  ['limits', 'vec4f', (p) => [p.march.minDensity, p.march.minExtinction, p.march.minTransmittance, p.coverage]],
  // iterations towards the sun, their first step, their step growth, turbulence displacement
  ['secondary', 'vec4f', (p) => [p.march.maxIterationCountToSun, p.march.minSecondaryStepSize, p.march.secondaryStepScale, p.turbulenceDisplacement]],
  ['medium', 'vec4f', (p) => [p.scatteringCoefficient, p.absorptionCoefficient, p.skyLightScale, p.powderScale]],
  // powder exponent, shape detail on, turbulence on, unused
  ['switches', 'vec4f', (p) => [p.powderExponent, flag(p.march.shapeDetail), flag(p.march.turbulence), 0]],
  ['localWeather', 'vec4f', (p) => [...p.localWeatherRepeat, ...p.localWeatherOffset]],
  ['shapeRepeat', 'vec4f', (p) => v3(p.shapeRepeat)],
  ['shapeOffset', 'vec4f', (p) => v3(p.shapeOffset)],
  ['shapeDetailRepeat', 'vec4f', (p) => v3(p.shapeDetailRepeat)],
  ['shapeDetailOffset', 'vec4f', (p) => v3(p.shapeDetailOffset)],
  ['turbulenceRepeat', 'vec4f', (p) => [...p.turbulenceRepeat, 0, 0]],
  ['minLayerHeights', 'vec4f', (p) => p.minLayerHeights],
  ['maxLayerHeights', 'vec4f', (p) => p.maxLayerHeights],
  ['minIntervalHeights', 'vec4f', (p) => v3(p.minIntervalHeights)],
  ['maxIntervalHeights', 'vec4f', (p) => v3(p.maxIntervalHeights)],
  ['densityScales', 'vec4f', (p) => p.densityScales],
  ['shapeAmounts', 'vec4f', (p) => p.shapeAmounts],
  ['shapeDetailAmounts', 'vec4f', (p) => p.shapeDetailAmounts],
  ['weatherExponents', 'vec4f', (p) => p.weatherExponents],
  ['shapeAlteringBiases', 'vec4f', (p) => p.shapeAlteringBiases],
  ['coverageFilterWidths', 'vec4f', (p) => p.coverageFilterWidths],
  ['densityExpTerms', 'vec4f', (p) => p.densityExpTerms],
  ['densityExponents', 'vec4f', (p) => p.densityExponents],
  ['densityLinearTerms', 'vec4f', (p) => p.densityLinearTerms],
  ['densityConstantTerms', 'vec4f', (p) => p.densityConstantTerms],
  ['sunIrradianceMin', 'vec4f', (p) => v3(p.sunIrradianceMin)],
  ['sunIrradianceMax', 'vec4f', (p) => v3(p.sunIrradianceMax)],
  ['skyIrradianceMin', 'vec4f', (p) => v3(p.skyIrradianceMin)],
  ['skyIrradianceMax', 'vec4f', (p) => v3(p.skyIrradianceMax)],
]

const floatsOf = (kind: Field[1]) => (kind === 'mat4x4f' ? 16 : 4)

/** Offset of each field in floats, and the size of the buffer in bytes. */
export function paramsLayout(): { offsets: Record<string, number>; byteLength: number } {
  const offsets: Record<string, number> = {}
  let at = 0
  for (const [name, kind] of PARAM_FIELDS) {
    offsets[name] = at
    at += floatsOf(kind)
  }
  return { offsets, byteLength: at * 4 }
}

/** The WGSL declaration of `Params`, from `PARAM_FIELDS`. */
export function paramsStruct(): string {
  return `struct Params {\n${PARAM_FIELDS.map(([name, kind]) => `  ${name}: ${kind},`).join('\n')}\n}`
}

/** The uniform buffer's content for `input`. */
export function packParams(input: CloudParamsInput): Float32Array<ArrayBuffer> {
  const { offsets, byteLength } = paramsLayout()
  const data = new Float32Array(byteLength / 4)
  for (const [name, kind, values] of PARAM_FIELDS) {
    const v = values(input)
    const size = floatsOf(kind)
    if (v.length !== size) throw new Error(`${name}: ${v.length} values, ${size} expected`)
    data.set(Array.from(v), offsets[name])
  }
  return data
}

/** Workgroups of 8 × 8 texels covering `width` × `height`. */
export const WORKGROUP_SIZE = 8
export function workgroupCount(width: number, height: number): [number, number] {
  return [Math.ceil(width / WORKGROUP_SIZE), Math.ceil(height / WORKGROUP_SIZE)]
}
