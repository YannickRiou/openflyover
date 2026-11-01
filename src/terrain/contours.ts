/** Settings of the 3D contour lines on the terrain (`settings.contours`), pure: the shader is `contourShader.ts`. */
import { isHexColor } from '../overlay/settings'

export interface ContourSettings {
  enabled: boolean
  /** altitude step between two lines (metres, before the exaggeration) */
  intervalM: number
  /** strength of the lines, 0..1 */
  opacity: number
  /** '#rrggbb' */
  color: string
}

export const CONTOUR_INTERVAL_RANGE = { min: 10, max: 500, step: 10 } as const
export const CONTOUR_OPACITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const
export const DEFAULT_CONTOURS: ContourSettings = { enabled: false, intervalM: 50, opacity: 0.6, color: '#ffffff' }

export function isValidContours(v: ContourSettings): boolean {
  return (
    v.intervalM >= CONTOUR_INTERVAL_RANGE.min &&
    v.intervalM <= CONTOUR_INTERVAL_RANGE.max &&
    v.opacity >= CONTOUR_OPACITY_RANGE.min &&
    v.opacity <= CONTOUR_OPACITY_RANGE.max &&
    isHexColor(v.color)
  )
}
