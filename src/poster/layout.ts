/**
 * Poster layout as pure functions: boxes in pixels for the 3D view, the text panel and each text row, and text fitting
 * (shrunk, then cut with « … »). The box geometry depends only on the size, the style and which rows are present, never
 * on measured text: the size of the 3D view to render is known before the fonts are measured, and the drawing cannot
 * push a row onto its neighbour. See ARCHITECTURE.md "Poster".
 *
 * Units: 1 u = 1 % of the shorter side. Portrait and square posters stack the view above the text; landscape ones put
 * the text in a column beside the view.
 */
import { POSTER_LAYOUTS } from './settings'
import type { PosterStyleId } from './settings'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Rows present on the poster. */
export interface PosterRows {
  subtitle: boolean
  figures: number
  profile: boolean
  weather: boolean
  /** lines of the list of tracks (0 = no list) */
  tracks: number
  /** a map of the track (the paper column of « Journal de bord »); absent = none */
  map?: boolean
}

export interface PosterFonts {
  title: number
  subtitle: number
  value: number
  label: number
  profile: number
  weather: number
  list: number
  credits: number
}

export interface PosterLayout {
  width: number
  height: number
  /** 1 % of the shorter side (px) */
  u: number
  /** landscape: text column beside the view */
  side: boolean
  /** where the 3D view goes (whole pixels: its render size) */
  view: Box
  /** backing of the text: ink band or column (Diffusion), paper card (Application), band (Cinéma, Tableau), column (Journal); null = the page (Éditorial) */
  panel: Box | null
  /** black bands beyond the panel (the thin upper one of Cinéma) */
  bands: Box[]
  /** trail-red bar on the panel's leading edge (Diffusion) */
  accentBar: Box | null
  title: Box
  subtitle: Box | null
  figures: Box[]
  profile: Box | null
  weather: Box | null
  /** room of the map (Journal), when the column has any */
  map: Box | null
  /** one row per listed track, column after column */
  tracks: Box[]
  credits: Box
  /** largest font size of each row (px): drawing shrinks a text until it fits */
  fonts: PosterFonts
}

/** Lines of the credits at most (then smaller, then cut). */
export const CREDIT_LINES = 2
/** Above this width / height ratio, the text goes in a column beside the view. */
export const SIDE_RATIO = 1.15

const ELLIPSIS = '…'

/** Heights (u) of the rows and the gaps between them, at scale 1 (portrait). */
const ROW = {
  title: 10,
  afterTitle: 1,
  subtitle: 3.6,
  group: 3.5,
  figure: 9,
  figureGap: 2,
  profile: 12,
  weather: 3,
  track: 3,
  trackColumnGap: 4,
  credits: CREDIT_LINES * 1.6,
} as const

/** Shares of a figure cell: the value on top, its label under it. */
export const FIGURE_VALUE_SHARE = 0.68

function fontsAt(u: number, s: number): PosterFonts {
  return {
    title: 8 * u * s,
    subtitle: 2.6 * u * s,
    value: 5.4 * u * s,
    label: 1.6 * u * s,
    profile: 1.6 * u * s,
    weather: 2.1 * u * s,
    list: 1.9 * u * s,
    // the credits keep their size: they must stay legible
    credits: 1.15 * u,
  }
}

interface Stacked {
  title: Box
  subtitle: Box | null
  figures: Box[]
  profile: Box | null
  weather: Box | null
  map: Box | null
  tracks: Box[]
  credits: Box
  height: number
}

/** Cells per row of the figures, columns of the list of tracks. */
interface Columns {
  figures: number
  tracks: number
}

/** Row heights of an arrangement with its own rhythm, relative to the default (1), and the height (px) of a map row (0 = none). */
interface Tune {
  title?: number
  figure?: number
  profile?: number
  group?: number
  map?: number
}

