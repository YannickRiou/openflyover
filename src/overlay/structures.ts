/**
 * The styles with a structure of their own, beyond colours and fonts: « Cinéma » (letterbox bars), « Journal de
 * bord » (a paper sheet down the left edge) and « Tableau sportif » (a dark band along the bottom). A structure
 * draws its furniture over the 3D view and the widgets that sit in its slots (`inStyleSlot`: counters, profile,
 * map, weather, opening and closing cards), and leaves the rest of the frame (`area`) to the ordinary widgets.
 * Every function is pure in the frame, like the rest of the overlay: nothing is kept from one frame to the next.
 */
import { formatDuration, formatNumber } from '../ui/format'
import type { OverlayFrame } from './data'
import { COUNTER_LABELS, PROFILE_MIN_SPAN_M, SAFE_MARGIN, counterText, endStats, fillText, measure, minimapWidget, openingText, truncate, weatherSummaryLine, wrapLines } from './draw'
import type { Painter, TextStyle, Widget } from './draw'
import { COUNTER_IDS } from './settings'
import type { CounterId, LaidOutWidget, OverlaySettings, StyledWidget } from './settings'
import { JOURNAL_PAPER } from './themes'
import { t } from '../i18n'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** What a structure leaves to the drawing of a frame. */
export interface Structure {
  /** what is left of the frame to the ordinary widgets (and to the credits): they are laid out in it, not in the safe area */
  area: Rect
  /** furniture and the widgets in its slots, under the ordinary widgets */
  draw(): void
}

export interface StructureInput {
  p: Painter
  /** painter of a widget, with its own colours and fonts when it has some */
  of(key: StyledWidget): Painter
  frame: OverlayFrame
  settings: OverlaySettings
  /** is the widget in a slot of the style (drawn by the structure)? */
  slot(key: LaidOutWidget): boolean
  /** opacity of the live widgets (they give way to the cards) and of the opening and closing cards */
  live: number
  titleOpacity: number
  endOpacity: number
  markerColor?: string
}

export function styleStructure(input: StructureInput): Structure | null {
  switch (input.settings.style) {
    case 'cinema':
      return cinema(input)
    case 'journal':
      return journal(input)
    case 'tableau':
      return tableau(input)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** `draw` at `alpha` of the current opacity (nothing below a thousandth). */
function faded(p: Painter, alpha: number, draw: () => void): void {
  if (alpha <= 0.001) return
  p.ctx.save()
  p.ctx.globalAlpha *= alpha
  draw()
  p.ctx.restore()
}

/** Digits as "0": the width of a number the way the tabular figures of the faces give it. */
const zeros = (text: string) => text.replace(/\d/g, '0')

/** The frame with the widest value each counter takes along the flyover, so a centred line keeps its width. */
function widestFrame(frame: OverlayFrame): OverlayFrame {
  const s = frame.track.stats
  return { ...frame, distanceM: Math.max(s.distanceM, 999), ele: s.maxEleM, ascentM: s.ascentM, elapsedS: s.durationS, speedKmh: Math.max(10, s.maxSpeedKmh ?? 0), heartRate: 100 }
}

/** `settings` with the minimap at `size` (and without its north arrow when `arrow` is false). */
function withMinimap(settings: OverlaySettings, size: number, arrow = settings.minimap.northArrow): OverlaySettings {
  return { ...settings, minimap: { ...settings.minimap, size, northArrow: arrow } }
}

interface ProfileLook {
  /** area under the whole profile, and under the part already flown */
  fill?: string
  playedFill?: string
  /** ridge line, and its part already flown */
  line: string
  played: string
  lineWidth: number
  dot: number
}

/** Elevation profile in `box`: optional area, ridge line, the flown part highlighted, the position dot at the progress. */
function drawProfileChart(p: Painter, frame: OverlayFrame, box: Rect, look: ProfileLook, dotColor: string): void {
  const profile = frame.track.profile
  if (!profile || profile.ele.length < 2 || box.w <= 0 || box.h <= 0) return
  const { ctx, theme, u } = p
  const { ele, minEle, maxEle } = profile
  const n = ele.length
  const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
  const xAt = (i: number) => box.x + (i / (n - 1)) * box.w
  const yAt = (e: number) => box.y + box.h * (1 - (e - minEle) / span)
  const bottom = box.y + box.h
  const ridge = () => {
    ctx.beginPath()
    let pen = false
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(ele[i])) {
        pen = false
        continue
      }
      if (pen) ctx.lineTo(xAt(i), yAt(ele[i]))
      else ctx.moveTo(xAt(i), yAt(ele[i]))
      pen = true
    }
  }
  const area = () => {
    ctx.beginPath()
    let open = false
    for (let i = 0; i <= n; i++) {
      const known = i < n && !Number.isNaN(ele[i])
      if (known && !open) {
        ctx.moveTo(xAt(i), bottom)
        open = true
      }
      if (known) ctx.lineTo(xAt(i), yAt(ele[i]))
      else if (open) {
        ctx.lineTo(xAt(i - 1), bottom)
        ctx.closePath()
        open = false
      }
    }
  }
  const markerX = box.x + frame.progress * box.w
  ctx.save()
  if (look.fill) {
    area()
    ctx.fillStyle = look.fill
    ctx.fill()
  }
  ridge()
  ctx.strokeStyle = look.line
  ctx.lineWidth = look.lineWidth
  ctx.lineJoin = 'round'
  ctx.stroke()
  // the part already flown
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x - u, box.y - 2 * u, markerX - box.x + u, box.h + 4 * u)
  ctx.clip()
  if (look.playedFill) {
    area()
    ctx.fillStyle = look.playedFill
    ctx.fill()
  }
  ridge()
  ctx.strokeStyle = look.played
  ctx.lineWidth = look.lineWidth * 1.3
  ctx.stroke()
  ctx.restore()
  if (frame.ele !== undefined) {
    ctx.beginPath()
    ctx.arc(markerX, yAt(frame.ele), look.dot, 0, Math.PI * 2)
    ctx.fillStyle = dotColor
    ctx.fill()
    ctx.lineWidth = look.dot * 0.4
    ctx.strokeStyle = theme.profile.markerRing
    ctx.stroke()
  }
  ctx.restore()
}

