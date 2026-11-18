import { describe, expect, it } from 'vitest'
import { CLOUD_STAGES_LABEL, CLOUD_TRIAL_LABEL, UNAVAILABLE, cloudStagesRow, cloudTrialRow, unavailableText } from './bench'
import { requestCloudGpu } from './gpu'

describe('the WebGPU clouds trial', () => {
  it('writes one line of the report: both times, the gain, the clouds alone and the card', () => {
    expect(cloudTrialRow({ webglMs: 361.2, webgpuMs: 180.4, adapter: 'apple common-3', gpuMsPerFrame: 41.6 })).toEqual([
      CLOUD_TRIAL_LABEL,
      '180 ms par image contre 361 ms, −181 ms (−50 %) ; nuages seuls 42 ms (apple common-3)',
    ])
    expect(cloudTrialRow({ webglMs: 100, webgpuMs: 120, adapter: 'x', gpuMsPerFrame: 50 })[1]).toMatch(/^120 ms par image contre 100 ms, \+20 ms \(\+20 %\)/)
  })

  it('says why the clouds stayed WebGL', () => {
    expect(cloudTrialRow({ unavailable: unavailableText('no-webgpu') })).toEqual([CLOUD_TRIAL_LABEL, UNAVAILABLE['no-webgpu']])
    expect(unavailableText('SHADOW_LENGTH')).toBe('restés en WebGL : SHADOW_LENGTH')
  })
})

describe('the stages of a WebGPU frame', () => {
  it('writes one line: the stages, the waits that are only waiting, the WebGL side', () => {
    expect(
      cloudStagesRow({ upload: 4.2, shadow: 30, march: 310.4, resolve: 55, finish: 12, readback: 40.6, waits: 18, readDistance: 25, readIrradiance: 3, rest: 90, wait: 2 }),
    ).toEqual([
      CLOUD_STAGES_LABEL,
      'ombre 30, marche 310, mélange 55, image finale 12, lecture du résultat 41, envoi de la profondeur 4 ms ; dont 18 ms d’attente seule entre les étapes ; côté WebGL : lecture de la profondeur 25, de l’éclairement 3, reste des passes 90 ms ; sans les attentes, WebGL attend le résultat 2 ms',
    ])
    expect(cloudStagesRow({ unavailable: 'x' })).toEqual([CLOUD_STAGES_LABEL, 'x'])
  })
})

describe('the WebGPU device', () => {
  const adapter = (device: unknown) => ({ info: { vendor: 'apple', architecture: 'common-3' }, requestDevice: async () => device })

  it('is missing without navigator.gpu, without an adapter, or when the device is refused', async () => {
    expect(await requestCloudGpu(undefined)).toEqual({ unavailable: 'no-webgpu' })
    expect(await requestCloudGpu({ requestAdapter: async () => null } as unknown as GPU)).toEqual({ unavailable: 'no-adapter' })
    const refused = { requestAdapter: async () => ({ ...adapter(null), requestDevice: () => Promise.reject(new Error('lost')) }) }
    expect(await requestCloudGpu(refused as unknown as GPU)).toEqual({ unavailable: 'no-device' })
  })

  it('names the card for the report', async () => {
    const device = { label: 'gpu' }
    const result = await requestCloudGpu({ requestAdapter: async () => adapter(device) } as unknown as GPU)
    expect(result).toEqual({ gpu: { device, adapter: 'apple common-3' } })
  })
})