/** `count` boxes in `columns` columns of rows `rowH` high from (x, y), filled column after column. */
function grid(count: number, columns: number, x: number, y: number, w: number, rowH: number, gap: number): Box[] {
  const lines = Math.ceil(count / columns)
  const cellW = (w - (columns - 1) * gap) / columns
  return Array.from({ length: count }, (_, i) => ({
    x: x + Math.floor(i / lines) * (cellW + gap),
    y: y + (i % lines) * rowH,
    w: cellW,
    h: rowH,
  }))
}

/**
 * Text rows from top to bottom in a column at (x, y) of width w, with `columns` figure cells per row and list
 * columns; `bottom`, when given, pins the credits to that edge (else they follow the other rows).
 */
function stackRows(rows: PosterRows, x: number, y: number, w: number, u: number, s: number, columns: Columns, bottom?: number, tune: Tune = {}): Stacked {
  const group = ROW.group * u * s * (tune.group ?? 1)
  const figureScale = tune.figure ?? 1
  let cursor = y
  const take = (h: number): Box => {
    const box = { x, y: cursor, w, h }
    cursor += h
    return box
  }
  const title = take(ROW.title * u * s * (tune.title ?? 1))
  let subtitle: Box | null = null
  if (rows.subtitle) {
    cursor += ROW.afterTitle * u * s
    subtitle = take(ROW.subtitle * u * s)
  }
  const figures: Box[] = []
  if (rows.figures > 0) {
    cursor += group
    const perRow = Math.min(columns.figures, rows.figures)
    const gap = ROW.figureGap * u * s * figureScale
    const cellW = (w - (perRow - 1) * gap) / perRow
    const cellH = ROW.figure * u * s * figureScale
    const lines = Math.ceil(rows.figures / perRow)
    for (let i = 0; i < rows.figures; i++) {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      figures.push({ x: x + col * (cellW + gap), y: cursor + row * (cellH + gap), w: cellW, h: cellH })
    }
    cursor += lines * cellH + (lines - 1) * gap
  }
  let tracks: Box[] = []
  if (rows.tracks > 0) {
    cursor += group
    const listColumns = Math.min(columns.tracks, rows.tracks)
    const rowH = ROW.track * u * s
    tracks = grid(rows.tracks, listColumns, x, cursor, w, rowH, ROW.trackColumnGap * u * s)
    cursor += Math.ceil(rows.tracks / listColumns) * rowH
  }
  let map: Box | null = null
  if (tune.map) {
    cursor += group
    map = take(tune.map)
  }
  let profile: Box | null = null
  if (rows.profile) {
    cursor += group
    profile = take(ROW.profile * u * s * (tune.profile ?? 1))
  }
  let weather: Box | null = null
  if (rows.weather) {
    cursor += group * 0.7
    weather = take(ROW.weather * u * s)
  }
  const creditsH = ROW.credits * u
  cursor += group * 0.7
  const credits = bottom === undefined ? take(creditsH) : { x, y: Math.max(cursor, bottom - creditsH), w, h: creditsH }
  return { title, subtitle, figures, profile, weather, map, tracks, credits, height: Math.max(cursor, credits.y + creditsH) - y }
}

const rounded = (b: Box): Box => {
  const x = Math.round(b.x)
  const y = Math.round(b.y)
  return { x, y, w: Math.max(1, Math.round(b.x + b.w) - x), h: Math.max(1, Math.round(b.y + b.h) - y) }
}