/** Weather under the marker as words: « Ciel dégagé · 12 °C · vent 14 km/h NO » ('' without weather). */
function weatherWords(frame: OverlayFrame): string {
  const w = frame.weather
  if (!w) return ''
  return t('overlay.draw.weatherWords', { condition: w.condition.label, temperature: formatNumber(w.temperatureC), speed: formatNumber(w.windSpeedKmh), dir: w.windFrom }).trim()
}

/** Cap height centred on a line: the baseline for a text of `px` whose caps are centred on `middle`. */
const baselineAt = (middle: number, px: number) => middle + px * 0.36

// ---------------------------------------------------------------------------
// Cinéma
// ---------------------------------------------------------------------------

/** Share of the frame height of each letterbox bar. */
const CINEMA_BAR = 0.11

/** A counter as the words of a subtitle: « 12,4 km », « alt. 2 450 m », « D+ 980 m », « 4 h 12 »; null when not recorded. */
function subtitlePart(id: CounterId, frame: OverlayFrame): string | null {
  if (id === 'time') {
    return frame.elapsedS === undefined ? null : `${frame.track.stats.timesEstimated ? '≈ ' : ''}${formatDuration(frame.elapsedS)}`
  }
  const text = counterText(id, frame)
  if (!text) return null
  const prefix = id === 'altitude' ? 'alt. ' : id === 'ascent' ? 'D+ ' : ''
  return `${prefix}${text.value} ${text.unit}`.trim()
}

