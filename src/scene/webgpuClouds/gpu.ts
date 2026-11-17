/**
 * The WebGPU side of the clouds march (step 1, `shader.ts`): the device, the textures of the clouds library (served at
 * /clouds/, vite.config.ts), the compute pipeline and the dispatch of one noise slice. Nothing of it is loaded at start-up:
 * the layer measure imports it on demand (`bench.ts`).
 */
import { CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE } from '@takram/three-clouds'
import { paramsLayout, workgroupCount } from './layout'
import { BINDINGS, CLOUD_SHADER, OUTPUT_FORMAT } from './shader'

/** The usage flags of the WebGPU specification (TypeScript's DOM types declare the interfaces, not these constants). */
export const TEXTURE_USAGE = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 } as const
export const BUFFER_USAGE = { COPY_DST: 0x08, UNIFORM: 0x40 } as const

export interface CloudGpu {
  device: GPUDevice
  /** vendor and architecture, for the report */
  adapter: string
}

/** Why there is no WebGPU here, or the device. */
export type CloudGpuResult = { gpu: CloudGpu } | { unavailable: 'no-webgpu' | 'no-adapter' | 'no-device' }

/** The device for the clouds, or why there is none. `gpu`: `navigator.gpu` (injected by the tests). */
export async function requestCloudGpu(gpu: GPU | undefined = globalThis.navigator?.gpu): Promise<CloudGpuResult> {
  if (!gpu) return { unavailable: 'no-webgpu' }
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
  if (!adapter) return { unavailable: 'no-adapter' }
  const device = await adapter.requestDevice().catch(() => null)
  if (!device) return { unavailable: 'no-device' }
  const info = adapter.info
  const adapter_ = [info?.vendor, info?.architecture].filter((s) => s).join(' ') || 'carte inconnue'
  return { gpu: { device, adapter: adapter_ } }
}

export interface CloudTextures {
  localWeather: GPUTexture
  shape: GPUTexture
  shapeDetail: GPUTexture
  turbulence: GPUTexture
}

async function imageTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} : ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height])
  bitmap.close()
  return texture
}

async function volumeTexture(device: GPUDevice, url: string, size: number): Promise<GPUTexture> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} : ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.length !== size ** 3) throw new Error(`${url} : ${data.length} octets, ${size ** 3} attendus`)
  const texture = device.createTexture({
    size: [size, size, size],
    dimension: '3d',
    format: 'r8unorm',
    usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
  })
  device.queue.writeTexture({ texture }, data, { bytesPerRow: size, rowsPerImage: size }, [size, size, size])
  return texture
}

/** The four textures the library loads, from the same files. */
export async function loadCloudTextures(device: GPUDevice, baseUrl: string): Promise<CloudTextures> {
  const [localWeather, shape, shapeDetail, turbulence] = await Promise.all([
    imageTexture(device, `${baseUrl}local_weather.png`),
    volumeTexture(device, `${baseUrl}shape.bin`, CLOUD_SHAPE_TEXTURE_SIZE),
    volumeTexture(device, `${baseUrl}shape_detail.bin`, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
    imageTexture(device, `${baseUrl}turbulence.png`),
  ])
  return { localWeather, shape, shapeDetail, turbulence }
}

export interface CloudMarcher {
  /** encode and submit one noise slice with these parameters (`packParams`) */
  march(params: Float32Array<ArrayBuffer>): void
  /** resolves when everything submitted so far has run on the GPU */
  done(): Promise<void>
  /** the output: premultiplied radiance and opacity of the clouds */
  output: GPUTexture
  destroy(): void
}

/** The pipeline for `width` × `height`; throws with the compiler's messages when the shader does not compile. */
export async function createCloudMarcher(device: GPUDevice, textures: CloudTextures, width: number, height: number): Promise<CloudMarcher> {
  const module = device.createShaderModule({ code: CLOUD_SHADER })
  const info = await module.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === 'error')
  if (errors.length > 0) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'))
  device.pushErrorScope('validation')
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
  const uniforms = device.createBuffer({ size: paramsLayout().byteLength, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })
  const output = device.createTexture({
    size: [width, height],
    format: OUTPUT_FORMAT,
    usage: TEXTURE_USAGE.STORAGE_BINDING | TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_SRC,
  })
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    addressModeW: 'repeat',
  })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: BINDINGS.params, resource: { buffer: uniforms } },
      { binding: BINDINGS.sampler, resource: sampler },
      { binding: BINDINGS.localWeather, resource: textures.localWeather.createView() },
      { binding: BINDINGS.shape, resource: textures.shape.createView() },
      { binding: BINDINGS.shapeDetail, resource: textures.shapeDetail.createView() },
      { binding: BINDINGS.turbulence, resource: textures.turbulence.createView() },
      { binding: BINDINGS.output, resource: output.createView() },
    ],
  })
  const invalid = await device.popErrorScope()
  if (invalid) throw new Error(invalid.message)
  const [x, y] = workgroupCount(width, height)
  return {
    output,
    march(params) {
      device.queue.writeBuffer(uniforms, 0, params)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(x, y)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    done: () => device.queue.onSubmittedWorkDone(),
    destroy() {
      uniforms.destroy()
      output.destroy()
    },
  }
}