/** Boxes of a poster of `width` × `height` px in `style` with these rows. */
export function posterLayout(width: number, height: number, style: PosterStyleId, rows: PosterRows): PosterLayout {
  const family = POSTER_LAYOUTS[style]
  const u = Math.min(width, height) / 100
  const side = width / height > SIDE_RATIO
  // a square poster has less height for the same text: everything a little smaller
  const s = !side && height / width < 1.15 ? 0.7 : 1
  const fonts = fontsAt(u, s)
  const base = { width, height, u, side, fonts, bands: [] as Box[] }
  if (family === 'cinema') return cinemaLayout(base, rows, s)
  if (family === 'journal') return journalLayout(base, rows, s)
  if (family === 'tableau') return tableauLayout(base, rows, s)

  if (!side) {
    // portrait and square: every figure on one row; the list in one column, two on a square (less height)
    const columns = { figures: Math.max(1, rows.figures), tracks: s < 1 ? 2 : 1 }
    // measure the text column once (its height does not depend on where it starts)
    const probe = (w: number) => stackRows(rows, 0, 0, w, u, s, columns).height
    if (family === 'editorial') {
      const margin = 6 * u
      const gap = 4.5 * u
      const w = width - 2 * margin
      const textH = probe(w)
      const view = rounded({ x: margin, y: margin, w, h: height - 2 * margin - gap - textH })
      const text = stackRows(rows, margin, view.y + view.h + gap, w, u, s, columns)
      return { ...base, view, panel: null, accentBar: null, ...pick(text) }
    }
    if (family === 'broadcast') {
      const pad = 5 * u
      const inset = 6 * u
      const bar = 0.8 * u
      const w = width - 2 * inset
      const panelH = probe(w) + 2 * pad + bar
      const view = rounded({ x: 0, y: 0, w: width, h: height - panelH })
      const panel = { x: 0, y: view.h, w: width, h: height - view.h }
      const text = stackRows(rows, inset, panel.y + bar + pad, w, u, s, columns)
      return { ...base, view, panel, accentBar: { x: 0, y: panel.y, w: width, h: bar }, ...pick(text) }
    }
    const margin = 4 * u
    const pad = 4 * u
    const w = width - 2 * margin - 2 * pad
    const cardH = probe(w) + 2 * pad
    const panel = { x: margin, y: height - margin - cardH, w: width - 2 * margin, h: cardH }
    const text = stackRows(rows, margin + pad, panel.y + pad, w, u, s, columns)
    return { ...base, view: { x: 0, y: 0, w: width, h: height }, panel, accentBar: null, ...pick(text) }
  }

  // landscape: a text column, two figures per row, the list in one column
  const column = 40 * u
  const columns = { figures: 2, tracks: 1 }
  if (family === 'editorial') {
    const margin = 6 * u
    const gap = 5 * u
    const view = rounded({ x: margin, y: margin, w: width - 2 * margin - gap - column, h: height - 2 * margin })
    const text = stackRows(rows, view.x + view.w + gap, margin, column, u, s, columns, height - margin)
    return { ...base, view, panel: null, accentBar: null, ...pick(text) }
  }
  if (family === 'broadcast') {
    const pad = 5 * u
    const bar = 0.8 * u
    const panelW = column + 2 * pad + bar
    const view = rounded({ x: 0, y: 0, w: width - panelW, h: height })
    const panel = { x: view.w, y: 0, w: width - view.w, h: height }
    const text = stackRows(rows, panel.x + bar + pad, pad, column, u, s, columns, height - pad)
    return { ...base, view, panel, accentBar: { x: panel.x, y: 0, w: bar, h: height }, ...pick(text) }
  }
  const margin = 4 * u
  const pad = 4 * u
  const cardH = stackRows(rows, 0, 0, column, u, s, columns).height + 2 * pad
  const panel = { x: width - margin - column - 2 * pad, y: height - margin - cardH, w: column + 2 * pad, h: cardH }
  const text = stackRows(rows, panel.x + pad, panel.y + pad, column, u, s, columns)
  return { ...base, view: { x: 0, y: 0, w: width, h: height }, panel, accentBar: null, ...pick(text) }
}

function pick({ title, subtitle, figures, profile, weather, map, tracks, credits }: Stacked) {
  return { title, subtitle, figures, profile, weather, map, tracks, credits }
}

/** What `posterLayout` computes first, whatever the arrangement. */
interface Base {
  width: number
  height: number
  u: number
  side: boolean
  fonts: PosterFonts
  bands: Box[]
}

/**
 * Cinéma: the view between two black bands, the lower one carrying the text centred: title, figures on one thin row,
 * profile as a line. Same on every format.
 */
