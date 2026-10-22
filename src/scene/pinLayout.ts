/**
 * Layout of the photo pins on the screen (« Photos sur le terrain »): pins close to each other are stacked (the picture
 * raised over the one that holds the place, on a longer post) instead of hiding each other, and a pin that cannot find a
 * free place over the 3D labels is left out. Pure: a function of the screen positions alone, so every frame of an export
 * lays out the same.
 */
import type { ScreenRect } from './labelModel'

export interface PinBox {
  id: string
  /** screen position of the foot of the post (pixels, y downwards) */
  x: number
  y: number
  /** size of the picture and height of its post (pixels) */
  w: number
  h: number
  postPx: number
  /** the photo is on screen: first served, and never moved away by a label */
  lit: boolean
  /** order among the others: higher first */
  priority: number
}

/** Most pictures stacked over each other before a pin is left out. */
export const MAX_PIN_LEVELS = 4
/** Gap kept between two stacked pictures (pixels). */
export const PIN_STACK_GAP_PX = 4

const overlaps = (a: ScreenRect, b: ScreenRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/**
 * How far each pin raises its picture over the base height of its post (pixels; 0 where the place is free), by id; null
 * for a pin with no free place within `MAX_PIN_LEVELS`. The lit pins are placed first, over the labels if need be; the
 * others yield to them and to each other, and to the 3D labels (`labels`, their rectangles on the screen) as far as a
 * raised picture stays on the screen (`minTop`): a pin that cannot clear a label stays under it rather than disappear.
 */
export function layoutPins(boxes: readonly PinBox[], labels: readonly ScreenRect[], minTop = 0): Map<string, number | null> {
  const order = [...boxes].sort((a, b) => Number(b.lit) - Number(a.lit) || b.priority - a.priority)
  const placed: ScreenRect[] = []
  const out = new Map<string, number | null>()
  const rectAt = (box: PinBox, level: number): ScreenRect => {
    const bottom = box.y - box.postPx - level * (box.h + PIN_STACK_GAP_PX)
    return { left: box.x - box.w / 2, right: box.x + box.w / 2, top: bottom - box.h, bottom }
  }
  const free = (box: PinBox, level: number, clearOfLabels: boolean): boolean => {
    const rect = rectAt(box, level)
    if (level > 0 && rect.top < minTop) return false
    return !placed.some((p) => overlaps(rect, p)) && (!clearOfLabels || !labels.some((l) => overlaps(rect, l)))
  }
  for (const box of order) {
    let lift: number | null = null
    for (const clearOfLabels of box.lit ? [false] : [true, false]) {
      for (let level = 0; level <= MAX_PIN_LEVELS && lift === null; level++) if (free(box, level, clearOfLabels)) lift = level * (box.h + PIN_STACK_GAP_PX)
      if (lift !== null) break
    }
    if (lift !== null) placed.push(rectAt(box, Math.round(lift / (box.h + PIN_STACK_GAP_PX))))
    out.set(box.id, lift)
  }
  return out
}
