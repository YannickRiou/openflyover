/**
 * The WebGPU side of the clouds (`shader.ts`): the device, the textures of the clouds library (served at /clouds/,
 * vite.config.ts) and the app's noise, the four pipelines, and the work of one exported frame: the slices of the shadow
 * map and of the clouds, their average, read back for WebGL (`webglSide.ts`). Nothing of it is loaded at start-up.
 */
import { CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, CLOUD_SHAPE_TEXTURE_SIZE } from '@takram/three-clouds'
import { MAX_CASCADES, packParams, paramsLayout, workgroupCount, type CloudParamsInput } from './layout'
import { BINDINGS, CLOUDS_SHADER, FINISH_BINDINGS, FINISH_SHADER, MIP_SHADER, RESOLVE_BINDINGS, RESOLVE_SHADER, SHADOW_FORMAT, SHADOW_SHADER } from './shader'

/** The usage flags of the WebGPU specification (TypeScript's DOM types declare the interfaces, not these constants). */
export const TEXTURE_USAGE = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 } as const
export const BUFFER_USAGE = { MAP_READ: 0x01, COPY_SRC: 0x04, COPY_DST: 0x08, UNIFORM: 0x40, STORAGE: 0x80 } as const
const MAP_MODE_READ = 0x01

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
  const name = [info?.vendor, info?.architecture].filter((s) => s).join(' ') || 'carte inconnue'
  return { gpu: { device, adapter: name } }
}

export interface CloudTextures {
  localWeather: GPUTexture
  shape: GPUTexture
  shapeDetail: GPUTexture
  turbulence: GPUTexture
  stbn: GPUTexture
}

const mipCount = (width: number, height: number) => Math.floor(Math.log2(Math.max(width, height))) + 1

/** An image with its mips, halved by `MIP_SHADER` (WebGL's generateMipmap on the library's textures). */
async function imageTexture(device: GPUDevice, url: string, mips: GPUComputePipeline): Promise<GPUTexture> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} : ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const levels = mipCount(bitmap.width, bitmap.height)
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    mipLevelCount: levels,
    usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.STORAGE_BINDING,
  })
  // three.js loads images flipped (`Texture.flipY`, true for the library's TextureLoader): the same rows at the same UV
  device.queue.copyExternalImageToTexture({ source: bitmap, flipY: true }, { texture }, [bitmap.width, bitmap.height])
  const encoder = device.createCommandEncoder()
  for (let level = 1; level < levels; level++) {
    const pass = encoder.beginComputePass()
    pass.setPipeline(mips)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: mips.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
        ],
      }),
    )
    const [x, y] = workgroupCount(Math.max(1, bitmap.width >> level), Math.max(1, bitmap.height >> level))
    pass.dispatchWorkgroups(x, y)
    pass.end()
  }
  device.queue.submit([encoder.finish()])
  bitmap.close()
  return texture
}

function volumeTexture(device: GPUDevice, data: Uint8Array, width: number, height: number, depth: number): GPUTexture {
  if (data.length !== width * height * depth) throw new Error(`volume : ${data.length} octets, ${width * height * depth} attendus`)
  const texture = device.createTexture({
    size: [width, height, depth],
    dimension: '3d',
    format: 'r8unorm',
    usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
  })
  device.queue.writeTexture({ texture }, data as Uint8Array<ArrayBuffer>, { bytesPerRow: width, rowsPerImage: height }, [width, height, depth])
  return texture
}

