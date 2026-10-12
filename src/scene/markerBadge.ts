/**
 * Marker badges drawn on a 2D canvas (no Three.js): the picture a progress marker shows — a disc (« boule ») plain,
 * ringed, with a halo or a pulse, a pictogram on a coloured disc, pin or rounded square or alone with an outline
 * (« figurine »), or a picture cut to a circle (« image ») — and around it the optional stick down to the track with
 * its shadow, and the label under it. Also turns a picture chosen by the user into the small square data URL kept
 * in the settings.
 */
import { FIGURE_GRID, MARKER_FIGURE_PATHS } from './markerFigures'
import type { MarkerBallStyle, MarkerFigure, MarkerShape } from './markerSettings'

/** `--color-ink` and white of the « Carte alpine » theme. */
export const BADGE_INK = '#1C2A33'
export const BADGE_WHITE = '#FFFFFF'

/** Ring of the figure and picture badges, as a fraction of the badge radius. */
export const BADGE_RING = 0.12
/** Side of the pictogram as a fraction of the radius: its corners stay inside the coloured disc. */
const FIGURE_SCALE = 1.15
/** Stroke of the pictograms on their 24-unit grid (the interface icons use 2; a touch bolder reads better small). */
const FIGURE_STROKE = 2.2
/** Outline of a figure drawn alone ('contour'), grid units on each side of its stroke. */
const FIGURE_OUTLINE = 1.4
/** Side of the 24-unit grid of a figure drawn alone, as a fraction of the badge side. */
const CONTOUR_SCALE = 0.92
/** Side of the stored marker picture (pixels): enough for a badge of a 4K film, small in the project file. */
export const AVATAR_SIZE_PX = 128

/** Size of a ball's drawing relative to its disc: room for the halo or the pulse around it. */
export const BALL_STYLE_SCALE: Record<MarkerBallStyle, number> = { plat: 1, anneau: 1, halo: 2.2, pulsation: 2.4 }
/** Height of a map pin relative to the diameter of its head (the tip below the head). */
export const PIN_HEIGHT = 1.45
/** Corner radius of a rounded-square badge, fraction of its half side. */
const SQUARE_CORNER = 0.45

export type Badge =
  /** `ringWidth`: fraction of the disc radius taken by the ring; `pulse`: phase in [0, 1) of a 'pulsation' */
  | { kind: 'disc'; fill: string; ring?: string; ringWidth?: number; style?: MarkerBallStyle; pulse?: number }
  | { kind: 'figure'; figure: MarkerFigure; fill: string; ring: string; mirrored: boolean; shape?: MarkerShape }
  | { kind: 'image'; image: CanvasImageSource; width: number; height: number; ring: string }

/** Builds a path from SVG path data (injectable: test environments have no `Path2D`). */
export type PathFactory = (d: string) => Path2D

const defaultPath: PathFactory = (d) => new Path2D(d)

/** Relative luminance (WCAG) of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** Ink or white, whichever reads better on `fill` (light track colours get an ink pictogram). */
export function readableInk(fill: string): string {
  return luminance(fill) > 0.3 ? BADGE_INK : BADGE_WHITE
}

