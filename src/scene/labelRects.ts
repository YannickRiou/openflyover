/** Screen rectangles of the 3D labels drawn in the last frame (`Labels`), which the photo pins keep clear of (`pinLayout.ts`). */
import type { ScreenRect } from './labelModel'

let shown: readonly ScreenRect[] = []

export function setShownLabelRects(rects: readonly ScreenRect[]): void {
  shown = rects
}

export function getShownLabelRects(): readonly ScreenRect[] {
  return shown
}