function cinema(i: StructureInput): Structure {
  const { p, of, frame, settings, slot, live, markerColor } = i
  const { ctx, u, size } = p
  const barH = CINEMA_BAR * size.height
  const margin = size.width * SAFE_MARGIN
  const topMiddle = barH / 2
  const bottomMiddle = size.height - barH / 2

  const profile = () => {
    const pp = of('profile')
    const height = Math.max(2 * u, settings.profile.height * size.height)
    const box = { x: 0, y: size.height - barH - 0.8 * u - height, w: size.width, h: height }
    const { theme } = pp
    const look: ProfileLook = { line: theme.profile.line, played: theme.profile.played, lineWidth: 0.15 * u, dot: 0.5 * u }
    drawProfileChart(pp, frame, box, look, settings.profile.markerColor || markerColor || theme.profile.marker)
  }

  // one line, centred in the bottom bar: the counters as a subtitle, thin dots between them
  const counters = () => {
    const pc = of('counters')
    const { theme } = pc
    const s = settings.counters.size
    const style: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.9 * u * s, color: theme.text, tracking: 0.2 }
    const widest = widestFrame(frame)
    const cells = COUNTER_IDS.flatMap((id) => {
      const text = settings.counters.fields[id] ? subtitlePart(id, frame) : null
      if (text === null) return []
      const template = subtitlePart(id, widest) ?? text
      return [{ text, width: Math.max(measure(pc, zeros(template), style), measure(pc, zeros(text), style)) }]
    })
    if (cells.length === 0) return
    const dot = measure(pc, '·', style)
    const gap = 1.6 * u * s
    const total = cells.reduce((sum, c) => sum + c.width, 0) + (cells.length - 1) * (dot + 2 * gap)
    // a little above the middle of the bar: the credits keep the corner under it
    const baseline = baselineAt(bottomMiddle - 0.5 * u, style.sizePx)
    let x = (size.width - total) / 2
    cells.forEach((cell, k) => {
      fillText(pc, cell.text, x + cell.width / 2, baseline, style, 'center')
      x += cell.width
      if (k < cells.length - 1) fillText(pc, '·', x + gap + dot / 2, baseline, { ...style, color: theme.textSoft }, 'center')
      if (k < cells.length - 1) x += dot + 2 * gap
    })
  }

  const weather = () => {
    const pw = of('weather')
    const s = settings.weather.size
    const style: TextStyle = { family: pw.theme.bodyFamily, weight: pw.theme.labelWeight, sizePx: 1.5 * u * s, color: pw.theme.textSoft, uppercase: true, tracking: 0.2 }
    const words = truncate(pw, weatherWords(frame), size.width / 2 - margin, style)
    fillText(pw, words, margin, baselineAt(topMiddle, style.sizePx), style)
  }

  // at the right, just under the top bar, at its own size (#182: squeezed into the bar it was too small to read)
  const minimap = () => {
    const pm = of('minimap')
    const maxH = barH - 1.6 * u
    const map = minimapWidget(pm, frame, settings, live, markerColor)
    map?.draw(size.width - margin - map.width + 2, CINEMA_BAR + map.height / 2 + maxH / 2)
  }

  return {
    area: { x: margin, y: barH + 1.5 * u, w: size.width - 2 * margin, h: size.height - 2 * barH - 3 * u },
    draw() {
      ctx.save()
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, size.width, barH)
      ctx.fillRect(0, size.height - barH, size.width, barH)
      ctx.restore()
      if (slot('profile') && settings.profile.enabled) faded(p, live, profile)
      if (slot('counters') && settings.counters.enabled) faded(p, live, counters)
      if (slot('weather') && settings.weather.enabled && frame.weather) faded(p, live, weather)
      if (slot('minimap') && settings.minimap.enabled) faded(p, live, minimap)
    },
  }
}

// ---------------------------------------------------------------------------
// Journal de bord
// ---------------------------------------------------------------------------

interface Row {
  label: string
  value: string
}

const rowHeight = (p: Painter, scale: number) => 3.7 * p.u * scale

/** One row of the list: the label, a dotted leader, the value at the right edge. Returns the row's height. */
function drawRow(p: Painter, row: Row, x: number, y: number, w: number, scale: number): number {
  const { ctx, theme, u } = p
  const label: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 2 * u * scale, color: theme.text }
  const value: TextStyle = { family: theme.numberFamily, weight: theme.numberWeight, sizePx: 2.5 * u * scale, color: theme.text }
  const h = rowHeight(p, scale)
  const baseline = y + h * 0.72
  fillText(p, row.label, x, baseline, label)
  fillText(p, row.value, x + w, baseline, value, 'right')
  const from = x + measure(p, row.label, label) + 0.8 * u * scale
  const to = x + w - measure(p, row.value, value) - 0.8 * u * scale
  if (to > from) {
    ctx.save()
    ctx.setLineDash([0.1 * u, 0.55 * u])
    ctx.lineCap = 'round'
    ctx.lineWidth = 0.22 * u * scale
    ctx.strokeStyle = theme.textSoft
    ctx.beginPath()
    ctx.moveTo(from, baseline - 0.2 * u * scale)
    ctx.lineTo(to, baseline - 0.2 * u * scale)
    ctx.stroke()
    ctx.restore()
  }
  return h
}