function cinemaLayout(base: Base, rows: PosterRows, s: number): PosterLayout {
  const { width, height, u } = base
  const inset = 6 * u
  const pad = 4 * u
  const topH = Math.round(4 * u)
  const w = width - 2 * inset
  const columns = { figures: Math.max(1, rows.figures), tracks: base.side || s < 1 ? 2 : 1 }
  const tune: Tune = { title: 0.9, figure: 0.5, profile: 0.5, group: 0.7 }
  const bandH = stackRows(rows, 0, 0, w, u, s, columns, undefined, tune).height + 2 * pad
  const view = rounded({ x: 0, y: topH, w: width, h: height - topH - bandH })
  const panel = { x: 0, y: view.y + view.h, w: width, h: height - view.y - view.h }
  const text = stackRows(rows, inset, panel.y + pad, w, u, s, columns, undefined, tune)
  return { ...base, bands: [{ x: 0, y: 0, w: width, h: topH }], view, panel, accentBar: null, ...pick(text) }
}

/**
 * Journal de bord: a paper column down the left edge carrying the title (up to two lines), the figures as a list, the
 * map of the track in the room that is left, the profile and the credits; the view takes the rest, full height.
 */
function journalLayout(base: Base, rows: PosterRows, s: number): PosterLayout {
  const { width, height, u } = base
  // a list of tracks needs a wider column for its figures
  const columnW = rows.tracks > 0 ? Math.min(55 * u, Math.max(44 * u, 0.45 * width)) : Math.min(44 * u, Math.max(30 * u, 0.3 * width))
  const pad = 3 * u
  const inner = columnW - 2 * pad
  const columns = { figures: 1, tracks: 1 }
  const group = 0.8
  const tune: Tune = { title: 1.25, figure: 0.4, profile: 0.7, group }
  const fonts = { ...base.fonts, title: base.fonts.title * 0.7 }
  const withoutMap = stackRows(rows, pad, pad, inner, u, s, columns, undefined, tune)
  // the map takes what the other rows leave, a little less than a square at most; none when there is no room for it
  const room = height - 2 * pad - withoutMap.height - ROW.group * u * s * group
  const mapH = rows.map ? Math.min(inner * 0.85, room) : 0
  const text = stackRows(rows, pad, pad, inner, u, s, columns, height - pad, { ...tune, map: mapH >= 8 * u ? mapH : 0 })
  const view = rounded({ x: columnW, y: 0, w: width - columnW, h: height })
  return { ...base, fonts, view, panel: { x: 0, y: 0, w: view.x, h: height }, accentBar: null, ...pick(text) }
}

/**
 * Tableau sportif: the view over a full-width dark band carrying the title, the figures big and spread evenly and,
 * behind them, the profile as an area chart (its box is the row of the figures).
 */
function tableauLayout(base: Base, rows: PosterRows, s: number): PosterLayout {
  const { width, height, u } = base
  const inset = 6 * u
  const pad = 4 * u
  const bar = 0.8 * u
  const w = width - 2 * inset
  const columns = { figures: Math.max(1, rows.figures), tracks: base.side || s < 1 ? 2 : 1 }
  const tune: Tune = { title: 0.85, figure: 1.4, group: 0.8 }
  // the profile sits behind the figures; without figures it is a row of its own
  const behind = rows.profile && rows.figures > 0
  const stackable = behind ? { ...rows, profile: false } : rows
  const bandH = stackRows(stackable, 0, 0, w, u, s, columns, undefined, tune).height + 2 * pad + bar
  const view = rounded({ x: 0, y: 0, w: width, h: height - bandH })
  const panel = { x: 0, y: view.h, w: width, h: height - view.h }
  const text = stackRows(stackable, inset, panel.y + bar + pad, w, u, s, columns, undefined, tune)
  const profile = behind ? { x: inset, y: text.figures[0].y, w, h: text.figures[0].h } : text.profile
  const fonts = { ...base.fonts, value: base.fonts.value * 1.5 }
  return { ...base, fonts, view, panel, accentBar: { x: 0, y: panel.y, w: width, h: bar }, ...pick(text), profile }
}

// ---------------------------------------------------------------------------
// Text fitting
// ---------------------------------------------------------------------------

/** Width (px) of `text` drawn at `px` in the font of the row. */
export type Measure = (text: string, px: number) => number

