/** The clouds the scene draws now (set by `CloudsLayer`), for the WebGPU trial of the layer measure (`webgpuClouds/bench.ts`). */
import type { CloudsEffect } from '@takram/three-clouds'

let live: CloudsEffect | null = null

export const liveCloudsEffect = (): CloudsEffect | null => live

/** `effect` while it is mounted; `null` clears it only when it is still the one set. */
export function setLiveCloudsEffect(effect: CloudsEffect | null, previous?: CloudsEffect): void {
  if (effect !== null || previous === undefined || live === previous) live = effect
}
