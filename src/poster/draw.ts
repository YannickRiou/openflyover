/**
 * Draws a poster on a 2D context from its layout (layout.ts) and content (content.ts): the 3D view (or, for the live
 * preview before any render, a placeholder with the track's outline), the text panel, title, subtitle, figures,
 * list of the tracks, elevation profile, weather and credits. Synchronous; the fonts must be loaded first (`loadOverlayFonts`).
 *
 * The styles take the fonts and colours of the overlay styles of the same name; each is laid out in one of six
 * arrangements (`POSTER_LAYOUTS`, boxes in layout.ts) and drawn the way it needs: Cinéma centres its text in a black
 * band with the figures on one line, Journal de bord lists the figures with dotted leaders in a paper column with a
 * map, Tableau sportif spreads big figures over the profile in a dark band.
 */
import { fillSky } from '../export/capture'
import type { MiniMapOutline } from '../overlay/data'
import {
  FRAUNCES,
  GLACIER,
  INK,
  INK_SOFT,
  JOURNAL_PAPER,
  NEON_CYAN,
  PAPER,
  PLEX,
  PLEX_CONDENSED,
  SCORE_ORANGE,
  TRAIL_RED,
  TRAIL_RED_LIGHT,
} from '../overlay/themes'
import { formatDistance, formatNumber } from '../ui/format'
import type { PosterContent, PosterProfile } from './content'
import { CREDIT_LINES, FIGURE_VALUE_SHARE, fitLines, fitText, fitTrackList, truncate } from './layout'
import type { Box, Measure, PosterLayout } from './layout'
import { POSTER_LAYOUTS } from './settings'
import type { PosterLayoutId, PosterStyleId } from './settings'

export type PosterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const LINE = '#D6CDBB'

interface Font {
  family: string
  weight: number
  uppercase?: boolean
  /** letter spacing (em) */
  tracking?: number
  italic?: boolean
}

export interface PosterTheme {
  page: string
  /** fill of the text panel (Diffusion band, Application card) */
  panel: string
  panelShadow: boolean
  /** corner radius of the panel (u) */
  panelRadius: number
  accent: string
  text: string
  textSoft: string
  rule: string
  /** hairline above the figures */
  figureRule: boolean
  title: Font
  body: Font
  number: Font
  label: Font
  profile: { area: string; line: string }
}

