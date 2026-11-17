/**
 * The trial of the clouds marched in WebGPU (ROADMAP « 9 »): a switch of this tab, not of the project (Réglages ›
 * Diagnostic, like « Export de test sans encodage »), off by default. Read by the export (`ExportController`); the layer
 * measure forces it on and off for its two measures.
 */
export const WEBGPU_CLOUDS_KEY = 'openflyover.export.webgpuClouds'

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): FlagStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

let forced: boolean | null = null

export function webgpuCloudsWanted(storage: FlagStorage | undefined = tabStorage()): boolean {
  if (forced !== null) return forced
  try {
    return storage?.getItem(WEBGPU_CLOUDS_KEY) === '1'
  } catch {
    return false
  }
}

export function setWebgpuCloudsWanted(on: boolean, storage: FlagStorage | undefined = tabStorage()): void {
  try {
    if (on) storage?.setItem(WEBGPU_CLOUDS_KEY, '1')
    else storage?.removeItem(WEBGPU_CLOUDS_KEY)
  } catch {
    // no storage: the switch stays off
  }
}

/** For one measure: on or off whatever the switch; null gives the switch back. */
export function forceWebgpuClouds(on: boolean | null): void {
  forced = on
}
