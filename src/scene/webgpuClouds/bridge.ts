/**
 * The WebGPU clouds in an exported frame (ROADMAP « 9 », step 3). The frame's composer render is split in two around
 * the pass that holds the clouds (`splitComposerRender`, called by the export while it draws a frame):
 * 1. the passes before it (the scene, its depth); then the library's update sets the uniforms of the frame without
 *    drawing, WebGL measures what the march needs (`webglSide.ts`), and the WebGPU work of the frame starts (`gpu.ts`);
 * 2. once it is done (`finishComposerRender`, awaited by the export), its result is uploaded and the rest of the passes
 *    run, the library's clouds pass reading it instead of marching (`webgpuFrameIn`, `CloudsLayer`).
 * When anything is missing (no WebGPU, a feature that is not ported, a failure), the frame is drawn the WebGL way.
 */
import { CloudsEffect } from '@takram/three-clouds'
import { EffectPass, type EffectComposer, type Pass } from 'postprocessing'
import type { Data3DTexture, DataTexture, WebGLRenderer } from 'three'
import { liveCloudsEffect } from '../liveClouds'
import { cloudDefinesOf, cloudParamsFrom, cloudUniformsOf, shadowDefinesOf } from './fromEffect'
import type { CloudFrameOutput, CloudGpu, CloudRenderer } from './gpu'
import { unsupportedReason } from './support'
import type { WebglInputPasses, WebgpuReads, WebgpuUploads } from './webglSide'

const TEXTURES_URL = `${import.meta.env.BASE_URL}clouds/`

/** The slices an export draws for a frame (set by `CloudsLayer` while it exports). */
export interface ExportPlan {
  slices(): { first: number; count: number }
  shadowEvery: number
}

const plans = new WeakMap<CloudsEffect, ExportPlan>()

export function setExportPlan(effect: CloudsEffect, plan: ExportPlan | null): void {
  if (plan) plans.set(effect, plan)
  else plans.delete(effect)
}

type GpuState =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; gpu: CloudGpu; renderer: CloudRenderer }
  | { status: 'failed'; reason: string }

let gpuState: GpuState = { status: 'idle' }
/** read through a function: TypeScript would keep the narrowing of `gpuState` across an await */
const state = (): GpuState => gpuState
/** why the last export or frame stayed WebGL, for the report */
let lastBlocker: string | null = null
export const lastWebgpuBlocker = (): string | null => lastBlocker

interface EffectState {
  reads: WebgpuReads
  inputs: WebglInputPasses
  uploads: WebgpuUploads
}

const effects = new WeakMap<CloudsEffect, EffectState>()

/** Why the clouds of `effect` stay WebGL now, null when the WebGPU ones can draw them. */
export function webgpuBlocker(effect: CloudsEffect): string | null {
  if (gpuState.status !== 'ready') return gpuState.status === 'failed' ? gpuState.reason : 'WebGPU pas prêt'
  if (!effects.has(effect)) return 'nuages non préparés'
  if (!plans.has(effect)) return "pas d'export"
  const clouds = effect.cloudsPass.currentMaterial
  return unsupportedReason({
    clouds: cloudDefinesOf(effect),
    shadow: shadowDefinesOf(effect),
    temporalUpscale: effect.temporalUpscale,
    shadowTemporalPass: effect.shadowPass.temporalPass,
    cascades: effect.shadowMaps.cascadeCount,
    shadowSize: [effect.shadowMaps.mapSize.x, effect.shadowMaps.mapSize.y],
    perspective: clouds.defines.PERSPECTIVE_CAMERA !== undefined,
  })
}

/**
 * Get the WebGPU clouds ready for the clouds the scene draws (device, textures, pipelines, the patches of the library's
 * materials). Resolves null when ready, else why not. Called before an export; the device is kept for the next ones.
 */
export async function prepareWebgpuClouds(): Promise<string | null> {
  const effect = liveCloudsEffect()
  if (!effect) return (lastBlocker = 'no-clouds')
  const noise = cloudUniformsOf(effect) as unknown as { stbnTexture?: { value: Data3DTexture | null } }
  const volume = noise.stbnTexture?.value?.image
  if (!volume) return 'bruit des nuages absent'
  if (gpuState.status === 'idle' || gpuState.status === 'failed') {
    const promise = (async () => {
      const { createCloudRenderer, loadCloudTextures, requestCloudGpu } = await import('./gpu')
      const requested = await requestCloudGpu()
      if ('unavailable' in requested) {
        gpuState = { status: 'failed', reason: requested.unavailable }
        return
      }
      const { gpu } = requested
      try {
        const textures = await loadCloudTextures(gpu.device, TEXTURES_URL, {
          data: volume.data as Uint8Array,
          width: volume.width,
          height: volume.height,
          depth: volume.depth,
        })
        const renderer = await createCloudRenderer(gpu.device, textures)
        gpuState = { status: 'ready', gpu, renderer }
        void gpu.device.lost.then((info) => {
          if (gpuState.status === 'ready' && gpuState.gpu === gpu) gpuState = { status: 'failed', reason: `WebGPU perdu : ${info.message}` }
        })
      } catch (error) {
        gpu.device.destroy()
        gpuState = { status: 'failed', reason: error instanceof Error ? error.message.split('\n')[0] : String(error) }
      }
    })()
    gpuState = { status: 'loading', promise }
    await promise
  } else if (gpuState.status === 'loading') {
    await gpuState.promise
  }
  const now = state()
  if (now.status !== 'ready') return (lastBlocker = now.status === 'failed' ? now.reason : 'WebGPU pas prêt')
  if (!effects.has(effect)) {
    const { WebglInputPasses, WebgpuUploads, patchEffect } = await import('./webglSide')
    const reads = patchEffect(effect)
    if (!reads) return (lastBlocker = 'version des nuages inattendue')
    effects.set(effect, { reads, inputs: new WebglInputPasses(effect), uploads: new WebgpuUploads() })
  }
  lastBlocker = null
  return null
}

