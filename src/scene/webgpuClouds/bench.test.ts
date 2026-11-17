import { describe, expect, it } from 'vitest'
import { CLOUD_BENCH_LABEL, UNAVAILABLE, benchWebgpuClouds, cloudBenchRow, timeFrames } from './bench'
import { requestCloudGpu } from './gpu'
import { PARAMS } from './testParams'

describe('the WebGPU clouds trial', () => {
  it('times only the frames after the warm-up, and averages them', async () => {
    let clock = 0
    const ran: number[] = []
    const ms = await timeFrames(
      async (frame) => {
        ran.push(frame)
        clock += frame < 2 ? 1000 : 40
      },
      2,
      3,
      () => clock,
    )
    expect(ran).toEqual([0, 1, 2, 3, 4])
    expect(ms).toBe(40)
    await expect(timeFrames(async () => {}, 0, 0)).rejects.toThrow()
  })

  it('writes one line of the report, with the size, the slices and the card, or why it did not run', () => {
    expect(cloudBenchRow({ msPerFrame: 412.6, slices: 24, width: 1080, height: 1920, adapter: 'apple common-3' })).toEqual([
      CLOUD_BENCH_LABEL,
      '413 ms par image (1080 × 1920, 24 tranches, apple common-3)',
    ])
    expect(cloudBenchRow({ unavailable: UNAVAILABLE['no-webgpu'] })).toEqual([CLOUD_BENCH_LABEL, 'WebGPU indisponible dans ce navigateur'])
  })

  it('says that WebGPU is missing rather than failing (Node has no navigator.gpu)', async () => {
    const { frame: _frame, ...params } = PARAMS
    await expect(benchWebgpuClouds(params, 24, 1, 2, '/clouds/')).resolves.toEqual({ unavailable: UNAVAILABLE['no-webgpu'] })
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
