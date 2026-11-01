/**
 * The panel of « Donnée au-dessus du marqueur »: its text (the overlay's counter) and its picture (drawn by the overlay with
 * its own style). Kept apart from `markerValue.ts` (the settings the store imports) so the overlay's drawing code is not
 * part of the first screen.
 */
import type { OverlayFrame } from '../overlay/data'
import { counterText, drawValueTag } from '../overlay/draw'
import type { CounterText } from '../overlay/draw'
import type { OverlaySettings } from '../overlay/settings'
import type { MarkerValue } from './markerValue'

/** What the panel shows at this frame (« 142 », « bpm »); null without a figure, or when the track does not record it. */
export function markerValueText(value: MarkerValue, frame: OverlayFrame | null): CounterText | null {
  if (value === 'aucune' || !frame) return null
  return counterText(value, frame)
}

/** Canvas of the panel (pixels): a fixed size, so the texture is made once and only redrawn. */
export const VALUE_CANVAS = { width: 512, height: 128 } as const
/** Height of the figure's canvas, in ball diameters of the marker (its width follows the canvas). */
export const VALUE_PANEL_BALLS = 1.4
/** Gap between the badge and the panel, in ball diameters. */
export const VALUE_GAP_BALLS = 0.8

/**
 * What the picture of the panel depends on, besides its text: the overlay's style and overrides (colours, panel, fonts)
 * and whether the fonts are loaded (drawn again when they are, or the first picture keeps the fallback font).
 */
export function valueLookKey(overlay: Pick<OverlaySettings, 'style' | 'overrides'>): string {
  const fonts = typeof document !== 'undefined' && document.fonts ? document.fonts.status : 'none'
  return `${overlay.style}:${JSON.stringify(overlay.overrides ?? {})}:${fonts}`
}

/** Draw `text` on the panel of the overlay's style. */
export function paintValue(canvas: HTMLCanvasElement, overlay: Pick<OverlaySettings, 'style' | 'overrides'>, text: CounterText): void {
  const ctx = canvas.getContext('2d')
  if (ctx) drawValueTag(ctx, VALUE_CANVAS, overlay, text)
}