async function volumeFile(device: GPUDevice, url: string, size: number): Promise<GPUTexture> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} : ${response.status}`)
  return volumeTexture(device, new Uint8Array(await response.arrayBuffer()), size, size, size)
}

/** The noise of the march (`cloudNoise.ts`), as WebGL has it. */
export interface NoiseVolume {
  data: Uint8Array
  width: number
  height: number
  depth: number
}

async function compile(device: GPUDevice, code: string): Promise<GPUComputePipeline> {
  const module = device.createShaderModule({ code })
  const info = await module.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === 'error')
  if (errors.length > 0) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'))
  return device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
}

/** The four textures the library loads, from the same files, and the app's noise. */
export async function loadCloudTextures(device: GPUDevice, baseUrl: string, noise: NoiseVolume): Promise<CloudTextures> {
  const mips = await compile(device, MIP_SHADER)
  const [localWeather, shape, shapeDetail, turbulence] = await Promise.all([
    imageTexture(device, `${baseUrl}local_weather.png`, mips),
    volumeFile(device, `${baseUrl}shape.bin`, CLOUD_SHAPE_TEXTURE_SIZE),
    volumeFile(device, `${baseUrl}shape_detail.bin`, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE),
    imageTexture(device, `${baseUrl}turbulence.png`, mips),
  ])
  const stbn = volumeTexture(device, noise.data, noise.width, noise.height, noise.depth)
  return { localWeather, shape, shapeDetail, turbulence, stbn }
}

/** The cover that varies over the scene (`regionalCoverage` of `cloudShaders.ts`): RGBA8, one layer per channel. */
export interface RegionalField {
  data: Uint8Array
  size: number
}

/** What a frame needs beyond the parameters. */
export interface CloudFrameInput {
  params: Omit<CloudParamsInput, 'frame' | 'firstSlice'>
  /** ray distance to the relief per texel (0: none), row 0 at the bottom */
  sceneDistance: Float32Array
  regional: RegionalField
  /** noise slices of the frame: their first index and their count */
  firstSlice: number
  slices: number
  /** the shadow map is marched again every `shadowEvery` slices (a phone: 4), kept in between */
  shadowEvery: number
}

/** The frame, in the layouts WebGL uploads (`webglSide.ts`). */
export interface CloudFrameOutput {
  width: number
  height: number
  /** premultiplied radiance and opacity, half floats, RGBA */
  color: Uint16Array
  /** front depth from the start of the ray, -1 where no slice met clouds */
  frontDepth: Float32Array
  /** the shadow map of the last slice, half floats RGBA, `cascades` layers of `shadowSize`² */
  shadow: Uint16Array
  shadowSize: number
  cascades: number
  /** wall time of the GPU work and the read back, ms */
  gpuMs: number
}

export interface CloudRenderer {
  render(input: CloudFrameInput): Promise<CloudFrameOutput>
  destroy(): void
}

interface Sized {
  width: number
  height: number
  shadowSize: number
  sceneDistance: GPUBuffer
  current: GPUBuffer
  resolved: GPUBuffer
  depthSum: GPUBuffer
  color: GPUBuffer
  depth: GPUBuffer
  colorRead: GPUBuffer
  depthRead: GPUBuffer
  shadowRead: GPUBuffer
  shadow: GPUTexture
  shadowBindGroup: GPUBindGroup
  cloudsBindGroup: GPUBindGroup
  resolveBindGroups: GPUBindGroup[]
  finishBindGroup: GPUBindGroup
}

/** Most slices of a frame (the library's « high »: 32), each with its own resolve weight. */
const MAX_SLICES = 64

/** The pipelines and the buffers of the frames (sized on the first frame, again when the size changes). */
export async function createCloudRenderer(device: GPUDevice, textures: CloudTextures): Promise<CloudRenderer> {
  device.pushErrorScope('validation')
  const [shadowPipeline, cloudsPipeline, resolvePipeline, finishPipeline] = await Promise.all([
    compile(device, SHADOW_SHADER),
    compile(device, CLOUDS_SHADER),
    compile(device, RESOLVE_SHADER),
    compile(device, FINISH_SHADER),
  ])
  const uniforms = device.createBuffer({ size: paramsLayout().byteLength, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })
  const finishUniforms = device.createBuffer({ size: 16, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })
  // one small uniform per slice for the resolve weight: written once per frame, bound by slice (256-byte offsets)
  const resolveUniforms = device.createBuffer({ size: 256 * MAX_SLICES, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST })
  const sampler = (address: GPUAddressMode) =>
    device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: address, addressModeV: address, addressModeW: address })
  const linearRepeat = sampler('repeat')
  const linearClamp = sampler('clamp-to-edge')
  let regionalTexture: GPUTexture | null = null
  let regionalData: Uint8Array | null = null
  const invalid = await device.popErrorScope()
  if (invalid) throw new Error(invalid.message)

  let sized: Sized | null = null

  const common = (regional: GPUTexture): GPUBindGroupEntry[] => [
    { binding: BINDINGS.params, resource: { buffer: uniforms } },
    { binding: BINDINGS.linearRepeat, resource: linearRepeat },
    { binding: BINDINGS.localWeather, resource: textures.localWeather.createView() },
    { binding: BINDINGS.shape, resource: textures.shape.createView() },
    { binding: BINDINGS.shapeDetail, resource: textures.shapeDetail.createView() },
    { binding: BINDINGS.turbulence, resource: textures.turbulence.createView() },
    { binding: BINDINGS.stbn, resource: textures.stbn.createView() },
    { binding: BINDINGS.regionalCoverage, resource: regional.createView() },
    { binding: BINDINGS.linearClamp, resource: linearClamp },
  ]

  const destroySized = (s: Sized) => {
    for (const b of [s.sceneDistance, s.current, s.resolved, s.depthSum, s.color, s.depth, s.colorRead, s.depthRead, s.shadowRead]) b.destroy()
    s.shadow.destroy()
  }

  const regionalOf = (field: RegionalField): GPUTexture => {
    if (!regionalTexture || regionalTexture.width !== field.size) {
      regionalTexture?.destroy()
      regionalTexture = device.createTexture({ size: [field.size, field.size], format: 'rgba8unorm', usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST })
      regionalData = null
      if (sized) destroySized(sized)
      sized = null
    }
    if (regionalData === null || regionalData.length !== field.data.length || field.data.some((v, i) => v !== regionalData![i])) {
      device.queue.writeTexture({ texture: regionalTexture }, field.data as Uint8Array<ArrayBuffer>, { bytesPerRow: field.size * 4 }, [field.size, field.size])
      regionalData = field.data.slice()
    }
    return regionalTexture
  }

  const sizeFor = (width: number, height: number, shadowSize: number, regional: GPUTexture): Sized => {
    if (sized && sized.width === width && sized.height === height && sized.shadowSize === shadowSize) return sized
    if (sized) destroySized(sized)
    const texels = width * height
    const buffer = (bytes: number, usage: number) => device.createBuffer({ size: bytes, usage })
    const storage = BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST
    const shadow = device.createTexture({
      size: [shadowSize, shadowSize, MAX_CASCADES],
      format: SHADOW_FORMAT,
      usage: TEXTURE_USAGE.STORAGE_BINDING | TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_SRC,
    })
    const s: Omit<Sized, 'shadowBindGroup' | 'cloudsBindGroup' | 'resolveBindGroups' | 'finishBindGroup'> = {
      width,
      height,
      shadowSize,
      sceneDistance: buffer(texels * 4, storage),
      current: buffer(texels * 16, storage),
      resolved: buffer(texels * 16, storage),
      depthSum: buffer(texels * 8, storage),
      color: buffer(texels * 8, storage),
      depth: buffer(texels * 4, storage),
      colorRead: buffer(texels * 8, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST),
      depthRead: buffer(texels * 4, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST),
      shadowRead: buffer(shadowSize * shadowSize * 8 * MAX_CASCADES, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST),
      shadow,
    }
    sized = {
      ...s,
      shadowBindGroup: device.createBindGroup({
        layout: shadowPipeline.getBindGroupLayout(0),
        entries: [...common(regional), { binding: BINDINGS.shadowOut, resource: shadow.createView({ dimension: '2d-array' }) }],
      }),
      cloudsBindGroup: device.createBindGroup({
        layout: cloudsPipeline.getBindGroupLayout(0),
        entries: [
          ...common(regional),
          { binding: BINDINGS.shadowMap, resource: shadow.createView({ dimension: '2d-array' }) },
          { binding: BINDINGS.sceneDistance, resource: { buffer: s.sceneDistance } },
          { binding: BINDINGS.current, resource: { buffer: s.current } },
          { binding: BINDINGS.depthSum, resource: { buffer: s.depthSum } },
        ],
      }),
      resolveBindGroups: Array.from({ length: MAX_SLICES }, (_, k) =>
        device.createBindGroup({
          layout: resolvePipeline.getBindGroupLayout(0),
          entries: [
            { binding: RESOLVE_BINDINGS.params, resource: { buffer: resolveUniforms, offset: k * 256, size: 16 } },
            { binding: RESOLVE_BINDINGS.current, resource: { buffer: s.current } },
            { binding: RESOLVE_BINDINGS.resolved, resource: { buffer: s.resolved } },
          ],
        }),
      ),
      finishBindGroup: device.createBindGroup({
        layout: finishPipeline.getBindGroupLayout(0),
        entries: [
          { binding: FINISH_BINDINGS.params, resource: { buffer: finishUniforms } },
          { binding: FINISH_BINDINGS.resolved, resource: { buffer: s.resolved } },
          { binding: FINISH_BINDINGS.depthSum, resource: { buffer: s.depthSum } },
          { binding: FINISH_BINDINGS.color, resource: { buffer: s.color } },
          { binding: FINISH_BINDINGS.depth, resource: { buffer: s.depth } },
        ],
      }),
    }
    return sized
  }

  return {
    async render(input) {
      const start = performance.now()
      const { params } = input
      const { width, height, shadowSize, cascadeCount } = params
      if (cascadeCount < 1 || cascadeCount > MAX_CASCADES) throw new Error(`${cascadeCount} cascades`)
      if (input.sceneDistance.length !== width * height) throw new Error('profondeur de la scène : taille')
      const s = sizeFor(width, height, shadowSize, regionalOf(input.regional))
      device.queue.writeBuffer(s.sceneDistance, 0, input.sceneDistance as Float32Array<ArrayBuffer>)
      const [cx, cy] = workgroupCount(width, height)
      const [sx, sy] = workgroupCount(shadowSize, shadowSize)
      if (input.slices < 1 || input.slices > MAX_SLICES) throw new Error(`${input.slices} tranches`)
      const weights = new ArrayBuffer(256 * input.slices)
      for (let k = 0; k < input.slices; k++) {
        new Uint32Array(weights, k * 256, 2).set([width, height])
        new Float32Array(weights, k * 256 + 8, 1)[0] = 1 / (k + 1)
      }
      device.queue.writeBuffer(resolveUniforms, 0, weights)
      for (let k = 0; k < input.slices; k++) {
        device.queue.writeBuffer(uniforms, 0, packParams({ ...params, frame: input.firstSlice + k, firstSlice: k === 0 }))
        const encoder = device.createCommandEncoder()
        if (k % Math.max(1, input.shadowEvery) === 0) {
          const pass = encoder.beginComputePass()
          pass.setPipeline(shadowPipeline)
          pass.setBindGroup(0, s.shadowBindGroup)
          pass.dispatchWorkgroups(sx, sy, cascadeCount)
          pass.end()
        }
        const pass = encoder.beginComputePass()
        pass.setPipeline(cloudsPipeline)
        pass.setBindGroup(0, s.cloudsBindGroup)
        pass.dispatchWorkgroups(cx, cy)
        pass.end()
        const resolve = encoder.beginComputePass()
        resolve.setPipeline(resolvePipeline)
        resolve.setBindGroup(0, s.resolveBindGroups[k])
        resolve.dispatchWorkgroups(cx, cy)
        resolve.end()
        device.queue.submit([encoder.finish()])
      }
      device.queue.writeBuffer(finishUniforms, 0, new Uint32Array([width, height, 0, 0]))
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(finishPipeline)
      pass.setBindGroup(0, s.finishBindGroup)
      pass.dispatchWorkgroups(cx, cy)
      pass.end()
      encoder.copyBufferToBuffer(s.color, 0, s.colorRead, 0, width * height * 8)
      encoder.copyBufferToBuffer(s.depth, 0, s.depthRead, 0, width * height * 4)
      encoder.copyTextureToBuffer(
        { texture: s.shadow },
        { buffer: s.shadowRead, bytesPerRow: shadowSize * 8, rowsPerImage: shadowSize },
        [shadowSize, shadowSize, cascadeCount],
      )
      device.queue.submit([encoder.finish()])
      await Promise.all([s.colorRead.mapAsync(MAP_MODE_READ), s.depthRead.mapAsync(MAP_MODE_READ), s.shadowRead.mapAsync(MAP_MODE_READ)])
      const color = new Uint16Array(s.colorRead.getMappedRange().slice(0))
      const frontDepth = new Float32Array(s.depthRead.getMappedRange().slice(0))
      const shadow = new Uint16Array(s.shadowRead.getMappedRange(0, shadowSize * shadowSize * 8 * cascadeCount).slice(0))
      s.colorRead.unmap()
      s.depthRead.unmap()
      s.shadowRead.unmap()
      return { width, height, color, frontDepth, shadow, shadowSize, cascades: cascadeCount, gpuMs: performance.now() - start }
    },
    destroy() {
      if (sized) destroySized(sized)
      sized = null
      regionalTexture?.destroy()
      uniforms.destroy()
      finishUniforms.destroy()
      resolveUniforms.destroy()
    },
  }
}