/** Header of the sheet: the title in italic serif, a rule, the line under it; laid out once to know its height. */
function headerBlock(p: Painter, text: { title: string; subtitle: string }, width: number, scale: number) {
  const { ctx, theme, u } = p
  const title: TextStyle = { family: theme.titleFamily, weight: Math.max(theme.titleWeight, 500), sizePx: 5 * u * scale, color: theme.text, italic: true }
  let lines = text.title ? wrapLines(p, text.title, width, title) : []
  for (let k = 0; k < 4 && (lines.length > 3 || lines.some((l) => measure(p, l, title) > width)); k++) {
    title.sizePx *= 0.85
    lines = wrapLines(p, text.title, width, title)
  }
  const sub: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.7 * u * scale, color: theme.textSoft }
  const subtitle = text.subtitle ? truncate(p, text.subtitle, width, sub) : ''
  const lineH = title.sizePx * 1.15
  const gap = 1.3 * u * scale
  const titleH = lines.length > 0 ? (lines.length - 1) * lineH + title.sizePx * 0.8 : 0
  const height = titleH + (titleH > 0 ? 2 * gap : 0) + (subtitle ? sub.sizePx * 0.8 : 0)
  return {
    height,
    draw(x: number, y: number, alpha: number) {
      faded(p, alpha, () => {
        lines.forEach((line, k) => fillText(p, line, x, y + title.sizePx * 0.8 + k * lineH, title))
        let cy = y + titleH + gap
        if (titleH > 0) {
          ctx.fillStyle = theme.textSoft
          ctx.fillRect(x, cy - 0.08 * u, width, Math.max(0.16 * u, 1))
          cy += gap
        }
        if (subtitle) fillText(p, subtitle, x, cy + sub.sizePx * 0.8, sub)
      })
    },
  }
}

