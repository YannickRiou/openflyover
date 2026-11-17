import { describe, expect, it } from 'vitest'
import { CLOUD_MARCH, PARAM_FIELDS, packParams, paramsLayout, paramsStruct, workgroupCount } from './layout'
import { BINDINGS, CLOUD_SHADER } from './shader'
import { PARAMS } from './testParams'

describe('the parameters of the WebGPU march', () => {
  it('lay every field on a 16-byte boundary, in the order of the WGSL struct', () => {
    const { offsets, byteLength } = paramsLayout()
    expect(byteLength % 16).toBe(0)
    for (const offset of Object.values(offsets)) expect(offset % 4).toBe(0)
    const declared = [...paramsStruct().matchAll(/^ {2}(\w+): (mat4x4f|vec4f),$/gm)].map((m) => m[1])
    expect(declared).toEqual(PARAM_FIELDS.map(([name]) => name))
  })

  it('put each value where the shader reads it', () => {
    const data = packParams(PARAMS)
    const { offsets } = paramsLayout()
    expect(data[offsets.viewToEcef + 12]).toBe(7)
    expect(Array.from(data.subarray(offsets.camera, offsets.camera + 4))).toEqual([1, 2, 3, 500])
    expect(Array.from(data.subarray(offsets.sun, offsets.sun + 4))).toEqual([0, 0, 1, 0.5])
    expect(Array.from(data.subarray(offsets.frame, offsets.frame + 4))).toEqual([1080, 1920, 5, 8])
    expect(data[offsets.limits + 3]).toBeCloseTo(0.55)
    expect(Array.from(data.subarray(offsets.switches, offsets.switches + 3))).toEqual([150, 1, 0])
    expect(Array.from(data.subarray(offsets.localWeather, offsets.localWeather + 4))).toEqual([100, 100, 0.25, 0.5])
  })

  it('refuses a matrix of the wrong size', () => {
    expect(() => packParams({ ...PARAMS, inverseProjection: [1, 2, 3] })).toThrow(/inverseProjection/)
  })

  it('cover the image with workgroups of 8 × 8', () => {
    expect(workgroupCount(1080, 1920)).toEqual([135, 240])
    expect(workgroupCount(1, 9)).toEqual([1, 2])
  })

  it('march as the library presets of the export: « low » without detail, « medium » without turbulence', () => {
    expect(CLOUD_MARCH.low).toMatchObject({ maxIterationCount: 200, shapeDetail: false, turbulence: false, maxIterationCountToSun: 1 })
    expect(CLOUD_MARCH.medium).toMatchObject({ maxIterationCount: 500, shapeDetail: true, turbulence: false, minDensity: 1e-4 })
    expect(CLOUD_MARCH.high).toMatchObject({ shapeDetail: true, turbulence: true, minDensity: 1e-5 })
  })
})

describe('the WGSL of the march', () => {
  it('reads only fields of the struct', () => {
    const names = new Set(PARAM_FIELDS.map(([name]) => name))
    const read = new Set([...CLOUD_SHADER.matchAll(/\bP\.(\w+)/g)].map((m) => m[1]))
    expect([...read].filter((name) => !names.has(name))).toEqual([])
  })

  it('declares each binding once, at the index the pipeline binds', () => {
    const declared = [...CLOUD_SHADER.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))
    expect(declared.sort((a, b) => a - b)).toEqual(Object.values(BINDINGS).sort((a, b) => a - b))
  })
})
