/**
 * Asynchronous resources of the overlay, loaded before drawing (`drawOverlay` itself stays synchronous):
 * the web fonts of the three styles and the logo image. Also turns an image file chosen by the user into
 * the bounded PNG data URL kept in the settings.
 */
import type { OverlayAssets, OverlayImage } from './draw'
import { LOGO_MAX_SIZE_PX } from './settings'
import { OVERLAY_FONTS } from './themes'
import { t } from '../i18n'

/**
 * Resolve once the overlay fonts can be drawn. A canvas never triggers a web font download by itself, so
 * each face is requested explicitly; a face that cannot load falls back to the next family (no rejection).
 */
export async function loadOverlayFonts(fonts: FontFaceSet | undefined = globalThis.document?.fonts): Promise<void> {
  if (!fonts) return
  // with a Latin Extended letter: the latin-ext files too (Ł, ő, Č…), not only the face of a space
  await Promise.all(OVERLAY_FONTS.map((font) => fonts.load(font, 'AĀ').catch(() => [])))
  await fonts.ready
}

/** Size of an image scaled down (never up) so that its longest side is at most `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('film.error.imageUnreadable')))
    image.src = src
  })
}

/** Decoded logo for `drawOverlay` (null for an empty data URL). */
export async function loadLogo(dataUrl: string): Promise<OverlayImage | null> {
  if (!dataUrl) return null
  const image = await decode(dataUrl)
  return { image, width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * The decoded logos of the overlay, kept in step with the images in the settings: `sync` reloads them when the list
 * of images changed (a logo that cannot be read is drawn without), `onReady` is called once they are decoded.
 */
export function createLogos(onReady: () => void = () => {}) {
  let sources: readonly string[] = []
  let decoded: (OverlayImage | null)[] = []
  let disposed = false
  return {
    sync(next: readonly string[]) {
      if (next.length === sources.length && next.every((source, i) => source === sources[i])) return
      sources = next
      decoded = []
      Promise.all(next.map((source) => loadLogo(source).catch(() => null))).then((logos) => {
        if (disposed || sources !== next) return
        decoded = logos
        onReady()
      })
    },
    /** by place in the list of logos (null: none or unreadable) */
    logos: (): OverlayAssets['logos'] => decoded,
    dispose() {
      disposed = true
    },
  }
}

/** Pictures of the cards kept decoded at once: the oldest one goes when a new one comes. */
const CARD_IMAGES_KEPT = 4

/**
 * Pictures of the cards (`CardExtras.image`), decoded on first use: the returned lookup gives the picture of a data
 * URL once decoded (undefined meanwhile, or when unreadable) and calls `onReady` when one becomes available.
 */
export function createCardImages(onReady: () => void = () => {}): (dataUrl: string) => OverlayImage | undefined {
  // null: being decoded, or unreadable
  const decoded = new Map<string, OverlayImage | null>()
  return (dataUrl) => {
    if (decoded.has(dataUrl)) return decoded.get(dataUrl) ?? undefined
    decoded.set(dataUrl, null)
    if (decoded.size > CARD_IMAGES_KEPT) decoded.delete(decoded.keys().next().value as string)
    loadLogo(dataUrl)
      .then((image) => {
        if (!image || !decoded.has(dataUrl)) return
        decoded.set(dataUrl, image)
        onReady()
      })
      .catch(() => {
        // unreadable picture: the card is drawn without it
      })
    return undefined
  }
}

/** Image file (PNG, JPEG, WebP, SVG…) -> PNG data URL at most LOGO_MAX_SIZE_PX on its longest side. */
export async function fileToLogoDataUrl(file: Blob, max = LOGO_MAX_SIZE_PX): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await decode(url)
    // an SVG without intrinsic size reports 0 × 0: give it the maximum size
    const { width, height } = fitWithin(image.naturalWidth || max, image.naturalHeight || max, max)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(t('film.error.imageUnreadable'))
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