function journal(i: StructureInput): Structure {
  const { p, of, frame, settings, slot, live, endOpacity, markerColor } = i
  const { ctx, theme, u, size } = p
  const W = size.width
  const H = size.height
  // about a quarter of the width, never narrower than a column that holds the list
  const sheetW = Math.min(0.45 * W, Math.max(0.24 * W, 30 * u))
  const pad = 2.6 * u
  const x0 = pad
  const innerW = sheetW - 2 * pad
  const areaX = Math.max(W * SAFE_MARGIN, sheetW + 2 * u)

  const ownTitle = slot('title') && settings.title.enabled
  const ownEnd = slot('end') && settings.end.enabled
  const opening = openingText(frame, settings)
  const closing = { title: settings.end.title.trim() || frame.track.name, subtitle: '' }
  const scale = settings.title.size
  const headers = [ownTitle ? headerBlock(of('title'), opening, innerW, scale) : null, ownEnd ? headerBlock(of('end'), closing, innerW, scale) : null]
  const headerH = Math.max(0, ...headers.map((h) => h?.height ?? 0))

  const hasChart = slot('profile') && settings.profile.enabled && frame.track.profile !== undefined
  const chartH = Math.min(22 * u, Math.max(8 * u, settings.profile.height * H))
  const chartTop = H - pad - chartH
  const bodyTop = pad + 0.6 * u + (headerH > 0 ? headerH + 2.2 * u : 0)
  const bodyBottom = hasChart ? chartTop - 3 * u : H - pad

  const counterRows = (): Row[] =>
    COUNTER_IDS.flatMap((id) => {
      const text = settings.counters.fields[id] ? counterText(id, frame) : null
      return text ? [{ label: COUNTER_LABELS[id], value: `${text.value} ${text.unit}`.trim() }] : []
    })
  const weatherRows = (): Row[] => {
    const w = frame.weather
    return w
      ? [
        { label: t('overlay.draw.weatherRow.weather'), value: w.condition.label },
        { label: t('overlay.draw.weatherRow.temperature'), value: `${formatNumber(w.temperatureC)} °C` },
        { label: t('overlay.draw.weatherRow.wind'), value: `${formatNumber(w.windSpeedKmh)} km/h ${w.windFrom}`.trim() },
      ]
      : []
  }

  /** The live blocks: figures, weather, then the map in what is left. */
  const body = () => {
    let y = bodyTop
    const rows = (list: Row[], key: StyledWidget, s: number) => {
      const pr = of(key)
      for (const row of list) y += drawRow(pr, row, x0, y, innerW, s)
      if (list.length > 0) y += 1.6 * u
    }
    if (slot('counters') && settings.counters.enabled) rows(counterRows(), 'counters', settings.counters.size)
    if (slot('weather') && settings.weather.enabled) rows(weatherRows(), 'weather', settings.weather.size)
    if (slot('minimap') && settings.minimap.enabled) {
      const pm = of('minimap')
      const first = minimapWidget(pm, frame, settings, 1, markerColor)
      if (!first) return
      const room = Math.min(innerW / first.width, (bodyBottom - y) / first.height, 1)
      const map = room < 1 ? minimapWidget(pm, frame, withMinimap(settings, settings.minimap.size * Math.max(room, 0.1)), 1, markerColor) : first
      map?.draw(x0 + (innerW - map.width) / 2, y)
    }
  }

  /** The closing card in the sheet: the totals in the same list form, then the weather of the day. */
  const closingBody = () => {
    const pe = of('end')
    let y = bodyTop
    for (const { label, text } of endStats(frame.track.stats)) y += drawRow(pe, { label, value: `${text.value} ${text.unit}`.trim() }, x0, y, innerW, settings.end.size)
    const weather = settings.end.showWeather ? weatherSummaryLine(frame.track.stats.weather) : ''
    if (!weather) return
    const style: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.7 * u * settings.end.size, color: theme.textSoft }
    wrapLines(pe, weather, innerW, style).forEach((line, k) => fillText(pe, line, x0, y + 1.2 * u + style.sizePx * 0.8 + k * style.sizePx * 1.3, style))
  }

  /** Ink line chart with the lowest and highest altitudes on the axis. */
  const chart = () => {
    const profile = frame.track.profile
    if (!profile) return
    const pp = of('profile')
    const label: TextStyle = { family: pp.theme.bodyFamily, weight: pp.theme.labelWeight, sizePx: 1.5 * u, color: pp.theme.textSoft }
    const top = `${formatNumber(profile.maxEle)} m`
    const low = `${formatNumber(profile.minEle)} m`
    const gutter = Math.max(measure(pp, top, label), measure(pp, low, label)) + 0.6 * u
    const plot = { x: x0 + gutter + 1.2 * u, y: chartTop + label.sizePx, w: innerW - gutter - 1.2 * u, h: chartH - label.sizePx * 1.4 }
    const span = Math.max(profile.maxEle - profile.minEle, PROFILE_MIN_SPAN_M)
    const yTop = plot.y + plot.h * (1 - (profile.maxEle - profile.minEle) / span)
    const yLow = plot.y + plot.h
    ctx.save()
    ctx.strokeStyle = pp.theme.textSoft
    ctx.lineWidth = Math.max(0.12 * u, 1)
    for (const y of [yTop, yLow]) {
      ctx.beginPath()
      ctx.moveTo(x0 + gutter + 0.2 * u, y)
      ctx.lineTo(plot.x, y)
      ctx.stroke()
    }
    ctx.setLineDash([0.1 * u, 0.5 * u])
    ctx.globalAlpha *= 0.6
    ctx.beginPath()
    ctx.moveTo(plot.x, yTop)
    ctx.lineTo(plot.x + plot.w, yTop)
    ctx.moveTo(plot.x, yLow)
    ctx.lineTo(plot.x + plot.w, yLow)
    ctx.stroke()
    ctx.restore()
    fillText(pp, top, x0 + gutter, baselineAt(yTop, label.sizePx), label, 'right')
    fillText(pp, low, x0 + gutter, baselineAt(yLow, label.sizePx), label, 'right')
    const look: ProfileLook = { line: pp.theme.profile.line, played: pp.theme.profile.played, lineWidth: 0.22 * u, dot: 0.8 * u }
    drawProfileChart(pp, frame, plot, look, settings.profile.markerColor || markerColor || pp.theme.profile.marker)
  }

  return {
    area: { x: areaX, y: H * SAFE_MARGIN, w: W * (1 - SAFE_MARGIN) - areaX, h: H * (1 - 2 * SAFE_MARGIN) },
    draw() {
      ctx.save()
      ctx.fillStyle = theme.panel?.fill ?? JOURNAL_PAPER
      ctx.fillRect(0, 0, sheetW, H)
      ctx.strokeStyle = theme.panel?.stroke ?? theme.textSoft
      ctx.lineWidth = Math.max(0.14 * u, 1)
      ctx.strokeRect(0.9 * u, 0.9 * u, sheetW - 1.8 * u, H - 1.8 * u)
      ctx.restore()
      // the title stays on the sheet; the closing card's name takes its place with the card
      headers[0]?.draw(x0, pad + 0.6 * u, ownEnd ? 1 - endOpacity : 1)
      headers[1]?.draw(x0, pad + 0.6 * u, endOpacity)
      faded(p, live, body)
      if (ownEnd) faded(p, endOpacity, closingBody)
      if (hasChart) faded(p, live, chart)
    },
  }
}