/** Centred square of a `width × height` picture (the part a round badge shows). */
export function squareCrop(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

function fillCircle(ctx: CanvasRenderingContext2D, centre: number, radius: number, color: string | CanvasGradient): void {
  ctx.beginPath()
  ctx.arc(centre, centre, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** `#RRGGBB` as a CSS colour with `alpha`. */
function withAlpha(hex: string, alpha: number): string {
  const channel = (i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `rgba(${channel(0)},${channel(1)},${channel(2)},${alpha})`
}

/** Soft halo of a ball: its colour fading out from the disc to `radius`. */
function drawGlow(ctx: CanvasRenderingContext2D, centre: number, core: number, radius: number, color: string): void {
  const gradient = ctx.createRadialGradient(centre, centre, core * 0.8, centre, centre, radius)
  gradient.addColorStop(0, withAlpha(color, 0.75))
  gradient.addColorStop(1, withAlpha(color, 0))
  fillCircle(ctx, centre, radius, gradient)
}

/** Ring of a pulsing ball at `phase`: born on the disc, it widens to `radius` while it thins and fades out. */
function drawPulse(ctx: CanvasRenderingContext2D, centre: number, core: number, radius: number, color: string, phase: number): void {
  const width = core * (0.1 + 0.45 * (1 - phase))
  const outer = core + (radius - core) * (1 - (1 - phase) ** 2)
  ctx.beginPath()
  ctx.arc(centre, centre, Math.max(0, outer - width / 2), 0, Math.PI * 2)
  ctx.lineWidth = width
  ctx.strokeStyle = withAlpha(color, 0.85 * (1 - phase))
  ctx.stroke()
}

/** Outline of a map pin: a round head of radius `r` centred at (cx, cy), its tip at (cx, tipY). */
function pinPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, tipY: number): void {
  // the sides are tangent to the head
  const a = Math.acos(r / (tipY - cy))
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.arc(cx, cy, r, Math.PI / 2 + a, Math.PI / 2 - a)
  ctx.closePath()
}

/**
 * Stroke the pictogram of `figure` centred at (cx, cy), its 24-unit grid `side` pixels across, once per pass
 * (an outline under the line for a figure drawn alone).
 */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  figure: MarkerFigure,
  mirrored: boolean,
  cx: number,
  cy: number,
  side: number,
  passes: readonly { color: string; width: number }[],
  makePath: PathFactory,
): void {
  const scale = side / FIGURE_GRID
  ctx.save()
  ctx.translate(cx, cy)
  if (mirrored) ctx.scale(-1, 1)
  ctx.scale(scale, scale)
  ctx.translate(-FIGURE_GRID / 2, -FIGURE_GRID / 2)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const pass of passes) {
    ctx.lineWidth = pass.width
    ctx.strokeStyle = pass.color
    for (const d of MARKER_FIGURE_PATHS[figure]) ctx.stroke(makePath(d))
  }
  ctx.restore()
}

function drawFigureBadge(ctx: CanvasRenderingContext2D, badge: Extract<Badge, { kind: 'figure' }>, size: number, makePath: PathFactory): void {
  const centre = size / 2
  const radius = centre - 1
  const ink = [{ color: readableInk(badge.fill), width: FIGURE_STROKE }]
  switch (badge.shape ?? 'rond') {
    case 'rond':
      fillCircle(ctx, centre, radius, badge.ring)
      fillCircle(ctx, centre, radius * (1 - BADGE_RING), badge.fill)
      drawFigure(ctx, badge.figure, badge.mirrored, centre, centre, radius * FIGURE_SCALE, ink, makePath)
      return
    case 'carre': {
      const inset = radius * BADGE_RING
      ctx.beginPath()
      ctx.roundRect(1, 1, 2 * radius, 2 * radius, radius * SQUARE_CORNER)
      ctx.fillStyle = badge.ring
      ctx.fill()
      ctx.beginPath()
      ctx.roundRect(1 + inset, 1 + inset, 2 * (radius - inset), 2 * (radius - inset), (radius - inset) * SQUARE_CORNER)
      ctx.fillStyle = badge.fill
      ctx.fill()
      drawFigure(ctx, badge.figure, badge.mirrored, centre, centre, radius * FIGURE_SCALE * 1.1, ink, makePath)
      return
    }
    case 'epingle': {
      // the head as wide as the badge allows, the tip at the bottom edge
      const head = (size - 2) / (2 * PIN_HEIGHT)
      const cy = 1 + head
      pinPath(ctx, centre, cy, head, size - 1)
      ctx.fillStyle = badge.ring
      ctx.fill()
      ctx.save()
      ctx.translate(centre, cy)
      ctx.scale(1 - BADGE_RING, 1 - BADGE_RING)
      ctx.translate(-centre, -cy)
      pinPath(ctx, centre, cy, head, size - 1)
      ctx.fillStyle = badge.fill
      ctx.fill()
      ctx.restore()
      drawFigure(ctx, badge.figure, badge.mirrored, centre, cy, head * FIGURE_SCALE, ink, makePath)
      return
    }
    case 'contour':
      drawFigure(
        ctx,
        badge.figure,
        badge.mirrored,
        centre,
        centre,
        size * CONTOUR_SCALE,
        [
          { color: badge.ring, width: FIGURE_STROKE + 2 * FIGURE_OUTLINE },
          { color: badge.fill, width: FIGURE_STROKE },
        ],
        makePath,
      )
  }
}

function drawPicture(ctx: CanvasRenderingContext2D, badge: Extract<Badge, { kind: 'image' }>, centre: number, radius: number): void {
  const crop = squareCrop(badge.width, badge.height)
  ctx.save()
  ctx.beginPath()
  ctx.arc(centre, centre, radius, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(badge.image, crop.x, crop.y, crop.side, crop.side, centre - radius, centre - radius, 2 * radius, 2 * radius)
  ctx.restore()
}

/**
 * Draw `badge` in the `size × size` square at the origin, over what the canvas holds (transparent around it).
 * A ball's disc is `size / BALL_STYLE_SCALE` across, centred; a pin's tip is at the bottom edge.
 */
export function drawBadge(ctx: CanvasRenderingContext2D, size: number, badge: Badge, makePath: PathFactory = defaultPath): void {
  const centre = size / 2
  // one pixel of margin keeps the antialiased edge inside the texture
  const radius = centre - 1
  switch (badge.kind) {
    case 'disc': {
      const style = badge.style ?? 'plat'
      const core = radius / BALL_STYLE_SCALE[style]
      if (style === 'halo') drawGlow(ctx, centre, core, radius, badge.fill)
      if (style === 'pulsation') drawPulse(ctx, centre, core, radius, badge.fill, badge.pulse ?? 0)
      fillCircle(ctx, centre, core, badge.ring ?? badge.fill)
      if (badge.ring) fillCircle(ctx, centre, core * (1 - (badge.ringWidth ?? BADGE_RING)), badge.fill)
      return
    }
    case 'figure':
      drawFigureBadge(ctx, badge, size, makePath)
      return
    case 'image':
      fillCircle(ctx, centre, radius, badge.ring)
      drawPicture(ctx, badge, centre, radius * (1 - BADGE_RING))
  }
}

/** Where the track point is on a badge (fraction of its side from the top): the tip of a pin, else the centre. */
export function badgeAnchor(badge: Badge): number {
  return badge.kind === 'figure' && badge.shape === 'epingle' ? 1 : 0.5
}

/** Lowest point of what a badge draws (fraction of its side from the top): a stick starts there. */
function badgeBottom(badge: Badge): number {
  if (badge.kind === 'disc') return 0.5 + 0.5 / BALL_STYLE_SCALE[badge.style ?? 'plat']
  // the feet of a figure drawn alone stand about 22 units down its 24-unit grid
  if (badge.kind === 'figure' && badge.shape === 'contour') return 0.5 + (10 / FIGURE_GRID) * CONTOUR_SCALE
  return 1
}

// ---------------------------------------------------------------------------
// Badge with its stick and label (one texture per marker)
// ---------------------------------------------------------------------------

/** A badge and what may go with it: a stick down to the track with its shadow, a label under it. */
export interface MarkerDrawing {
  badge: Badge
  /** side of the badge's square, in ball diameters */
  diameter: number
  stick: boolean
  /** text under the marker, '' for none */
  label: string
}

/** Texture pixels per ball diameter: a figure badge (2.2 balls) gets about 280 pixels, sharp in a 4K film. */
export const PX_PER_BALL = 128
/** Visible length of the stick under the badge and its width, in ball diameters. */
const STICK_BALLS = 1.6
const STICK_WIDTH_BALLS = 0.14
/** Half axes of the shadow at the foot of the stick, in ball diameters. */
const SHADOW_BALLS = { x: 0.55, y: 0.18 }
/** Height of the label text and gap above its panel, in ball diameters. */
const LABEL_FONT_BALLS = 0.8
const LABEL_GAP_BALLS = 0.15

/** Font of the marker labels: the one of the labels on the relief (Labels.tsx). */
export function markerLabelFont(px: number): string {
  return `600 ${px}px "IBM Plex Sans", system-ui, sans-serif`
}

/** Where everything goes on the canvas of a marker (pixels, y down). */
export interface MarkerLayout {
  width: number
  height: number
  /** the badge's square: side and left edge (its top is at 0) */
  side: number
  badgeX: number
  /** the point on the track */
  anchorY: number
  /** foot of the stick, null without */
  footY: number | null
  label: { top: number; width: number; height: number; fontPx: number } | null
}

/** Width of `text` in `font` (a canvas `measureText`; injectable for tests). */
export type TextMeasure = (text: string, font: string) => number

/** Layout of a marker's canvas: the badge on top, centred; the stick, then the label, under it. */
export function markerLayout(drawing: MarkerDrawing, measure: TextMeasure): MarkerLayout {
  const side = drawing.diameter * PX_PER_BALL
  const bottom = side * badgeBottom(drawing.badge)
  const footY = drawing.stick ? bottom + STICK_BALLS * PX_PER_BALL : null
  let width = side
  let height = footY === null ? side : Math.max(side, footY + SHADOW_BALLS.y * PX_PER_BALL)
  if (footY !== null) width = Math.max(width, 2 * SHADOW_BALLS.x * PX_PER_BALL)
  let label: MarkerLayout['label'] = null
  if (drawing.label) {
    const fontPx = LABEL_FONT_BALLS * PX_PER_BALL
    const top = (footY === null ? bottom : footY + SHADOW_BALLS.y * PX_PER_BALL) + LABEL_GAP_BALLS * PX_PER_BALL
    label = { top, width: measure(drawing.label, markerLabelFont(fontPx)) + fontPx, height: 1.45 * fontPx, fontPx }
    // one pixel of margin around the panel
    width = Math.max(width, label.width + 2)
    height = top + label.height + 1
  }
  width = Math.ceil(width)
  return {
    width,
    height: Math.ceil(height),
    side,
    badgeX: (width - side) / 2,
    anchorY: footY ?? side * badgeAnchor(drawing.badge),
    footY,
    label,
  }
}

/** Draw a marker on its canvas, `layout.width × layout.height` pixels (cleared first). */
export function drawMarker(ctx: CanvasRenderingContext2D, layout: MarkerLayout, drawing: MarkerDrawing, makePath: PathFactory = defaultPath): void {
  const cx = layout.width / 2
  ctx.clearRect(0, 0, layout.width, layout.height)
  if (layout.footY !== null) {
    // soft shadow on the ground, then the stick (ink edged in white, readable on any ground) from under the badge
    const rx = SHADOW_BALLS.x * PX_PER_BALL
    ctx.save()
    ctx.translate(cx, layout.footY)
    ctx.scale(1, SHADOW_BALLS.y / SHADOW_BALLS.x)
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    shadow.addColorStop(0, 'rgba(0,0,0,0.5)')
    shadow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fillStyle = shadow
    ctx.fill()
    ctx.restore()
    const width = STICK_WIDTH_BALLS * PX_PER_BALL
    const top = layout.side * badgeBottom(drawing.badge) - width
    ctx.lineCap = 'round'
    for (const [color, w] of [
      [BADGE_WHITE, width * 1.6],
      [BADGE_INK, width],
    ] as const) {
      ctx.beginPath()
      ctx.moveTo(cx, top)
      ctx.lineTo(cx, layout.footY)
      ctx.lineWidth = w
      ctx.strokeStyle = color
      ctx.stroke()
    }
  }
  ctx.save()
  ctx.translate(layout.badgeX, 0)
  drawBadge(ctx, layout.side, drawing.badge, makePath)
  ctx.restore()
  const label = layout.label
  if (label) {
    // ink panel and white text, like the labels on the relief
    ctx.beginPath()
    ctx.roundRect(cx - label.width / 2, label.top, label.width, label.height, label.height * 0.3)
    ctx.fillStyle = withAlpha(BADGE_INK, 0.9)
    ctx.fill()
    ctx.font = markerLabelFont(label.fontPx)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = BADGE_WHITE
    ctx.fillText(drawing.label, cx, label.top + label.height / 2)
  }
}

/** Decode a picture (the data URL of `settings.marker.image`, or an object URL). */
export function loadMarkerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image illisible.'))
    image.src = src
  })
}

/** Picture file (photo, avatar) -> its centred square as a PNG data URL of AVATAR_SIZE_PX pixels. */
export async function fileToAvatarDataUrl(file: Blob, size = AVATAR_SIZE_PX): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadMarkerImage(url)
    // an SVG without intrinsic size reports 0 × 0: draw it at the target size
    const crop = squareCrop(image.naturalWidth || size, image.naturalHeight || size)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image illisible.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
