/**
 * The trial of the WebGPU clouds in « Mesurer le coût des couches » (`export/layerCostRun.ts`): the same window of the
 * film exported twice in a row, with the WebGL clouds then with the WebGPU ones (a real export each time: the frames,
 * their clouds, their composition), so that both see the same state of the device. Pure: the line of the report.
 */

/** Why the trial did not run, in the words of the report. */
export const UNAVAILABLE = {
  'no-webgpu': 'WebGPU indisponible dans ce navigateur',
  'no-adapter': 'WebGPU sans carte graphique utilisable',
  'no-device': 'WebGPU refusé par la carte graphique',
  'no-clouds': 'pas de nuages en volume dans ce projet',
} as const

/** A reason of `prepareWebgpuClouds` or of the bridge in the words of the report. */
export function unavailableText(reason: string): string {
  return reason in UNAVAILABLE ? UNAVAILABLE[reason as keyof typeof UNAVAILABLE] : `restés en WebGL : ${reason}`
}

export const CLOUD_TRIAL_LABEL = 'nuages en WebGPU (essai), la même fenêtre juste après en WebGL'

export type CloudTrialResult =
  | {
      webglMs: number
      webgpuMs: number
      adapter: string
      /** WebGPU work and read back of the clouds alone, per frame */
      gpuMsPerFrame: number
    }
  | { unavailable: string }

const comma = (n: number) => n.toFixed(0).replace('.', ',')

/** The line of the report. */
export function cloudTrialRow(result: CloudTrialResult): [string, string] {
  if ('unavailable' in result) return [CLOUD_TRIAL_LABEL, result.unavailable]
  const { webglMs, webgpuMs } = result
  const saved = webglMs - webgpuMs
  const sign = saved >= 0 ? '−' : '+'
  return [
    CLOUD_TRIAL_LABEL,
    `${comma(webgpuMs)} ms par image contre ${comma(webglMs)} ms, ${sign}${comma(Math.abs(saved))} ms (${sign}${comma((Math.abs(saved) / webglMs) * 100)} %) ; nuages seuls ${comma(result.gpuMsPerFrame)} ms (${result.adapter})`,
  ]
}