export const POSTER_THEMES: Record<PosterStyleId, PosterTheme> = {
  // a print on map paper: light serif title, serif figures, tracked small capitals
  editorial: {
    page: PAPER,
    panel: PAPER,
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED,
    text: INK,
    textSoft: INK_SOFT,
    rule: LINE,
    figureRule: true,
    title: { family: FRAUNCES, weight: 300 },
    body: { family: PLEX, weight: 500 },
    number: { family: FRAUNCES, weight: 500 },
    label: { family: PLEX, weight: 600, uppercase: true, tracking: 0.14 },
    profile: { area: GLACIER, line: INK },
  },
  // full-bleed view over an ink band, condensed capitals, trail-red bar
  broadcast: {
    page: INK,
    panel: INK,
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED_LIGHT,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.78)',
    rule: 'rgba(255, 255, 255, 0.18)',
    figureRule: false,
    title: { family: PLEX_CONDENSED, weight: 700, uppercase: true, tracking: 0.02 },
    body: { family: PLEX_CONDENSED, weight: 500 },
    number: { family: PLEX_CONDENSED, weight: 600 },
    label: { family: PLEX_CONDENSED, weight: 500, uppercase: true, tracking: 0.1 },
    profile: { area: 'rgba(255, 255, 255, 0.2)', line: '#FFFFFF' },
  },
  // the view over the whole poster, a pale rounded card like a navigation app
  app: {
    page: PAPER,
    panel: 'rgba(245, 242, 234, 0.96)',
    panelShadow: true,
    panelRadius: 2,
    accent: TRAIL_RED,
    text: INK,
    textSoft: INK_SOFT,
    rule: LINE,
    figureRule: false,
    title: { family: PLEX, weight: 600 },
    body: { family: PLEX, weight: 500 },
    number: { family: PLEX, weight: 600 },
    label: { family: PLEX, weight: 500 },
    profile: { area: GLACIER, line: INK },
  },
  // night neon: deep blue band under the view, cyan accent
  neon: {
    page: '#070A1A',
    panel: '#070A1A',
    panelShadow: false,
    panelRadius: 0,
    accent: NEON_CYAN,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.8)',
    rule: 'rgba(94, 240, 255, 0.35)',
    figureRule: false,
    title: { family: PLEX_CONDENSED, weight: 700, uppercase: true, tracking: 0.06 },
    body: { family: PLEX_CONDENSED, weight: 500 },
    number: { family: PLEX_CONDENSED, weight: 600 },
    label: { family: PLEX_CONDENSED, weight: 500, uppercase: true, tracking: 0.14 },
    profile: { area: 'rgba(94, 240, 255, 0.2)', line: NEON_CYAN },
  },
  // cinema: black bands, thin light serif capitals widely spaced, the figures on one line
  cinema: {
    page: '#000000',
    panel: '#000000',
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED_LIGHT,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.78)',
    rule: 'rgba(255, 255, 255, 0.25)',
    figureRule: false,
    title: { family: FRAUNCES, weight: 300, uppercase: true, tracking: 0.3 },
    body: { family: PLEX, weight: 500 },
    number: { family: PLEX, weight: 500 },
    label: { family: PLEX, weight: 500, uppercase: true, tracking: 0.2 },
    profile: { area: 'rgba(255, 255, 255, 0)', line: '#FFFFFF' },
  },
  // logbook: a cream paper column, italic serif title, the figures as a list with dotted leaders, ink line chart
  journal: {
    page: JOURNAL_PAPER,
    panel: JOURNAL_PAPER,
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED,
    text: INK,
    textSoft: INK_SOFT,
    rule: 'rgba(28, 42, 51, 0.5)',
    figureRule: false,
    title: { family: FRAUNCES, weight: 500, italic: true },
    body: { family: PLEX, weight: 500 },
    number: { family: FRAUNCES, weight: 500 },
    label: { family: PLEX, weight: 500 },
    profile: { area: 'rgba(28, 42, 51, 0)', line: INK },
  },
  // scoreboard: a dark band, the title on an orange stripe, big condensed figures over the faded profile
  tableau: {
    page: '#0C1217',
    panel: '#0C1217',
    panelShadow: false,
    panelRadius: 0,
    accent: SCORE_ORANGE,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.8)',
    rule: 'rgba(255, 255, 255, 0.2)',
    figureRule: false,
    title: { family: PLEX_CONDENSED, weight: 700, uppercase: true, tracking: 0.04 },
    body: { family: PLEX_CONDENSED, weight: 500 },
    number: { family: PLEX_CONDENSED, weight: 700 },
    label: { family: PLEX_CONDENSED, weight: 600, uppercase: true, tracking: 0.12 },
    profile: { area: 'rgba(255, 255, 255, 0.14)', line: 'rgba(255, 255, 255, 0.6)' },
  },
}

/** Font faces drawn by the posters (all embedded: they are faces of the overlay, see `OVERLAY_FONTS`). */
export const POSTER_FONTS: readonly string[] = [
  ...new Set(
    Object.values(POSTER_THEMES).flatMap((t) =>
      [t.title, t.body, t.number, t.label].map((f) => `${f.weight} 32px ${f.family}`),
    ),
  ),
]

/** The rendered 3D view, or nothing yet (preview). */
export interface PosterView {
  image: CanvasImageSource
  width: number
  height: number
}

/** Source rectangle of an image of iw × ih covering a box of bw × bh (centred crop). */
export function coverCrop(iw: number, ih: number, bw: number, bh: number): Box {
  const scale = Math.max(bw / iw, bh / ih)
  const w = bw / scale
  const h = bh / scale
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h }
}