/** The adapter in use, for the report. */
export const webgpuAdapter = (): string | null => (gpuState.status === 'ready' ? gpuState.gpu.adapter : null)

interface Pending {
  composer: EffectComposer
  delta: number | undefined
  index: number
  enabled: boolean[]
  render: (this: EffectComposer, delta?: number) => void
  effect: CloudsEffect
  job: Promise<CloudFrameOutput>
}

let pending: Pending | null = null
let drawing: CloudsEffect | null = null

/** True while the second half of a split frame draws `effect` with the WebGPU result (`CloudsLayer` then does one slice). */
export const webgpuFrameIn = (effect: CloudsEffect): boolean => drawing === effect

const effectsOf = (pass: Pass): unknown[] => (pass instanceof EffectPass ? ((pass as unknown as { effects: unknown[] }).effects ?? []) : [])

/** What the last frames cost, for the report: WebGPU work and read back, WebGL read backs and uploads. */
export const webgpuTimings = { frames: 0, gpuMs: 0, webglMs: 0 }

/**
 * Draw the first half of the frame and start its WebGPU clouds. False when the frame cannot be split: `render` (the
 * composer's own) has not been called then, the caller draws the frame whole.
 */
export function splitComposerRender(composer: EffectComposer, delta: number | undefined, render: Pending['render']): boolean {
  if (pending) return false
  const effect = liveCloudsEffect()
  if (!effect) return false
  const blocker = webgpuBlocker(effect)
  if (blocker !== null || gpuState.status !== 'ready') {
    lastBlocker = blocker
    return false
  }
  const state = effects.get(effect)!
  const passes = composer.passes
  const index = passes.findIndex((pass) => pass.enabled && effectsOf(pass).includes(effect))
  // the passes before must draw into the composer's input buffer (the scene), not swap it
  if (index <= 0 || passes.slice(0, index).some((pass) => pass.enabled && pass.needsSwap)) return false
  const enabled = passes.map((pass) => pass.enabled)
  passes.forEach((pass, i) => (pass.enabled = enabled[i] && i < index))
  try {
    render.call(composer, delta)
  } finally {
    passes.forEach((pass, i) => (pass.enabled = enabled[i]))
  }
  const start = performance.now()
  const renderer = composer.getRenderer()
  let job: Promise<CloudFrameOutput>
  try {
    updateWithoutDrawing(effect, renderer)
    const size = (effect.cloudsPass.currentMaterial.uniforms as unknown as { resolution: { value: { x: number; y: number } } }).resolution.value
    const width = size.x
    const height = size.y
    const inputs = state.inputs.read(renderer, width, height)
    const params = cloudParamsFrom(effect, effect.mainCamera, width, height, inputs.irradiances)
    const regional = cloudUniformsOf(effect).regionalCoverage?.value as DataTexture | undefined
    const plan = plans.get(effect)!
    const slices = plan.slices()
    webgpuTimings.webglMs += performance.now() - start
    job = gpuState.renderer.render({
      params,
      sceneDistance: inputs.sceneDistance,
      regional: { data: (regional?.image.data as Uint8Array | undefined) ?? new Uint8Array(4), size: regional?.image.width ?? 1 },
      // the WebGL slices set the frame to first + k before the library's update adds one (CloudsLayer)
      firstSlice: slices.first + 1,
      slices: slices.count,
      shadowEvery: plan.shadowEvery,
    })
  } catch (error) {
    job = Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  pending = { composer, delta, index, enabled, render, effect, job }
  return true
}

/** The library's update for this frame (camera, sun, layers, shadow cascades, uniforms) without any of its draws. */
function updateWithoutDrawing(effect: CloudsEffect, renderer: WebGLRenderer): void {
  const noDraw = () => {}
  const passes = [effect.cloudsPass.currentPass, effect.cloudsPass.resolvePass, effect.shadowPass.currentPass, effect.shadowPass.resolvePass]
  for (const pass of passes) Reflect.set(pass, 'render', noDraw)
  try {
    CloudsEffect.prototype.update.call(effect, renderer, null as never, 0)
  } finally {
    for (const pass of passes) Reflect.deleteProperty(pass, 'render')
  }
}

/**
 * Wait for the WebGPU clouds of the split frame and draw its second half. A failure draws it the WebGL way and keeps
 * the clouds WebGL for the rest of the session (`webgpuBlocker`). Nothing to do when no frame is split.
 */
export async function finishComposerRender(): Promise<void> {
  const p = pending
  if (!p) return
  pending = null
  const state = effects.get(p.effect)
  let output: CloudFrameOutput | null = null
  try {
    output = await p.job
  } catch (error) {
    gpuState = { status: 'failed', reason: error instanceof Error ? error.message.split('\n')[0] : String(error) }
    lastBlocker = gpuState.reason
  }
  const start = performance.now()
  if (output && state) {
    state.uploads.apply(output, state.reads)
    state.reads.mode.value = 1
    drawing = p.effect
    webgpuTimings.frames++
    webgpuTimings.gpuMs += output.gpuMs
  }
  const passes = p.composer.passes
  passes.forEach((pass, i) => (pass.enabled = p.enabled[i] && i >= p.index))
  try {
    p.render.call(p.composer, p.delta)
  } finally {
    passes.forEach((pass, i) => (pass.enabled = p.enabled[i]))
    if (state) state.reads.mode.value = 0
    drawing = null
    webgpuTimings.webglMs += performance.now() - start
  }
}

/** Drop a split frame that will not be finished (the export stopped). */
export function dropComposerRender(): void {
  pending = null
}