// ---------------------------------------------------------------------------
// Tableau sportif
// ---------------------------------------------------------------------------

/** Share of the frame height of the band. */
const TABLEAU_BAND = 0.2

function tableau(i: StructureInput): Structure {
  const { p, of, frame, settings, slot, live, titleOpacity, markerColor } = i
  const { ctx, theme, u, size } = p
  const W = size.width
  const H = size.height
  const bandH = TABLEAU_BAND * H
  const bandY = H - bandH
  const margin = W * SAFE_MARGIN
  const edge = 0.35 * u
  const bandFill = theme.panel?.fill ?? 'rgba(12, 18, 23, 0.84)'

  const profile = () => {
    const pp = of('profile')
    const box = { x: 0, y: bandY + 3 * u, w: W, h: bandH - 3 * u }
    const look: ProfileLook = {
      fill: pp.theme.profile.area,
      playedFill: pp.theme.profile.played,
      line: pp.theme.profile.line,
      played: pp.theme.text,
      lineWidth: 0.2 * u,
      dot: 0.8 * u,
    }
    drawProfileChart(pp, frame, box, look, settings.profile.markerColor || markerColor || pp.theme.profile.marker)
  }

  // the counters as big numbers spread evenly across the band, the unit in the accent, a small label under each
  const counters = () => {
    const pc = of('counters')
    const t = pc.theme
    const s = settings.counters.size
    const widest = widestFrame(frame)
    const cells = COUNTER_IDS.flatMap((id) => {
      const text = settings.counters.fields[id] ? counterText(id, frame) : null
      return text ? [{ label: COUNTER_LABELS[id], text, template: counterText(id, widest) ?? text }] : []
    })
    if (cells.length === 0) return
    const cellW = (W - 2 * margin) / cells.length
    const value = (px: number): TextStyle => ({ family: t.numberFamily, weight: t.numberWeight, sizePx: px, color: t.text })
    const unit = (px: number): TextStyle => ({ family: t.bodyFamily, weight: 700, sizePx: px * 0.42, color: t.accent })
    const runWidth = (px: number, text: { value: string; unit: string }) =>
      measure(pc, zeros(text.value), value(px)) + (text.unit ? 0.12 * px + measure(pc, text.unit, unit(px)) : 0)
    // one size for every number: the largest at which the widest one fits its cell
    const base = 8 * u * s
    const widestRun = Math.max(...cells.map((c) => Math.max(runWidth(base, c.template), runWidth(base, c.text))))
    const px = Math.min(base, (base * 0.9 * cellW) / widestRun)
    const label: TextStyle = { family: t.bodyFamily, weight: t.labelWeight, sizePx: Math.min(1.6 * u * s, px * 0.22), color: t.textSoft, uppercase: t.labelUppercase, tracking: t.labelTracking }
    const top = bandY + edge + 1 * u
    const room = bandH - edge - 1 * u - 3.4 * u
    const block = px * 0.74 + 1.3 * u * s + label.sizePx * 0.74
    const baseline = top + (room - block) / 2 + px * 0.74
    cells.forEach((cell, k) => {
      const cx = margin + (k + 0.5) * cellW
      const used = measure(pc, cell.text.value, value(px)) + (cell.text.unit ? 0.12 * px + measure(pc, cell.text.unit, unit(px)) : 0)
      const left = cx - used / 2
      fillText(pc, cell.text.value, left, baseline, value(px))
      if (cell.text.unit) fillText(pc, cell.text.unit, left + measure(pc, cell.text.value, value(px)) + 0.12 * px, baseline, unit(px))
      fillText(pc, cell.label, cx, baseline + 1.3 * u * s + label.sizePx * 0.74, label, 'center')
    })
  }

  // an accent block with the title and, under it, a dark one with the date: a lower third turned upside down, at the top left
  const stripe = () => {
    const pt = of('title')
    const s = settings.title.size
    const text = openingText(frame, settings)
    const style: TextStyle = { family: pt.theme.titleFamily, weight: pt.theme.titleWeight, sizePx: 4.6 * u * s, color: pt.theme.text, uppercase: pt.theme.titleUppercase, tracking: 0.04 }
    const padX = 3 * u * s
    // two lines at most, the second cut with an ellipsis
    const maxW = W * 0.6 - 2 * padX
    const wrapped = wrapLines(pt, text.title, maxW, style)
    const lines = wrapped.length > 2 ? [wrapped[0], truncate(pt, wrapped.slice(1).join(' '), maxW, style)] : wrapped
    const blockW = Math.max(...lines.map((line) => measure(pt, line, style))) + 2 * padX
    const lineH = style.sizePx * 1.6
    const blockH = lineH * lines.length
    const y = H * SAFE_MARGIN
    ctx.fillStyle = pt.theme.accent
    ctx.fillRect(0, y, blockW, blockH)
    lines.forEach((line, k) => fillText(pt, line, padX, baselineAt(y + lineH * (k + 0.5), style.sizePx), style))
    if (!text.subtitle) return
    const sub: TextStyle = { family: pt.theme.bodyFamily, weight: pt.theme.labelWeight, sizePx: 1.8 * u * s, color: pt.theme.text, uppercase: true, tracking: 0.14 }
    const line = truncate(pt, text.subtitle, W * 0.6 - 2 * padX, sub)
    const subH = sub.sizePx * 1.9
    ctx.fillStyle = bandFill
    ctx.fillRect(0, y + blockH, measure(pt, line, sub) + 2 * padX, subH)
    fillText(pt, line, padX, baselineAt(y + blockH + subH / 2, sub.sizePx), sub)
  }

  // the map clipped to a circle at the top right
  const minimap = () => {
    const pm = of('minimap')
    const s = settings.minimap.size
    // no accent bar, no rounded corners: the circle clips a flat panel
    const flat: Painter = { ...pm, theme: { ...pm.theme, accentBar: 0, panel: pm.theme.panel && { ...pm.theme.panel, radius: 0 } } }
    const first = minimapWidget(flat, frame, withMinimap(settings, s, false), live, markerColor)
    if (!first) return
    const radius = 10 * u * s
    // the whole box inside the circle: everything scales with the size
    const fit = (2 * radius) / Math.hypot(first.width, first.height)
    const map: Widget | null = minimapWidget(flat, frame, withMinimap(settings, s * fit, false), live, markerColor)
    if (!map) return
    const cx = W - margin - radius
    const cy = H * SAFE_MARGIN + radius
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fillStyle = bandFill
    ctx.fill()
    ctx.clip()
    map.draw(cx - map.width / 2, cy - map.height / 2)
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 0.35 * u
    ctx.stroke()
  }

  return {
    area: { x: margin, y: H * SAFE_MARGIN, w: W - 2 * margin, h: bandY - 1.5 * u - H * SAFE_MARGIN },
    draw() {
      ctx.save()
      ctx.fillStyle = bandFill
      ctx.fillRect(0, bandY, W, bandH)
      ctx.fillStyle = theme.accent
      ctx.fillRect(0, bandY, W, edge)
      ctx.restore()
      if (slot('profile') && settings.profile.enabled) faded(p, live, profile)
      if (slot('counters') && settings.counters.enabled) faded(p, live, counters)
      if (slot('minimap') && settings.minimap.enabled) faded(p, live, minimap)
      if (slot('title') && settings.title.enabled) faded(p, titleOpacity, stripe)
    },
  }
}
