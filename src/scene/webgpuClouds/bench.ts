/**
 * The trial of the WebGPU clouds in « Mesurer le coût des couches » (step 1): the same noise slices as an exported frame
 * (`EXPORT_SAMPLES`), marched by the compute shader at the size of the film, timed on the device. Set beside the line
 * « sans nuages », it tells what the WebGPU march would save. The timing and the report line are pure (tested); the run
 * needs WebGPU and is loaded on demand.
 */
import type { CloudParamsInput } from './layout'

export type CloudBenchResult =
  | { msPerFrame: number; slices: number; width: number; height: number; adapter: string }
  | { unavailable: string }

/** Why the trial did not run, in the words of the report. */
export const UNAVAILABLE = {
  'no-webgpu': 'WebGPU indisponible dans ce navigateur',
  'no-adapter': 'WebGPU sans carte graphique utilisable',
  'no-device': 'WebGPU refusé par la carte graphique',
  'no-clouds': 'pas de nuages en volume dans ce projet',
} as const

export const CLOUD_BENCH_LABEL = 'nuages en WebGPU, marche seule (essai : sans ombre portée, sans brume, sans relief devant)'

/**
 * Ms per frame of `run` (one frame: all its slices, resolved once the GPU has done them), after `warm` frames that are
 * not timed (the first ones compile and fill the caches).
 */
export async function timeFrames(run: (frame: number) => Promise<void>, warm: number, frames: number, now: () => number = () => performance.now()): Promise<number> {
  if (frames < 1) throw new Error('au moins une image à mesurer')
  for (let f = 0; f < warm; f++) await run(f)
  const start = now()
  for (let f = 0; f < frames; f++) await run(warm + f)
  return (now() - start) / frames
}

const comma = (n: number) => n.toFixed(0).replace('.', ',')

/** The line of the report. */
export function cloudBenchRow(result: CloudBenchResult): [string, string] {
  if ('unavailable' in result) return [CLOUD_BENCH_LABEL, result.unavailable]
  return [CLOUD_BENCH_LABEL, `${comma(result.msPerFrame)} ms par image (${result.width} × ${result.height}, ${result.slices} tranches, ${result.adapter})`]
}

/**
 * The trial: `slices` dispatches per frame (the slice index moves the jitter, as in an export), `warm` frames then
 * `frames` timed. `params` comes from the scene's clouds (`fromEffect.ts`).
 */
export async function benchWebgpuClouds(
  params: Omit<CloudParamsInput, 'frame'>,
  slices: number,
  warm: number,
  frames: number,
  texturesUrl: string,
): Promise<CloudBenchResult> {
  const { createCloudMarcher, loadCloudTextures, requestCloudGpu } = await import('./gpu')
  const { packParams } = await import('./layout')
  const requested = await requestCloudGpu()
  if ('unavailable' in requested) return { unavailable: UNAVAILABLE[requested.unavailable] }
  const { device, adapter } = requested.gpu
  try {
    const textures = await loadCloudTextures(device, texturesUrl)
    const marcher = await createCloudMarcher(device, textures, params.width, params.height)
    const run = async (frame: number) => {
      for (let k = 0; k < slices; k++) marcher.march(packParams({ ...params, frame: frame * slices + k }))
      await marcher.done()
    }
    const msPerFrame = await timeFrames(run, warm, frames)
    marcher.destroy()
    return { msPerFrame, slices, width: params.width, height: params.height, adapter }
  } finally {
    device.destroy()
  }
}