/** Longest start of `text` that fits `maxWidth` once followed by « … » ('' when even « … » does not). */
export function truncate(measure: Measure, text: string, maxWidth: number, px: number): string {
  if (measure(text, px) <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(text.slice(0, mid).trimEnd() + ELLIPSIS, px) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  if (lo === 0) return measure(ELLIPSIS, px) <= maxWidth ? ELLIPSIS : ''
  return text.slice(0, lo).trimEnd() + ELLIPSIS
}

/** Font size (≤ maxPx, ≥ minPx) at which `text` fits `maxWidth`, and the text, cut with « … » if even minPx is too wide. */
export function fitText(measure: Measure, text: string, maxWidth: number, maxPx: number, minPx: number): { text: string; px: number } {
  const width = measure(text, maxPx)
  if (width <= maxWidth) return { text, px: maxPx }
  // text width grows about linearly with the size: guess, then step down until it fits
  let px = Math.max(minPx, (maxPx * maxWidth) / width)
  for (let i = 0; i < 8 && px > minPx && measure(text, px) > maxWidth; i++) px = Math.max(minPx, px * 0.97)
  return { text: truncate(measure, text, maxWidth, px), px }
}

/** Columns of the lines of the list of tracks: the name, then the distance, D+ and date, each as wide as its widest text. */
export interface TrackListFit {
  px: number
  /** widths (px); 0 for a column no line fills */
  name: number
  distance: number
  ascent: number
  date: number
  /** space before each filled column after the name */
  gap: number
}

/** Least share of a line kept for the name before the whole list is set smaller. */
export const LIST_NAME_SHARE = 0.4

/**
 * One size for every line of the list (≤ maxPx, ≥ minPx): the largest at which the figures of every line fit and
 * leave LIST_NAME_SHARE of `width` to the name (cut with « … » when longer).
 */
export function fitTrackList(
  measure: Measure,
  lines: readonly { distance: string; ascent: string; date: string }[],
  width: number,
  maxPx: number,
  minPx: number,
): TrackListFit {
  const fitAt = (px: number): TrackListFit => {
    const widest = (key: 'distance' | 'ascent' | 'date') => Math.max(0, ...lines.map((l) => (l[key] ? measure(l[key], px) : 0)))
    const distance = widest('distance')
    const ascent = widest('ascent')
    const date = widest('date')
    const gap = px * 1.2
    const gaps = [distance, ascent, date].filter((w) => w > 0).length * gap
    return { px, name: Math.max(0, width - distance - ascent - date - gaps), distance, ascent, date, gap }
  }
  for (let px = maxPx; px > minPx; px *= 0.94) {
    const fit = fitAt(px)
    if (fit.name >= width * LIST_NAME_SHARE) return fit
  }
  return fitAt(minPx)
}

/** Words of `text` greedily on lines of `maxWidth`; null when they need more than `maxLines`. */
export function wrapText(measure: Measure, text: string, maxWidth: number, px: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (!line || measure(next, px) <= maxWidth) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines || lines.some((l) => measure(l, px) > maxWidth)) return null
  return lines
}

/**
 * `text` on at most `maxLines` lines of `maxWidth`: at `maxPx` if it fits, else smaller down to `minPx`, else the
 * last line cut with « … ».
 */
export function fitLines(
  measure: Measure,
  text: string,
  maxWidth: number,
  maxPx: number,
  minPx: number,
  maxLines: number,
): { lines: string[]; px: number } {
  for (let px = maxPx; px > minPx; px *= 0.94) {
    const lines = wrapText(measure, text, maxWidth, px, maxLines)
    if (lines) return { lines, px }
  }
  const lines = wrapText(measure, text, maxWidth, minPx, Number.POSITIVE_INFINITY) ?? [text]
  const kept = lines.slice(0, maxLines).map((l) => truncate(measure, l, maxWidth, minPx))
  if (lines.length > maxLines) kept[maxLines - 1] = truncate(measure, `${lines[maxLines - 1]} ${lines[maxLines]}`, maxWidth, minPx)
  return { lines: kept, px: minPx }
}
