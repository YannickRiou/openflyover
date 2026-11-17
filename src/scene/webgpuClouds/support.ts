/**
 * When the WebGPU clouds can stand in for the WebGL ones: the features of the library's pass they port (`shader.ts`).
 * The others (the export quality « Maximale » turns them on) keep the WebGL clouds, which draw them. Pure.
 */

/** The defines of the clouds and shadow map materials that matter here. */
export interface CloudConfig {
  clouds: Record<string, unknown>
  shadow: Record<string, unknown>
  temporalUpscale: boolean
  shadowTemporalPass: boolean
  cascades: number
  shadowSize: [number, number]
  perspective: boolean
}

/** Defines of a feature that is not ported: present, the WebGL clouds stay. */
const NOT_PORTED = ['ACCURATE_SUN_SKY_LIGHT', 'SHADOW_LENGTH', 'HAZE', 'ACCURATE_PHASE_FUNCTION', 'TURBULENCE'] as const

/** Why the WebGPU clouds cannot draw this configuration, null when they can. */
export function unsupportedReason(config: CloudConfig): string | null {
  for (const name of NOT_PORTED) if (config.clouds[name] !== undefined || config.shadow[name] !== undefined) return name
  const channels = config.clouds.LOCAL_WEATHER_CHANNELS
  if (channels !== undefined && channels !== 'rgba') return `LOCAL_WEATHER_CHANNELS ${String(channels)}`
  if (config.temporalUpscale) return 'temporalUpscale'
  if (config.shadowTemporalPass) return 'shadow.temporalPass'
  if (!config.perspective) return 'caméra orthographique'
  if (config.cascades < 1 || config.cascades > 4) return `${config.cascades} cascades`
  const [w, h] = config.shadowSize
  // the read back of the shadow map copies rows of 256 bytes (32 half-float RGBA texels)
  if (w !== h || w % 32 !== 0) return `ombre ${w} × ${h}`
  return null
}