function setFont(ctx: PosterContext, font: Font, px: number): void {
  ctx.font = `${font.italic ? 'italic ' : ''}${font.weight} ${px}px ${font.family}`
  // letterSpacing: Chrome 99+, Firefox 115+, Safari 18+; plain spacing elsewhere
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(font.tracking ?? 0) * px}px`
}

const caseOf = (text: string, font: Font) => (font.uppercase ? text.toLocaleUpperCase('fr') : text)

function measurer(ctx: PosterContext, font: Font): Measure {
  return (text, px) => {
    setFont(ctx, font, px)
    return ctx.measureText(caseOf(text, font)).width
  }
}

/** One line of text, vertically centred on `cy`. */
function text(ctx: PosterContext, value: string, x: number, cy: number, font: Font, px: number, color: string, align: CanvasTextAlign = 'left'): void {
  setFont(ctx, font, px)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(caseOf(value, font), x, cy)
}

function roundedRect(ctx: PosterContext, b: Box, r: number): void {
  const radius = Math.min(r, b.w / 2, b.h / 2)
  ctx.beginPath()
  ctx.moveTo(b.x + radius, b.y)
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, radius)
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, radius)
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, radius)
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, radius)
  ctx.closePath()
}

/** Before the first render: the sky of the export and the track seen from above, in trail red. */
function drawPlaceholder(ctx: PosterContext, box: Box, outline: MiniMapOutline | undefined, u: number): void {
  fillSky(ctx, box.x, box.y, box.w, box.h)
  if (!outline || outline.x.length < 2 || !(outline.width > 0 || outline.height > 0)) return
  const side = Math.min(box.w, box.h) * 0.6
  const scale = side / Math.max(outline.width, outline.height)
  const ox = box.x + (box.w - outline.width * scale) / 2
  const oy = box.y + (box.h - outline.height * scale) / 2
  ctx.beginPath()
  for (let i = 0; i < outline.x.length; i++) {
    const x = ox + outline.x[i] * scale
    const y = oy + outline.y[i] * scale
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = TRAIL_RED
  ctx.lineWidth = Math.max(1, 0.5 * u)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

function drawProfile(ctx: PosterContext, box: Box, profile: PosterProfile, theme: PosterTheme, labelPx: number): void {
  const label = measurer(ctx, theme.label)
  const captionH = labelPx * 1.8
  const range = `${formatNumber(profile.minEle)} – ${formatNumber(profile.maxEle)} m`
  const length = formatDistance(profile.lengthM)
  const right = fitText(label, length, box.w / 3, labelPx, labelPx * 0.6)
  const left = fitText(label, `Profil · ${range}`, box.w - label(right.text, right.px) - labelPx * 2, labelPx, labelPx * 0.6)
  text(ctx, left.text, box.x, box.y + captionH / 2, theme.label, left.px, theme.textSoft)
  text(ctx, right.text, box.x + box.w, box.y + captionH / 2, theme.label, right.px, theme.textSoft, 'right')

  plotProfile(ctx, { x: box.x, y: box.y + captionH, w: box.w, h: box.h - captionH }, profile, theme, Math.max(1, labelPx * 0.14))
}

/** The area under the profile and its ridge line in `plot` (the highest point at 92 % of its height). */
function plotProfile(ctx: PosterContext, plot: Box, profile: PosterProfile, theme: PosterTheme, lineWidth: number): void {
  const span = Math.max(100, profile.maxEle - profile.minEle)
  const low = (profile.minEle + profile.maxEle) / 2 - span / 2
  const n = profile.ele.length
  const points: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const e = profile.ele[i]
    if (Number.isNaN(e)) continue
    points.push([plot.x + (i / Math.max(1, n - 1)) * plot.w, plot.y + plot.h * (1 - ((e - low) / span) * 0.92)])
  }
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0][0], plot.y + plot.h)
  for (const [x, y] of points) ctx.lineTo(x, y)
  ctx.lineTo(points[points.length - 1][0], plot.y + plot.h)
  ctx.closePath()
  ctx.fillStyle = theme.profile.area
  ctx.fill()
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.strokeStyle = theme.profile.line
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.stroke()
}

function drawFigures(ctx: PosterContext, layout: PosterLayout, content: PosterContent, theme: PosterTheme, family: PosterLayoutId): void {
  const cells = layout.figures.slice(0, content.figures.length)
  if (cells.length === 0) return
  const number = measurer(ctx, theme.number)
  const body = measurer(ctx, theme.body)
  const label = measurer(ctx, theme.label)
  const { value: valueMax, label: labelMax } = layout.fonts
  // « Cinéma »: label and value side by side on one line, thin dots between the figures
  if (family === 'cinema') {
    cells.forEach((cell, i) => {
      const f = content.figures[i]
      const cy = cell.y + cell.h / 2
      const labelPx = labelMax * 1.1
      const valuePx = valueMax * 0.5
      const gap = labelPx * 0.9
      const unit = f.unit ? valuePx * 0.2 + body(f.unit, valuePx * 0.6) : 0
      const total = label(f.label, labelPx) + gap + number(f.value, valuePx) + unit
      const k = Math.min(1, (cell.w * 0.9) / total)
      let x = cell.x + (cell.w - total * k) / 2
      text(ctx, f.label, x, cy, theme.label, labelPx * k, theme.textSoft)
      x += (label(f.label, labelPx) + gap) * k
      text(ctx, f.value, x, cy, theme.number, valuePx * k, theme.text)
      if (f.unit) text(ctx, f.unit, x + (number(f.value, valuePx) + valuePx * 0.2) * k, cy, theme.body, valuePx * 0.6 * k, theme.textSoft)
      if (i > 0) text(ctx, '·', cell.x, cy, theme.body, valuePx * k, theme.textSoft, 'center')
    })
    return
  }
  // « Journal de bord »: one row per figure, label, dotted leader, value at the right edge
  if (family === 'journal') {
    cells.forEach((cell, i) => {
      const f = content.figures[i]
      const cy = cell.y + cell.h / 2
      const labelPx = Math.min(labelMax * 1.3, cell.h * 0.55)
      const valuePx = cell.h * 0.62
      const value = f.unit ? `${f.value} ${f.unit}` : f.value
      const valueW = number(value, valuePx)
      const labelW = label(f.label, labelPx)
      text(ctx, f.label, cell.x, cy, theme.label, labelPx, theme.text)
      text(ctx, value, cell.x + cell.w, cy, theme.number, valuePx, theme.text, 'right')
      const from = cell.x + labelW + labelPx * 0.6
      const to = cell.x + cell.w - valueW - labelPx * 0.6
      if (to > from) {
        ctx.save()
        ctx.setLineDash([layout.u * 0.1, layout.u * 0.55])
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1, layout.u * 0.2)
        ctx.strokeStyle = theme.textSoft
        ctx.beginPath()
        ctx.moveTo(from, cy + labelPx * 0.35)
        ctx.lineTo(to, cy + labelPx * 0.35)
        ctx.stroke()
        ctx.restore()
      }
    })
    return
  }
  // « Tableau sportif »: values and labels centred in their cells, the unit in the accent
  const centred = family === 'tableau'
  // one size for every value, the largest at which each one (number and unit) fits its cell
  const widthAt = (i: number, px: number) => {
    const f = content.figures[i]
    return number(f.value, px) + (f.unit ? px * 0.2 + body(f.unit, px * 0.45) : 0)
  }
  let valuePx = valueMax
  cells.forEach((cell, i) => {
    const width = widthAt(i, valueMax)
    if (width > cell.w) valuePx = Math.min(valuePx, (valueMax * cell.w) / width)
  })
  valuePx = Math.max(valueMax * 0.4, valuePx)
  if (theme.figureRule) {
    const top = cells[0].y - layout.u * 1.6
    ctx.fillStyle = theme.rule
    ctx.fillRect(cells[0].x, top, cells[cells.length - 1].x + cells[cells.length - 1].w - cells[0].x, Math.max(1, layout.u * 0.12))
  }
  cells.forEach((cell, i) => {
    const f = content.figures[i]
    const valueY = cell.y + (cell.h * FIGURE_VALUE_SHARE) / 2
    const left = centred ? cell.x + (cell.w - widthAt(i, valuePx)) / 2 : cell.x
    text(ctx, f.value, left, valueY, theme.number, valuePx, theme.text)
    if (f.unit) {
      const x = left + number(f.value, valuePx) + valuePx * 0.2
      text(ctx, f.unit, x, valueY + valuePx * 0.12, theme.body, valuePx * 0.45, centred ? theme.accent : theme.textSoft)
    }
    const fitted = fitText(label, f.label, cell.w, labelMax, labelMax * 0.6)
    const labelY = cell.y + cell.h * FIGURE_VALUE_SHARE + (cell.h * (1 - FIGURE_VALUE_SHARE)) / 2
    if (centred) text(ctx, fitted.text, cell.x + cell.w / 2, labelY, theme.label, fitted.px, theme.textSoft, 'center')
    else text(ctx, fitted.text, cell.x, labelY, theme.label, fitted.px, theme.textSoft)
  })
}

/** « Journal de bord »: the plan of the track in a thin frame, start and end dots, a small north arrow. */
function drawMap(ctx: PosterContext, box: Box, outline: MiniMapOutline | undefined, theme: PosterTheme, u: number): void {
  ctx.strokeStyle = theme.rule
  ctx.lineWidth = Math.max(1, 0.15 * u)
  ctx.strokeRect(box.x, box.y, box.w, box.h)
  if (!outline || outline.x.length < 2 || !(outline.width > 0 || outline.height > 0)) return
  const inset = 2 * u
  const scale = Math.min(
    outline.width > 0 ? (box.w - 2 * inset) / outline.width : Infinity,
    outline.height > 0 ? (box.h - 2 * inset) / outline.height : Infinity,
  )
  const ox = box.x + (box.w - outline.width * scale) / 2
  const oy = box.y + (box.h - outline.height * scale) / 2
  const n = outline.x.length
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(ox + outline.x[i] * scale, oy + outline.y[i] * scale)
    else ctx.lineTo(ox + outline.x[i] * scale, oy + outline.y[i] * scale)
  }
  ctx.strokeStyle = theme.text
  ctx.lineWidth = Math.max(1, 0.3 * u)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
  for (const [i, color] of [[0, theme.text], [n - 1, theme.accent]] as const) {
    ctx.beginPath()
    ctx.arc(ox + outline.x[i] * scale, oy + outline.y[i] * scale, 0.7 * u, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
  }
  // north arrow in the corner
  const ax = box.x + box.w - 2.2 * u
  const ay = box.y + 1.2 * u
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(ax + 0.7 * u, ay + 1.8 * u)
  ctx.lineTo(ax, ay + 1.3 * u)
  ctx.lineTo(ax - 0.7 * u, ay + 1.8 * u)
  ctx.closePath()
  ctx.fillStyle = theme.text
  ctx.fill()
  text(ctx, 'N', ax, ay + 3.4 * u, theme.label, 1.4 * u, theme.text, 'center')
}

/** The list of the tracks: a dot of each one's colour, its name, then its distance, D+ and date in aligned columns. */
function drawTrackList(ctx: PosterContext, layout: PosterLayout, content: PosterContent, theme: PosterTheme): void {
  const rows = layout.tracks.slice(0, content.tracks.length)
  if (rows.length === 0) return
  const maxPx = layout.fonts.list
  const dot = maxPx * 0.62
  const indent = maxPx * 1.1
  const body = measurer(ctx, theme.body)
  const fit = fitTrackList(body, content.tracks, rows[0].w - indent, maxPx, maxPx * 0.6)
  rows.forEach((row, i) => {
    const line = content.tracks[i]
    const cy = row.y + row.h / 2
    ctx.beginPath()
    ctx.arc(row.x + dot / 2, cy, dot / 2, 0, 2 * Math.PI)
    ctx.fillStyle = line.color
    ctx.fill()
    text(ctx, truncate(body, line.name, fit.name, fit.px), row.x + indent, cy, theme.body, fit.px, theme.text)
    // figures right-aligned in their columns, from the right edge
    let right = row.x + row.w
    for (const [value, width] of [[line.date, fit.date], [line.ascent, fit.ascent], [line.distance, fit.distance]] as const) {
      if (width === 0) continue
      if (value) text(ctx, value, right, cy, theme.body, fit.px, theme.textSoft, 'right')
      right -= width + fit.gap
    }
  })
}

/**
 * The whole poster. `view` null draws the placeholder (with `outline`, the plan of the track) in its place.
 */
export function drawPoster(
  ctx: PosterContext,
  layout: PosterLayout,
  content: PosterContent,
  style: PosterStyleId,
  view: PosterView | null,
  outline?: MiniMapOutline,
): void {
  const theme = POSTER_THEMES[style]
  const family = POSTER_LAYOUTS[style]
  const { u } = layout
  const fonts = layout.fonts
  ctx.save()
  ctx.fillStyle = theme.page
  ctx.fillRect(0, 0, layout.width, layout.height)

  // 3D view
  ctx.save()
  ctx.beginPath()
  ctx.rect(layout.view.x, layout.view.y, layout.view.w, layout.view.h)
  ctx.clip()
  if (view) {
    const crop = coverCrop(view.width, view.height, layout.view.w, layout.view.h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(view.image, crop.x, crop.y, crop.w, crop.h, layout.view.x, layout.view.y, layout.view.w, layout.view.h)
  } else drawPlaceholder(ctx, layout.view, outline, u)
  ctx.restore()

  for (const band of layout.bands) {
    ctx.fillStyle = theme.panel
    ctx.fillRect(band.x, band.y, band.w, band.h)
  }

  // text panel
  if (layout.panel) {
    ctx.save()
    roundedRect(ctx, layout.panel, theme.panelRadius * u)
    if (theme.panelShadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
      ctx.shadowBlur = 2 * u
      ctx.shadowOffsetY = 0.4 * u
    }
    ctx.fillStyle = theme.panel
    ctx.fill()
    ctx.restore()
  }
  if (layout.accentBar) {
    ctx.fillStyle = theme.accent
    const b = layout.accentBar
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }

  // « Tableau sportif »: the profile fills the band, under the figures
  const behind = family === 'tableau' && layout.panel !== null && layout.figures.length > 0 && content.profile !== undefined
  if (behind && layout.panel && content.profile) {
    const band = layout.panel
    const bar = layout.accentBar?.h ?? 0
    plotProfile(ctx, { x: band.x, y: band.y + bar + 3 * u, w: band.w, h: band.h - bar - 3 * u }, content.profile, theme, Math.max(1, u * 0.2))
  }

  // the lines of text: centred in « Cinéma », left in the others
  const align: CanvasTextAlign = family === 'cinema' ? 'center' : 'left'
  const lineX = (b: Box) => (align === 'center' ? b.x + b.w / 2 : b.x)
  if (family === 'journal') {
    // the title on up to two lines, italic, in the room of its box
    const lines = fitLines(measurer(ctx, theme.title), content.title, layout.title.w, fonts.title, fonts.title * 0.45, 2)
    const lineH = layout.title.h / 2
    lines.lines.forEach((line, i) => text(ctx, line, layout.title.x, layout.title.y + lineH * (i + 0.5), theme.title, lines.px, theme.text))
  } else {
    const title = fitText(measurer(ctx, theme.title), content.title, layout.title.w, fonts.title, fonts.title * 0.45)
    if (family === 'tableau') {
      // an accent stripe from the edge of the page to the end of the title
      const width = measurer(ctx, theme.title)(title.text, title.px)
      ctx.fillStyle = theme.accent
      ctx.fillRect(0, layout.title.y, layout.title.x + width + 3 * u, layout.title.h)
    }
    text(ctx, title.text, lineX(layout.title), layout.title.y + layout.title.h / 2, theme.title, title.px, family === 'tableau' ? '#FFFFFF' : theme.text, align)
  }

  if (layout.subtitle && content.subtitle) {
    const sub = fitText(measurer(ctx, theme.body), content.subtitle, layout.subtitle.w, fonts.subtitle, fonts.subtitle * 0.6)
    text(ctx, sub.text, lineX(layout.subtitle), layout.subtitle.y + layout.subtitle.h / 2, theme.body, sub.px, theme.textSoft, align)
  }

  drawFigures(ctx, layout, content, theme, family)
  drawTrackList(ctx, layout, content, theme)

  if (layout.map) drawMap(ctx, layout.map, content.outline ?? outline, theme, u)
  if (layout.profile && content.profile && !behind) drawProfile(ctx, layout.profile, content.profile, theme, fonts.profile)

  if (layout.weather && content.weather) {
    const weather = fitText(measurer(ctx, theme.body), content.weather, layout.weather.w, fonts.weather, fonts.weather * 0.6)
    text(ctx, weather.text, lineX(layout.weather), layout.weather.y + layout.weather.h / 2, theme.body, weather.px, theme.text, align)
  }

  // credits of the sources: required by their licences, small but legible
  const credits = layout.credits
  const creditFont: Font = { family: PLEX, weight: 500 }
  const fitted = fitLines(measurer(ctx, creditFont), content.credits.join(' · '), credits.w, fonts.credits, fonts.credits * 0.75, CREDIT_LINES)
  const lineH = credits.h / CREDIT_LINES
  fitted.lines.forEach((line, i) => text(ctx, line, lineX(credits), credits.y + lineH * (i + 0.5), creditFont, fitted.px, theme.textSoft, align))
  ctx.restore()
}
