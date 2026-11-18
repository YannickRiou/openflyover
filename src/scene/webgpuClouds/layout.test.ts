import { describe, expect, it } from 'vitest'
import { CLOUD_MARCH, PARAM_FIELDS, packParams, paramsLayout, paramsStruct, workgroupCount } from './layout'
import { BINDINGS, CLOUDS_SHADER, FINISH_BINDINGS, FINISH_SHADER, RESOLVE_BINDINGS, RESOLVE_SHADER, SHADOW_SHADER } from './shader'
import { PARAMS } from './testParams'

describe('the parameters of the WebGPU clouds', () => {
  it('lay every field on a 16-byte boundary, in the order of the WGSL struct', () => {
    const { offsets, byteLength } = paramsLayout()
    expect(byteLength % 16).toBe(0)
    for (const offset of Object.values(offsets)) expect(offset % 4).toBe(0)
    const declared = [...paramsStruct().matchAll(/^ {2}(\w+): (mat4x4f|vec4f|array<mat4x4f, 4>),$/gm)].map((m) => m[1])
    expect(declared).toEqual(PARAM_FIELDS.map(([name]) => name))
  })

  it('put each value where the shaders read it', () => {
    const data = packParams(PARAMS)
    const { offsets } = paramsLayout()
    expect(data[offsets.viewToEcef + 12]).toBe(7)
    expect(Array.from(data.subarray(offsets.camera, offsets.camera + 4))).toEqual([1, 2, 3, 500])
    expect(Array.from(data.subarray(offsets.sun, offsets.sun + 4))).toEqual([0, 0, 1, 0.5])
    expect(Array.from(data.subarray(offsets.frame, offsets.frame + 4))).toEqual([1080, 1920, 5, 8])
    expect(data[offsets.altitude + 3]).toBe(1)
    expect(data[offsets.limits + 3]).toBeCloseTo(0.55)
    expect(Array.from(data.subarray(offsets.switches, offsets.switches + 4))).toEqual([150, 1, 0, 1])
    expect(Array.from(data.subarray(offsets.ground, offsets.ground + 4))).toEqual([1, 1, 1, 1])
    expect(Array.from(data.subarray(offsets.localWeather, offsets.localWeather + 4))).toEqual([100, 100, 0.25, 0.5])
    expect(Array.from(data.subarray(offsets.shadow, offsets.shadow + 4))).toEqual([5e4, 8000, 750, 3])
    expect(Array.from(data.subarray(offsets.shadowIntervals01, offsets.shadowIntervals23 + 4)).map((v) => Math.round(v * 10) / 10)).toEqual([0, 0.1, 0.1, 0.4, 0.4, 1, 0, 0])
  })

  it('fill the missing cascades with the identity', () => {
    const data = packParams({ ...PARAMS, shadowMatrices: [PARAMS.shadowMatrices[0]] })
    const { offsets } = paramsLayout()
    expect(Array.from(data.subarray(offsets.shadowMatrices + 48, offsets.shadowMatrices + 64))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  })

  it('refuses a matrix of the wrong size', () => {
    expect(() => packParams({ ...PARAMS, inverseProjection: [1, 2, 3] })).toThrow(/inverseProjection/)
  })

  it('cover the image with workgroups of 8 × 8', () => {
    expect(workgroupCount(1080, 1920)).toEqual([135, 240])
    expect(workgroupCount(1, 9)).toEqual([1, 2])
  })

  it('march as the library presets of the export: « low » without detail nor ground bounce, « medium » without turbulence', () => {
    expect(CLOUD_MARCH.low).toMatchObject({ maxIterationCount: 200, shapeDetail: false, turbulence: false, maxIterationCountToSun: 1, maxIterationCountToGround: 0 })
    expect(CLOUD_MARCH.medium).toMatchObject({ maxIterationCount: 500, shapeDetail: true, turbulence: false, minDensity: 1e-4, maxIterationCountToGround: 1 })
    expect(CLOUD_MARCH.high).toMatchObject({ shapeDetail: true, turbulence: true, minDensity: 1e-5 })
  })
})

describe('the WGSL of the clouds', () => {
  const names = new Set(PARAM_FIELDS.map(([name]) => name))

  it.each([
    ['shadow map', SHADOW_SHADER],
    ['clouds', CLOUDS_SHADER],
  ])('%s: reads only fields of the struct', (_name, shader) => {
    const read = new Set([...shader.matchAll(/\bP\.(\w+)/g)].map((m) => m[1]))
    expect([...read].filter((name) => !names.has(name))).toEqual([])
  })

  it('declares each binding once, at the index the pipelines bind', () => {
    const bindings = (shader: string) => [...shader.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
    const common = [BINDINGS.params, BINDINGS.linearRepeat, BINDINGS.localWeather, BINDINGS.shape, BINDINGS.shapeDetail, BINDINGS.turbulence, BINDINGS.stbn, BINDINGS.regionalCoverage, BINDINGS.linearClamp]
    expect(bindings(SHADOW_SHADER)).toEqual([...common, BINDINGS.shadowOut].sort((a, b) => a - b))
    expect(bindings(CLOUDS_SHADER)).toEqual([...common, BINDINGS.shadowMap, BINDINGS.sceneDistance, BINDINGS.current, BINDINGS.depthSum].sort((a, b) => a - b))
    expect(bindings(RESOLVE_SHADER)).toEqual(Object.values(RESOLVE_BINDINGS).sort((a, b) => a - b))
    expect(bindings(FINISH_SHADER)).toEqual(Object.values(FINISH_BINDINGS).sort((a, b) => a - b))
  })

  it('keeps the regional cover of the app (cloudShaders.ts) in the weather of both', () => {
    for (const shader of [SHADOW_SHADER, CLOUDS_SHADER]) expect(shader).toContain('regionalCoverage, linearClamp, regionalUv')
  })
})
