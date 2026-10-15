// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { overlayFrameAt, prepareOverlayTrack, recordedAtProgress } from './data'
import {
  SAFE_MARGIN,
  cardOpacityAt,
  counterText,
  drawOverlay,
  endCardOpacity,
  creditLines,
  creditsRollProgress,
  formatLongDate,
  filmTextMaxWidths,
  filmTextOpacity,
  formatElapsed,
  kenBurnsCrop,
  KEN_BURNS_ZOOM,
  layoutWidgets,
  overlayTime,
  overlayTimedState,
  progressTime,
  titleCardOpacity,
} from './draw'
import type { OverlayContext2D, OverlayExtras, StageCard } from './draw'
import { MEDIA_DEFAULTS } from '../film/model'
import type { FilmMedia, FilmText } from '../film/model'
import { DEFAULT_OVERLAY, OVERLAY_ANCHORS, OVERLAY_STYLES, STYLE_LAYOUTS, TEXT_BACKINGS, withStyleLayout } from './settings'
import type { OverlaySettings } from './settings'
import { OVERLAY_FONT_FAMILIES } from './themes'
import { openMeteoAttribution } from '../weather/openMeteo'
import { WEATHER_VARIABLES } from '../weather/series'
import type { WeatherSeries, WeatherVariable } from '../weather/series'

interface TextCall {
  text: string
  x: number
  y: number
  alpha: number
  /** font set when the text was drawn */
  font: string
  /** fill colour when the text was drawn */
  color: string
}

interface PointCall {
  op: string
  x: number
  y: number
  /** arc radius */
  r?: number
}

/** 2D context stand-in: records the texts and path points drawn; a glyph is half the font size wide. */
function fakeContext() {
  const texts: TextCall[] = []
  const calls: string[] = []
  const points: PointCall[] = []
  /** drawImage calls: arguments after the image, opacity */
  const images: { args: number[]; alpha: number }[] = []
  /** order of the texts, images and filled rectangles (`rect <fill> <opacity>`) drawn */
  const order: string[] = []
  /** non-zero shadow offsets set: the blurred rectangles of the text backing, drawn off the canvas */
  const offsets: number[] = []
  /** fill colour at each visible `fill()` */
  const fills: string[] = []
  /** filled rectangles, in the order drawn */
  const rects: { x: number; y: number; w: number; h: number; fill: string; alpha: number }[] = []
  const state = { font: '10px sans-serif', globalAlpha: 1, shadowOffsetX: 0 }
  const stack: (typeof state)[] = []
  const fontPx = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10)
  const target: Record<string, unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    measureText: (text: string) => ({ width: text.length * fontPx() * 0.5 }),
    fillText: (text: string, x: number, y: number) => {
      order.push('text')
      texts.push({ text, x, y, alpha: state.globalAlpha, font: state.font, color: String(target.fillStyle) })
    },
    drawImage: (_image: unknown, ...args: number[]) => {
      order.push('image')
      images.push({ args, alpha: state.globalAlpha })
      calls.push(`drawImage(${args.length + 1})`)
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getTransform: () => ({ a: 2, b: 0 }),
  }
  const ctx = new Proxy(target, {
    get: (t, key: string) => {
      if (key in state) return state[key as keyof typeof state]
      if (key in t) return t[key]
      return (...args: unknown[]) => {
        // a shape drawn with a shadow offset is only the source of its (blurred) shadow, off the canvas
        const visible = state.shadowOffsetX === 0
        if (visible && (key === 'moveTo' || key === 'lineTo')) points.push({ op: key, x: args[0] as number, y: args[1] as number })
        if (visible && key === 'arc') points.push({ op: key, x: args[0] as number, y: args[1] as number, r: args[2] as number })
        if (visible && key === 'fill') fills.push(String(t.fillStyle))
        if (key === 'fillRect') {
          order.push(`rect ${String(t.fillStyle)} ${state.globalAlpha}`)
          rects.push({ x: args[0] as number, y: args[1] as number, w: args[2] as number, h: args[3] as number, fill: String(t.fillStyle), alpha: state.globalAlpha })
        }
        return calls.push(`${key}(${args.length})`)
      }
    },
    set: (t, key: string, value) => {
      if (key === 'shadowOffsetX' && value !== 0) offsets.push(value as number)
      if (key in state) (state as Record<string, unknown>)[key] = value
      else t[key] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as OverlayContext2D, texts, calls, points, images, order, offsets, fills, rects }
}

/** The styles that only recolour the widgets placed at the user's anchors (the others draw a structure of their own). */
const FREE_STYLES = OVERLAY_STYLES.filter((style) => !(style in STYLE_LAYOUTS))

const sampleTrack = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
const track = prepareOverlayTrack(sampleTrack)
const SIZE = { width: 1920, height: 1080 }
const enabled = (patch: Partial<OverlaySettings> = {}): OverlaySettings => ({ ...DEFAULT_OVERLAY, enabled: true, ...patch })

const FILM_TEXT: FilmText = { id: 'text-1', startS: 0, durationS: 4, text: 'Col de Balme', anchor: 'bottom-center', size: 1 }

function draw(progress: number, settings: OverlaySettings) {
  const { ctx, texts, calls } = fakeContext()
  drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE)
  return { texts, calls, joined: texts.map((t) => t.text).join(' | ') }
}

describe('rolling credits', () => {
  it('keeps the non-blank lines, trimmed', () => {
    expect(creditLines(' Paul \n\n  Musique : Lou ')).toEqual(['Paul', 'Musique : Lou'])
    expect(creditLines(undefined)).toEqual([])
  })

  it('holds while the card fades in, then rolls to the end of the film', () => {
    // card from 0.9 of the flight, faded in at 0.925
    expect(creditsRollProgress(progressTime(0.9), 0.9)).toBe(0)
    expect(creditsRollProgress(progressTime(0.925), 0.9)).toBeCloseTo(0, 9)
    expect(creditsRollProgress(progressTime(0.9625), 0.9)).toBeCloseTo(0.5, 6)
    expect(creditsRollProgress(progressTime(1), 0.9)).toBe(1)
  })

  it('draws the card and every line, moving up with the time, and is part of the timed state', () => {
    const settings = enabled({ end: { ...DEFAULT_OVERLAY.end, credits: 'Paul\nLou' } })
    const at = (progress: number) => {
      const { ctx, texts } = fakeContext()
      drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE)
      return texts
    }
    const early = at(0.94)
    const late = at(0.97)
    const y = (texts: TextCall[], text: string) => texts.find((t) => t.text === text)?.y ?? NaN
    expect(y(early, 'Paul')).toBeLessThan(y(early, 'Lou'))
    expect(y(late, 'Lou')).toBeLessThan(y(early, 'Lou'))
    expect(overlayTimedState(settings, [], progressTime(0.94))).not.toEqual(overlayTimedState(settings, [], progressTime(0.97)))
  })
})

describe('card timing', () => {
  it('fades the opening card in, holds it, then fades it out before its end', () => {
    expect(titleCardOpacity(progressTime(0), 0.1)).toBe(0)
    expect(titleCardOpacity(progressTime(0.005), 0.1)).toBeCloseTo(0.5, 6)
    expect(titleCardOpacity(progressTime(0.02), 0.1)).toBe(1)
    expect(titleCardOpacity(progressTime(0.09), 0.1)).toBeGreaterThan(0)
    expect(titleCardOpacity(progressTime(0.09), 0.1)).toBeLessThan(1)
    expect(titleCardOpacity(progressTime(0.1), 0.1)).toBe(0)
  })

  it('shows the closing card from its start to the end', () => {
    expect(endCardOpacity(progressTime(0.9), 0.9)).toBe(0)
    expect(endCardOpacity(progressTime(0.91), 0.9)).toBeGreaterThan(0)
    expect(endCardOpacity(progressTime(0.95), 0.9)).toBe(1)
    expect(endCardOpacity(progressTime(1), 0.9)).toBe(1)
  })

  it('gives the opacity of whichever card is shown, 0 without overlay or cards', () => {
    const settings = enabled()
    expect(cardOpacityAt(progressTime(0.005), settings)).toBe(titleCardOpacity(progressTime(0.005), settings.title.end))
    expect(cardOpacityAt(progressTime(0.5), settings)).toBe(0)
    expect(cardOpacityAt(progressTime(0.92), settings)).toBe(endCardOpacity(progressTime(0.92), settings.end.start))
    expect(cardOpacityAt(progressTime(0.99), settings)).toBe(1)
    expect(cardOpacityAt(progressTime(0.99), DEFAULT_OVERLAY)).toBe(0)
    expect(cardOpacityAt(progressTime(0.02), enabled({ title: { ...DEFAULT_OVERLAY.title, enabled: false } }))).toBe(0)
  })
})

describe('film time', () => {
  /** 6 s opening, 60 s flight, 5 s closing */
  const clock = { openingS: 6, flightS: 60, totalTime: () => 71, timeAtProgress: (p: number) => (p >= 1 ? 71 : 6 + p * 60) }
  const at = (timeS: number) => overlayTime(clock, 0, timeS)

  it('reads the film time of the playback, or of the progress when it has none', () => {
    expect(overlayTime(clock, 0.5, 20)).toEqual({ timeS: 20, openingS: 6, flightS: 60, totalS: 71 })
    expect(overlayTime(clock, 0.5, null).timeS).toBe(36)
    expect(overlayTime(clock, 1, null).timeS).toBe(71)
  })

  it('shows the opening card over the opening shot and into the flight, the closing card until the last frame', () => {
    const settings = enabled()
    expect(titleCardOpacity(at(0), 0.1)).toBe(0)
    expect(titleCardOpacity(at(3), 0.1)).toBe(1)
    expect(titleCardOpacity(at(11), 0.1)).toBeGreaterThan(0)
    expect(titleCardOpacity(at(12), 0.1)).toBe(0) // 6 s + 10 % of 60 s
    expect(endCardOpacity(at(60), 0.9)).toBe(0) // 6 s + 90 % of 60 s
    expect(endCardOpacity(at(68), 0.9)).toBe(1)
    expect(endCardOpacity(at(71), 0.9)).toBe(1)
    expect(cardOpacityAt(at(36), settings)).toBe(0)
  })

  it('fades a timeline text in and out inside its window', () => {
    const text = { startS: 10, durationS: 4 }
    expect(filmTextOpacity(text, 9.99)).toBe(0)
    expect(filmTextOpacity(text, 10)).toBe(0)
    expect(filmTextOpacity(text, 10.2)).toBeCloseTo(0.5, 6)
    expect(filmTextOpacity(text, 12)).toBe(1)
    expect(filmTextOpacity(text, 13.9)).toBeGreaterThan(0)
    expect(filmTextOpacity(text, 14)).toBe(0)
    // short texts: fades of a quarter of their duration
    expect(filmTextOpacity({ startS: 0, durationS: 0.8 }, 0.4)).toBe(1)
  })

  it('lists the timed opacities, empty without overlay', () => {
    const texts = [{ ...FILM_TEXT, startS: 10, durationS: 4 }]
    expect(overlayTimedState(enabled(), texts, at(12))).toEqual([0, 0, 1])
    expect(overlayTimedState(enabled(), texts, at(3))).toEqual([1, 0, 0])
    expect(overlayTimedState(DEFAULT_OVERLAY, texts, at(12))).toEqual([])
    // the dip of a shot transition, while there is one
    expect(overlayTimedState(DEFAULT_OVERLAY, texts, at(6), [], 0.8)).toEqual([0.8])
    expect(overlayTimedState(enabled(), texts, at(12), [], 0.8)).toEqual([0, 0, 1, 0.8])
  })

  it('narrows the texts sharing a row with another anchor', () => {
    expect(filmTextMaxWidths(['top-left', 'bottom-left', 'center'], 900, 15)).toEqual([900, 900, 900])
    expect(filmTextMaxWidths(['top-left', 'top-left', 'top-right', 'center'], 900, 15)).toEqual([290, 290, 290, 900])
  })
})

describe('formatting', () => {
  it('formats elapsed time and French dates', () => {
    expect(formatElapsed(0)).toBe('0:00:00')
    expect(formatElapsed(3909.7)).toBe('1:05:09')
    expect(formatLongDate(new Date(2025, 6, 12, 9).getTime())).toBe('12 juillet 2025')
    expect(formatLongDate(new Date(2025, 4, 1, 9).getTime())).toBe('1er mai 2025')
  })

  it('splits counters into value and unit, null when not recorded', () => {
    const frame = overlayFrameAt(track, 0.5)
    expect(counterText('distance', frame)).toEqual({ value: expect.stringMatching(/^\d+,\d$/), unit: 'km' })
    expect(counterText('altitude', frame)?.unit).toBe('m')
    expect(counterText('heartRate', frame)?.unit).toBe('bpm')
    expect(counterText('altitude', { ...frame, ele: undefined })).toBeNull()
  })

  it('marks an estimated time', () => {
    const frame = overlayFrameAt(track, 0.5)
    expect(counterText('time', frame)?.value).toMatch(/^\d+:\d\d:\d\d$/)
    const planned = { ...track, stats: { ...track.stats, timesEstimated: true } }
    expect(counterText('time', { ...frame, track: planned })?.value).toMatch(/^≈ \d+:\d\d:\d\d$/)
  })
})

describe('layoutWidgets', () => {
  const size = { width: 1000, height: 500 }
  it('places each anchor inside the safe area', () => {
    const items = [
      { anchor: 'top-left' as const, width: 100, height: 50 },
      { anchor: 'bottom-right' as const, width: 100, height: 50 },
      { anchor: 'center' as const, width: 200, height: 100 },
      { anchor: 'top-center' as const, width: 200, height: 20 },
    ]
    expect(layoutWidgets(items, size, 10)).toEqual([
      { x: 50, y: 25 },
      { x: 850, y: 425 },
      { x: 400, y: 200 },
      { x: 400, y: 25 },
    ])
  })

  it('stacks the widgets sharing an anchor', () => {
    const items = [
      { anchor: 'bottom-left' as const, width: 100, height: 50 },
      { anchor: 'bottom-left' as const, width: 80, height: 30 },
      { anchor: 'middle-right' as const, width: 100, height: 40 },
      { anchor: 'middle-right' as const, width: 60, height: 40 },
    ]
    expect(layoutWidgets(items, size, 10)).toEqual([
      { x: 50, y: 385 },
      { x: 50, y: 445 },
      { x: 850, y: 205 },
      { x: 890, y: 255 },
    ])
  })

  it('places a widget with an offset out of its stack, from its corner towards the inside', () => {
    const items = [
      { anchor: 'bottom-left' as const, width: 100, height: 50, offset: { x: 30, y: 20 } },
      { anchor: 'bottom-left' as const, width: 80, height: 30 },
      { anchor: 'bottom-right' as const, width: 100, height: 50, offset: { x: 30, y: 20 } },
      { anchor: 'center' as const, width: 200, height: 100, offset: { x: -40, y: 10 } },
      { anchor: 'top-left' as const, width: 100, height: 50, offset: { x: 0, y: 0 } },
      { anchor: 'top-left' as const, width: 100, height: 50 },
    ]
    expect(layoutWidgets(items, size, 10)).toEqual([
      // from the bottom-left corner of the safe area, 30 right and 20 up
      { x: 80, y: 475 - 50 - 20 },
      // the other widget of the anchor closes up as if alone
      { x: 50, y: 445 },
      // from the bottom-right corner, 30 left and 20 up
      { x: 950 - 100 - 30, y: 475 - 50 - 20 },
      // centred axes: to the right and down
      { x: 360, y: 210 },
      // overlaps the widget stacked at its anchor
      { x: 50, y: 25 },
      { x: 50, y: 25 },
    ])
  })
})

describe('drawOverlay', () => {
  it('draws nothing while disabled', () => {
    expect(draw(0.5, DEFAULT_OVERLAY).calls).toEqual([])
  })

  it.each(OVERLAY_STYLES)('style %s: title card, then counters and profile, then closing card', (style) => {
    const settings = enabled({ style })
    const opening = draw(0.02, settings)
    expect(opening.joined.toLowerCase()).toContain('12 juillet 2025')
    expect(opening.joined).not.toMatch(/Distance/i)

    const middle = draw(0.5, settings)
    for (const label of ['Distance', 'Altitude', 'D+', 'Temps']) expect(middle.joined.toLowerCase()).toContain(label.toLowerCase())
    expect(middle.joined).not.toContain('Vitesse')
    expect(middle.calls).toContain('arc(5)') // profile marker

    const closing = draw(0.99, settings)
    for (const label of ['Dénivelé +', 'Altitude max', 'Durée', 'Vitesse max']) expect(closing.joined.toLowerCase()).toContain(label.toLowerCase())

    // every text starts inside the safe area (a structure draws its own furniture beyond it)
    for (const { x, y } of FREE_STYLES.includes(style) ? [...opening.texts, ...middle.texts, ...closing.texts] : []) {
      expect(x).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
      expect(x).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
      expect(y).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
      expect(y).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
    }
  })

  it('uses the custom titles, the chosen counters and the free text', () => {
    const settings = enabled({
      title: { ...DEFAULT_OVERLAY.title, title: 'Ma sortie', subtitle: 'Chamonix', showDate: false },
      counters: { ...DEFAULT_OVERLAY.counters, fields: { ...DEFAULT_OVERLAY.counters.fields, distance: false, heartRate: true } },
      text: { ...DEFAULT_OVERLAY.text, enabled: true, text: 'avec Marie' },
    })
    const opening = draw(0.02, settings).joined
    expect(opening).toContain('Ma sortie')
    expect(opening).toContain('CHAMONIX')
    expect(opening).not.toContain('2025')
    const middle = draw(0.5, settings).joined
    expect(middle).not.toMatch(/Distance/i)
    expect(middle).toMatch(/FC/)
    expect(middle).toContain('bpm')
    expect(middle).toContain('avec Marie')
  })

  it('crossfades the live widgets with the opening card', () => {
    const { texts } = draw(0.09, enabled())
    const counter = texts.find((t) => t.text.toLowerCase() === 'distance')
    expect(counter?.alpha).toBeGreaterThan(0)
    expect(counter?.alpha).toBeLessThan(1)
  })

  it('shows the weather under the marker and on the closing card, with its source', () => {
    const hours = 14
    const constant = (v: number) => new Array<number>(hours).fill(v)
    const values = {} as Record<WeatherVariable, number[]>
    for (const v of WEATHER_VARIABLES) values[v] = constant(0)
    Object.assign(values, { temperature: constant(14), weatherCode: constant(1), windSpeed: constant(12), windDirection: constant(315) })
    const series: WeatherSeries = {
      time: Array.from({ length: hours }, (_, h) => Date.UTC(2025, 6, 12, 5) + h * 3_600_000),
      stations: [{ lon: 6.77, lat: 45.86, values }],
    }
    const withWeather = prepareOverlayTrack(sampleTrack, series)
    const settings = enabled({ weather: { ...DEFAULT_OVERLAY.weather, enabled: true } })
    const render = (progress: number, s = settings) => {
      const { ctx, texts } = fakeContext()
      drawOverlay(ctx, overlayFrameAt(withWeather, progress), s, SIZE)
      return texts.map((t) => t.text).join(' | ')
    }
    const middle = render(0.5)
    expect(middle.toLowerCase()).toContain('plutôt dégagé')
    expect(middle).toContain('°C')
    expect(middle.toLowerCase()).toContain('vent no')
    expect(middle).toContain(openMeteoAttribution())
    const closing = render(0.99, enabled())
    expect(closing.toLowerCase()).toContain("plutôt dégagé · 14 °c · vent jusqu'à 12 km/h")
    expect(closing).toContain(openMeteoAttribution())
    // no weather shown, no credit
    expect(render(0.5, enabled())).not.toContain(openMeteoAttribution())
    expect(draw(0.5, settings).joined).not.toContain(openMeteoAttribution())
  })

  it('draws the logo when its image is loaded', () => {
    const settings = enabled({ logo: { ...DEFAULT_OVERLAY.logo, enabled: true, image: 'data:image/png;base64,AAAA' } })
    const { ctx, calls } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, 0.5), settings, SIZE, { logo: { image: {} as CanvasImageSource, width: 400, height: 100 } })
    expect(calls).toContain('drawImage(5)')
  })

  it('draws the logo at its opacity, at its free position scaled from the exported film', () => {
    const image = { image: {} as CanvasImageSource, width: 400, height: 100 }
    const logo = { ...DEFAULT_OVERLAY.logo, enabled: true, image: 'data:image/png;base64,AAAA', anchor: 'top-left' as const }
    const drawn = (patch: Partial<OverlaySettings['logo']>, extras: OverlayExtras = {}) => {
      const { ctx, images } = fakeContext()
      drawOverlay(ctx, overlayFrameAt(track, 0.5), enabled({ logo: { ...logo, ...patch } }), SIZE, { logo: image }, extras)
      return images[0]
    }
    expect(drawn({}).alpha).toBe(1)
    expect(drawn({ opacity: 0.4 }).alpha).toBeCloseTo(0.4)
    expect(drawn({ opacity: 0 })).toBeUndefined()
    const left = SIZE.width * SAFE_MARGIN
    const top = SIZE.height * SAFE_MARGIN
    // at the corner of the counters, out of their stack
    expect(drawn({ offset: { x: 100, y: 40 } }).args.slice(0, 2)).toEqual([left + 100, top + 40])
    // measured in pixels of a 4K film: half as far on this 1080p frame
    expect(drawn({ offset: { x: 100, y: 40 } }, { exportSize: { width: 3840, height: 2160 } }).args.slice(0, 2)).toEqual([left + 50, top + 20])
  })
})

describe('position dot colour (mini-map and profile)', () => {
  const off = <T extends { enabled: boolean }>(w: T): T => ({ ...w, enabled: false })
  const only = (widget: 'minimap' | 'profile', own: string | undefined): OverlaySettings =>
    enabled({
      title: off(DEFAULT_OVERLAY.title),
      end: off(DEFAULT_OVERLAY.end),
      counters: off(DEFAULT_OVERLAY.counters),
      profile: { ...DEFAULT_OVERLAY.profile, enabled: widget === 'profile', markerColor: widget === 'profile' ? own : undefined },
      minimap: { ...DEFAULT_OVERLAY.minimap, enabled: widget === 'minimap', markerColor: widget === 'minimap' ? own : undefined },
    })
  const fillsOf = (settings: OverlaySettings, markerColor?: string) => {
    const { ctx, fills } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, 0.5), settings, SIZE, {}, { markerColor })
    return fills
  }

  it.each(['minimap', 'profile'] as const)('%s: the dot takes the own colour, else the 3D marker colour, else the style one', (widget) => {
    const own = fillsOf(only(widget, '#aa0000'), '#112233')
    expect(own).toContain('#aa0000')
    expect(own).not.toContain('#112233')
    const marker = fillsOf(only(widget, undefined), '#112233')
    expect(marker).toContain('#112233')
    expect(marker).not.toContain('#aa0000')
    // '' is as absent: the marker's colour
    expect(fillsOf(only(widget, ''), '#112233')).toContain('#112233')
    const style = fillsOf(only(widget, undefined))
    expect(style).not.toContain('#112233')
  })
})

describe('mini-map', () => {
  const off = <T extends { enabled: boolean }>(w: T): T => ({ ...w, enabled: false })
  /** only the mini-map, with the cards still timing the live widgets */
  const minimapOnly = (patch: Partial<OverlaySettings['minimap']> = {}, style: OverlaySettings['style'] = 'broadcast') =>
    enabled({
      style,
      counters: off(DEFAULT_OVERLAY.counters),
      profile: off(DEFAULT_OVERLAY.profile),
      minimap: { ...DEFAULT_OVERLAY.minimap, enabled: true, ...patch },
    })
  const render = (progress: number, settings: OverlaySettings) => {
    const { ctx, texts, points } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE)
    return { texts, points }
  }
  /** arcs of the mini-map: end dot, start dot, marker */
  const dots = (progress: number, settings = minimapOnly()) => render(progress, settings).points.filter((pt) => pt.op === 'arc')

  it('is off by default', () => {
    expect(DEFAULT_OVERLAY.minimap.enabled).toBe(false)
    expect(draw(0.5, enabled()).texts.map((t) => t.text)).not.toContain('N')
  })

  it('puts the marker on the start dot, then on the end dot', () => {
    const noCards = { ...minimapOnly(), title: off(DEFAULT_OVERLAY.title), end: off(DEFAULT_OVERLAY.end) }
    const [end, start, marker] = dots(0, noCards)
    expect(marker.r).toBeGreaterThan(start.r!)
    expect([marker.x, marker.y]).toEqual([start.x, start.y])
    const last = dots(1, noCards)
    expect([last[2].x, last[2].y]).toEqual([end.x, end.y])
    const middle = dots(0.5, noCards)
    expect([middle[0].x, middle[1].x]).toEqual([end.x, start.x])
    expect([middle[2].x, middle[2].y]).not.toEqual([start.x, start.y])
    expect([middle[2].x, middle[2].y]).not.toEqual([end.x, end.y])
  })

  it('keeps the aspect ratio of the track', () => {
    const outline = track.outline!
    // the first point starts the outline of the panel
    const route = render(0.5, minimapOnly({ northArrow: false })).points.filter((pt) => pt.op !== 'arc').slice(1)
    const xs = route.map((pt) => pt.x)
    const ys = route.map((pt) => pt.y)
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))
    expect(ratio).toBeCloseTo(outline.width / outline.height, 6)
  })

  it.each(FREE_STYLES)('style %s: stays inside the safe area at every anchor', (style) => {
    for (const anchor of OVERLAY_ANCHORS) {
      for (const size of [1, 2]) {
        const { texts, points } = render(0.5, minimapOnly({ anchor, size }, style))
        expect(texts.map((t) => t.text)).toEqual(['N'])
        for (const pt of [...points, ...texts]) {
          const r = 'r' in pt ? (pt.r ?? 0) : 0
          expect(pt.x - r).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
          expect(pt.x + r).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
          expect(pt.y - r).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
          expect(pt.y + r).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
        }
      }
    }
  })

  it('stacks under another widget of the same anchor', () => {
    const alone = render(0.5, minimapOnly({ anchor: 'top-right' }))
    const withProfile = render(0.5, { ...minimapOnly({ anchor: 'top-right' }), profile: { ...DEFAULT_OVERLAY.profile, anchor: 'top-right' } })
    const shift = DEFAULT_OVERLAY.profile.height * SIZE.height + 2 * (Math.min(SIZE.width, SIZE.height) / 100)
    const n = (r: ReturnType<typeof render>) => r.texts.find((t) => t.text === 'N')!
    expect(n(withProfile).y - n(alone).y).toBeCloseTo(shift, 6)
    expect(n(withProfile).x).toBeCloseTo(n(alone).x, 6)
  })

  it('crossfades with the cards like the other live widgets', () => {
    const settings = minimapOnly()
    const n = (progress: number) => render(progress, settings).texts.find((t) => t.text === 'N')
    expect(n(0.02)).toBeUndefined()
    expect(n(0.09)?.alpha).toBeGreaterThan(0)
    expect(n(0.09)?.alpha).toBeLessThan(1)
    expect(n(0.5)?.alpha).toBe(1)
    expect(n(0.99)).toBeUndefined()
  })

  it('draws the north arrow on request only', () => {
    expect(render(0.5, minimapOnly({ northArrow: false })).texts).toEqual([])
  })
})

describe('leaderboard', () => {
  const rows = [
    { rank: 1, name: 'Chloé', color: '#3F6B4A', gap: 'Tête' },
    { rank: 2, name: 'Bob', color: '#A9CCD9', gap: '+1 min 20' },
  ]
  const drawBoard = (settings: OverlaySettings, leaderboard: OverlayExtras['leaderboard']) => {
    const { ctx, texts } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, 0.5), settings, SIZE, {}, { leaderboard })
    return texts.map((t) => t.text).join(' | ')
  }
  const on = enabled({ leaderboard: { ...DEFAULT_OVERLAY.leaderboard, enabled: true } })

  it('is off by default', () => {
    expect(drawBoard(enabled(), rows)).not.toMatch(/classement/i)
  })

  it.each(OVERLAY_STYLES)('style %s: one line per racer under its heading', (style) => {
    const joined = drawBoard({ ...on, style }, rows)
    expect(joined.toLowerCase()).toContain('classement')
    for (const text of ['1', 'Chloé', 'Tête', '2', 'Bob', '+1 min 20']) expect(joined).toContain(text)
  })

  it('needs two racers', () => {
    expect(drawBoard(on, rows.slice(0, 1))).not.toMatch(/classement/i)
    expect(drawBoard(on, undefined)).not.toMatch(/classement/i)
  })
})

describe('timeline texts', () => {
  const texts: FilmText[] = [
    { ...FILM_TEXT, startS: 0.4, durationS: 0.4, subtitle: 'Frontière' },
    { ...FILM_TEXT, id: 'text-2', startS: 0.45, durationS: 0.3, text: 'Vers Trient' },
  ]
  const render = (progress: number, settings: OverlaySettings, extras: OverlayExtras = { texts }) => {
    const { ctx, texts: drawn } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE, {}, extras)
    return drawn
  }
  const find = (drawn: TextCall[], text: string) => drawn.find((t) => t.text.toLocaleLowerCase('fr') === text.toLocaleLowerCase('fr'))

  it('draws each text inside its window only, with its subtitle', () => {
    expect(find(render(0.3, enabled()), 'Col de Balme')).toBeUndefined()
    const middle = render(0.6, enabled())
    expect(find(middle, 'Col de Balme')?.alpha).toBe(1)
    expect(find(middle, 'Frontière')).toBeDefined()
    expect(find(render(0.81, enabled()), 'Col de Balme')).toBeUndefined()
    // the film time drives them, not the progress
    expect(find(render(0.1, enabled(), { texts, time: { ...progressTime(0.1), timeS: 0.6 } }), 'Col de Balme')).toBeDefined()
  })

  it('stacks the texts sharing an anchor', () => {
    const drawn = render(0.6, enabled())
    const first = find(drawn, 'Col de Balme')!
    const second = find(drawn, 'Vers Trient')!
    expect(second.y).toBeGreaterThan(first.y)
  })

  it.each(OVERLAY_STYLES)('style %s: stays inside the safe area at every anchor and size', (style) => {
    const off = { ...enabled({ style }), counters: { ...DEFAULT_OVERLAY.counters, enabled: false }, profile: { ...DEFAULT_OVERLAY.profile, enabled: false } }
    for (const anchor of OVERLAY_ANCHORS) {
      for (const size of [0.5, 2]) {
        const long = { ...FILM_TEXT, startS: 40, durationS: 20, anchor, size, text: 'Une très longue légende '.repeat(40), subtitle: 'Sous-titre' }
        // mid-flight of a 100 s film: no card
        const drawn = render(0.5, off, { texts: [long], time: { timeS: 50, openingS: 0, flightS: 100, totalS: 100 } })
        // two lines and the subtitle
        expect(drawn).toHaveLength(3)
        for (const { x, y } of drawn) {
          expect(x).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
          expect(x).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
          expect(y).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
          expect(y).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
        }
        // two lines, the second cut with an ellipsis
        expect(drawn[1].text.endsWith('…')).toBe(true)
      }
    }
  })

  it('draws a text in its own font when it has one', () => {
    const own = [{ ...FILM_TEXT, startS: 0.4, durationS: 0.4, font: 'mono' as const }]
    expect(find(render(0.6, enabled(), { texts: own }), 'Col de Balme')?.font).toContain(OVERLAY_FONT_FAMILIES.mono)
    expect(find(render(0.6, enabled()), 'Col de Balme')?.font).not.toContain(OVERLAY_FONT_FAMILIES.mono)
  })

  it('is not drawn while the overlay is off', () => {
    expect(find(render(0.6, DEFAULT_OVERLAY), 'Col de Balme')).toBeUndefined()
  })
})

describe('source credits', () => {
  const credits = ['Relief : © Mapterhorn', 'Imagerie : © IGN']
  const render = (settings: OverlaySettings, extras: OverlayExtras = { credits }, progress = 0.5) => {
    const { ctx, texts, calls } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE, {}, extras)
    return { texts, calls, joined: texts.map((t) => t.text).join(' | ') }
  }

  it('are on by default, drawn even without the rest of the overlay', () => {
    expect(DEFAULT_OVERLAY.credits.enabled).toBe(true)
    const { texts } = render(DEFAULT_OVERLAY)
    expect(texts.map((t) => t.text)).toEqual(['Relief : © Mapterhorn · Imagerie : © IGN'])
  })

  it('are left out on request', () => {
    const off = { ...DEFAULT_OVERLAY, credits: { ...DEFAULT_OVERLAY.credits, enabled: false } }
    expect(render(off).calls).toEqual([])
    expect(render({ ...off, enabled: true }).joined).not.toContain('Mapterhorn')
  })

  it('sit in the chosen corner, along the edge outside the safe area', () => {
    const at = (position: OverlaySettings['credits']['position']) =>
      render({ ...DEFAULT_OVERLAY, credits: { enabled: true, position } }).texts[0]
    const u = Math.min(SIZE.width, SIZE.height) / 100
    expect(at('bottom-right').x).toBeCloseTo(SIZE.width * (1 - SAFE_MARGIN) - 0.6 * u, 6)
    expect(at('bottom-left').x).toBeCloseTo(SIZE.width * SAFE_MARGIN + 0.6 * u, 6)
    for (const position of ['bottom-right', 'bottom-left'] as const) expect(at(position).y).toBeGreaterThan(SIZE.height * (1 - SAFE_MARGIN))
    for (const position of ['top-right', 'top-left'] as const) expect(at(position).y).toBeLessThan(SIZE.height * SAFE_MARGIN)
  })

  it('wrap a long line over the safe width', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Source ${i} : © un fournisseur de données ouvertes`)
    const { texts } = render(DEFAULT_OVERLAY, { credits: long })
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.map((t) => t.text).join(' ')).toBe(long.join(' · '))
  })

  it('hold the Open-Meteo credit once the weather is shown', () => {
    const settings = enabled({ weather: { ...DEFAULT_OVERLAY.weather, enabled: true } })
    const hours = 14
    const values = {} as Record<WeatherVariable, number[]>
    for (const v of WEATHER_VARIABLES) values[v] = new Array<number>(hours).fill(1)
    const series: WeatherSeries = {
      time: Array.from({ length: hours }, (_, h) => Date.UTC(2025, 6, 12, 5) + h * 3_600_000),
      stations: [{ lon: 6.77, lat: 45.86, values }],
    }
    const { ctx, texts } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(prepareOverlayTrack(sampleTrack, series), 0.5), settings, SIZE, {}, { credits: [...credits, openMeteoAttribution()] })
    const joined = texts.map((t) => t.text).join(' ')
    expect(joined.split(openMeteoAttribution()).length).toBe(2)
    expect(joined).toContain('Mapterhorn')
  })
})

describe('dip of a shot transition', () => {
  const credits = ['Relief : © Mapterhorn']
  const render = (settings: OverlaySettings, extras: OverlayExtras) => {
    const drawn = fakeContext()
    drawOverlay(drawn.ctx, overlayFrameAt(track, 0.5), settings, SIZE, {}, extras)
    return drawn
  }

  it('one full-frame layer at its opacity, even without the overlay, under the credits only', () => {
    const { order, calls } = render(enabled({ text: { ...DEFAULT_OVERLAY.text, enabled: true, text: 'Bonjour' } }), {
      credits,
      dip: { color: 'black', alpha: 0.6 },
    })
    expect(calls.filter((c) => c === 'fillRect(4)').length).toBeGreaterThanOrEqual(1)
    const dip = order.indexOf('rect black 0.6')
    expect(dip).toBeGreaterThan(0)
    // the overlay text under it, the credits line over it
    expect(order.slice(0, dip)).toContain('text')
    expect(order.slice(dip + 1)).toEqual(['text'])
    const off = { ...DEFAULT_OVERLAY, credits: { ...DEFAULT_OVERLAY.credits, enabled: false } }
    expect(render(off, { dip: { color: 'white', alpha: 1 } }).order).toEqual(['rect white 1'])
    expect(render(off, { dip: { color: 'white', alpha: 0 } }).calls).toEqual([])
    expect(render(off, { dip: null }).calls).toEqual([])
  })
})

describe('stage card « À la suite »', () => {
  const off = { ...DEFAULT_OVERLAY, credits: { ...DEFAULT_OVERLAY.credits, enabled: false } }
  const stage: StageCard = {
    name: 'Jour 2',
    index: 1,
    count: 3,
    startTime: Date.UTC(2026, 6, 2, 8),
    distanceM: 18_400,
    ascentM: 1250,
    startS: 40,
    durationS: 5,
    anchor: 'center',
    size: 1,
  }
  const draw = (settings: OverlaySettings, timeS: number, card = stage, dip: OverlayExtras['dip'] = null) => {
    const drawn = fakeContext()
    drawOverlay(drawn.ctx, overlayFrameAt(track, 0.5), settings, SIZE, {}, { time: { timeS, openingS: 0, flightS: 100, totalS: 100 }, stage: card, dip })
    return drawn
  }
  const render = (settings: OverlaySettings, timeS: number, card = stage) =>
    draw(settings, timeS, card)
      .texts.map((t) => t.text)
      .join(' ')

  it('name, number, date, distance and D+ inside its window, even without the overlay', () => {
    const shown = render(off, 42)
    expect(shown).toContain('Jour 2')
    expect(shown).toMatch(/Étape 2 sur 3/i)
    expect(shown.toLowerCase()).toContain(formatLongDate(stage.startTime!))
    expect(shown).toContain('18,4')
    expect(shown).toMatch(/1\s250/)
    expect(render(off, 39)).toBe('')
    expect(render(off, 45)).toBe('')
  })

  it('the film can word its own card: its text and subtitle with the stage’s figures filled in', () => {
    const own = { ...stage, text: '{name} — jour {n}', subtitle: '{distance} · {ascent}' }
    const shown = render(off, 42, own)
    expect(shown).toContain('Jour 2 — jour 2')
    expect(shown).toContain('18,4')
    expect(shown).toMatch(/1\s250 m/i)
    expect(shown).not.toMatch(/Étape 2 sur 3/i)
    expect(render(off, 42, { ...own, text: '', subtitle: undefined })).toBe('')
  })

  it('drawn over the dip it lives in, not under it', () => {
    const { order } = draw(off, 42, stage, { color: 'black', alpha: 1 })
    expect(order.indexOf('rect black 1')).toBeGreaterThanOrEqual(0)
    expect(order.slice(order.indexOf('rect black 1') + 1)).toContain('text')
    expect(order.slice(0, order.indexOf('rect black 1'))).not.toContain('text')
  })

  it('the first stage gives way to the title card of the film', () => {
    const first = { ...stage, index: 0, startS: 0 }
    expect(render(off, 2, first)).toContain('Jour 2')
    expect(render(enabled({}), 2, first)).not.toMatch(/Étape 1 sur 3/i)
  })
})

describe('timeline photos', () => {
  const image = { image: {} as CanvasImageSource, width: 3000, height: 2000 }
  const assets = { photo: (src: string) => (src === 'photo-1' ? image : undefined) }
  const full: FilmMedia = { id: 'media-1', startS: 40, durationS: 20, kind: 'image', src: 'photo-1', ...MEDIA_DEFAULTS }
  const card: FilmMedia = { ...full, id: 'media-2', layout: 'carte', anchor: 'top-right', kenBurns: false, caption: 'Lac Blanc' }
  const noCredits = { ...DEFAULT_OVERLAY, credits: { ...DEFAULT_OVERLAY.credits, enabled: false } }
  /** a 100 s film without cards */
  const at = (timeS: number) => ({ timeS, openingS: 0, flightS: 100, totalS: 100 })
  const render = (settings: OverlaySettings, media: FilmMedia[], timeS: number, extras: OverlayExtras = {}) => {
    const drawn = fakeContext()
    drawOverlay(drawn.ctx, overlayFrameAt(track, 0.5), settings, SIZE, assets, { media, time: at(timeS), ...extras })
    return drawn
  }

  it('full screen: covers the frame inside its window, under everything, even without the overlay', () => {
    expect(render(noCredits, [full], 39).images).toEqual([])
    const { images, order } = render(DEFAULT_OVERLAY, [full], 50, { credits: ['Relief : © Mapterhorn'] })
    expect(images).toHaveLength(1)
    expect(images[0].args.slice(4)).toEqual([0, 0, SIZE.width, SIZE.height])
    expect(images[0].alpha).toBe(1)
    expect(order).toEqual(['image', 'text'])
    expect(render(noCredits, [full], 40.2).images[0].alpha).toBeCloseTo(0.5, 6)
    expect(render(noCredits, [full], 60).images).toEqual([])
    // not loaded yet, or a video without its frame: nothing
    expect(render(noCredits, [{ ...full, src: 'photo-2' }], 50).calls).toEqual([])
    expect(render(noCredits, [{ ...full, kind: 'video' }], 50).calls).toEqual([])
  })

  it('video: the frame at its time in the file, full screen without Ken Burns or as a card', () => {
    const asked: number[] = []
    const frame = { image: {} as CanvasImageSource, width: 1920, height: 1080 }
    const video = (_item: FilmMedia, clipS: number) => (asked.push(clipS), frame)
    const clip: FilmMedia = { ...full, kind: 'video', src: 'video-1', inS: 3 }
    const draw = (media: FilmMedia, timeS: number) => {
      const drawn = fakeContext()
      drawOverlay(drawn.ctx, overlayFrameAt(track, 0.5), noCredits, SIZE, { ...assets, video }, { media: [media], time: at(timeS) })
      return drawn.images
    }
    expect(draw(clip, 42)[0].args.slice(4)).toEqual([0, 0, SIZE.width, SIZE.height])
    expect(asked).toEqual([5])
    // Ken Burns is for photos: the crop holds still
    expect(draw(clip, 42)[0].args.slice(0, 4)).toEqual(draw(clip, 58)[0].args.slice(0, 4))
    expect(draw({ ...clip, layout: 'carte' }, 50)).toHaveLength(1)
    expect(draw(clip, 61)).toEqual([])
    // a playing clip changes every frame: the export renders the held frames again
    expect(overlayTimedState(DEFAULT_OVERLAY, [], at(50), [{ ...clip, layout: 'carte' }])).toEqual([1, 50])
    // following the flight: the frame recorded under the marker, whatever the film time
    const recorded = recordedAtProgress(track.path, 0.5)!
    expect(recorded).toBeGreaterThan(0)
    const following: FilmMedia = { ...clip, inS: 0, sync: { startMs: recorded - 12_000, offsetS: 0, follow: true } }
    asked.length = 0
    draw(following, 42)
    draw(following, 58)
    expect(asked).toEqual([12, 12])
  })

  it('full screen: the Ken Burns move follows the film time, still without it', () => {
    const crop = (media: FilmMedia, timeS: number) => render(noCredits, [media], timeS).images[0].args.slice(0, 4)
    expect(crop(full, 42)).not.toEqual(crop(full, 58))
    const still = { ...full, kenBurns: false }
    expect(crop(still, 42)).toEqual(crop(still, 58))
  })

  it('full screen: the live widgets give way, the caption is drawn like a text', () => {
    const settings = enabled({ title: { ...DEFAULT_OVERLAY.title, enabled: false }, end: { ...DEFAULT_OVERLAY.end, enabled: false } })
    const labels = (timeS: number, media: FilmMedia[]) => render(settings, media, timeS).texts.map((t) => t.text.toLocaleLowerCase('fr'))
    expect(labels(30, [full])).toContain('distance')
    expect(labels(50, [full])).not.toContain('distance')
    const captioned = render(noCredits, [{ ...full, caption: 'Lac Blanc', anchor: 'bottom-left' }], 50).texts
    expect(captioned.map((t) => t.text)).toEqual(['Lac Blanc'])
    expect(captioned[0].x).toBeCloseTo(SIZE.width * SAFE_MARGIN, 6)
  })

  it.each(OVERLAY_STYLES)('card, style %s: picture and caption inside the safe area at every anchor and size', (style) => {
    for (const anchor of OVERLAY_ANCHORS) {
      for (const size of [0.5, 2]) {
        const { images, texts } = render({ ...noCredits, style }, [{ ...card, anchor, size, caption: 'Une très longue légende '.repeat(20) }], 50)
        expect(images).toHaveLength(1)
        const [x, y, w, h] = images[0].args
        expect(w / h).toBeCloseTo(1.5, 6)
        expect(x).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
        expect(x + w).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
        expect(y).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
        expect(y + h).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
        expect(texts).toHaveLength(1)
        expect(texts[0].text.endsWith('…')).toBe(true)
        expect(texts[0].y).toBeGreaterThan(y + h)
        expect(texts[0].y).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
      }
    }
  })

  it('times the photos for the export: opacity, and the time while a full-screen photo moves', () => {
    expect(overlayTimedState(DEFAULT_OVERLAY, [], at(50), [full, card])).toEqual([1, 50, 1])
    expect(overlayTimedState(DEFAULT_OVERLAY, [], at(30), [full, card])).toEqual([0, 0])
    expect(overlayTimedState(enabled(), [], at(50), [{ ...full, kenBurns: false }])).toEqual([0, 0, 1])
  })

  it('Ken Burns crop: inside the picture, frame proportions, zoom from 1 to KEN_BURNS_ZOOM', () => {
    for (let seed = 0; seed < 8; seed++) {
      for (const t of [0, 0.3, 1]) {
        for (const [iw, ih] of [[3000, 2000], [2000, 3000], [1920, 1080]]) {
          const c = kenBurnsCrop(iw, ih, 1920, 1080, t, seed, true)
          expect(c.sx).toBeGreaterThanOrEqual(-1e-9)
          expect(c.sy).toBeGreaterThanOrEqual(-1e-9)
          expect(c.sx + c.sw).toBeLessThanOrEqual(iw + 1e-9)
          expect(c.sy + c.sh).toBeLessThanOrEqual(ih + 1e-9)
          expect(c.sw / c.sh).toBeCloseTo(1920 / 1080, 6)
        }
      }
    }
    // portrait picture covering a landscape frame: full width at zoom 1
    expect(kenBurnsCrop(2000, 3000, 1920, 1080, 0, 0, true).sw).toBeCloseTo(2000, 6)
    expect(kenBurnsCrop(2000, 3000, 1920, 1080, 1, 0, true).sw).toBeCloseTo(2000 / KEN_BURNS_ZOOM, 6)
    expect(kenBurnsCrop(2000, 3000, 1920, 1080, 0, 1, true).sw).toBeCloseTo(2000 / KEN_BURNS_ZOOM, 6)
    const still = kenBurnsCrop(2000, 3000, 1920, 1080, 0.9, 3, false)
    expect(still.sx).toBeCloseTo(0, 6)
    expect(still.sy).toBeCloseTo((3000 - still.sh) / 2, 6)
  })
})

describe('colours and fonts of one widget', () => {
  it('draw that widget with its own font, the others with the overlay\'s', () => {
    const settings = enabled({ title: { ...DEFAULT_OVERLAY.title, enabled: false }, counters: { ...DEFAULT_OVERLAY.counters, overrides: { numberFont: 'mono' } } })
    const { texts } = draw(0.5, settings)
    const value = texts.find((t) => /km/.test(t.text) || /^\d/.test(t.text))
    expect(value?.font).toContain('monospace')
    const plain = draw(0.5, enabled({ title: { ...DEFAULT_OVERLAY.title, enabled: false } })).texts
    expect(plain.some((t) => t.font.includes('monospace'))).toBe(false)
  })
})

describe('text backing of a style without panel', () => {
  const run = (style: OverlaySettings['style'], textBacking?: (typeof TEXT_BACKINGS)[number]) => {
    const { ctx, calls, offsets } = fakeContext()
    const overrides = textBacking ? { textBacking } : undefined
    drawOverlay(ctx, overlayFrameAt(track, 0.5), enabled({ style, ...(overrides ? { overrides } : {}) }), SIZE)
    return { strokes: calls.filter((c) => c.startsWith('strokeText')).length, offsets }
  }

  it('is a blurred rounded rectangle by default: drawn off the canvas, its shadow lands in place', () => {
    const { strokes, offsets } = run('editorial')
    expect(offsets.length).toBeGreaterThan(0)
    expect(offsets.every((o) => o > 0)).toBe(true)
    expect(strokes).toBe(0)
    expect(run('editorial', 'blur')).toEqual({ strokes, offsets })
  })

  it('is the shadow of the text only: no rectangle, no outline', () => {
    expect(run('editorial', 'shadow')).toEqual({ strokes: 0, offsets: [] })
  })

  it('is the outline of the text only: no rectangle', () => {
    const { strokes, offsets } = run('editorial', 'outline')
    expect(strokes).toBeGreaterThan(0)
    expect(offsets).toEqual([])
  })

  it('leaves the styles with a panel alone', () => {
    for (const backing of TEXT_BACKINGS) expect(run('broadcast', backing).strokes).toBe(0)
  })
})

describe('styles with a structure', () => {
  const U = SIZE.height / 100
  const SAFE_LEFT = SIZE.width * SAFE_MARGIN
  const styled = (style: OverlaySettings['style'], patch: Partial<OverlaySettings> = {}): OverlaySettings => ({ ...withStyleLayout(DEFAULT_OVERLAY, style), enabled: true, ...patch })
  const off = <T extends { enabled: boolean }>(w: T): T => ({ ...w, enabled: false })
  const render = (settings: OverlaySettings, progress: number, extras: OverlayExtras = {}, data = track) => {
    const result = fakeContext()
    drawOverlay(result.ctx, overlayFrameAt(data, progress), settings, SIZE, {}, extras)
    return result
  }
  const hours = 14
  const constant = (v: number) => new Array<number>(hours).fill(v)
  const weatherValues = {} as Record<WeatherVariable, number[]>
  for (const v of WEATHER_VARIABLES) weatherValues[v] = constant(0)
  Object.assign(weatherValues, { temperature: constant(14), weatherCode: constant(1), windSpeed: constant(12), windDirection: constant(315) })
  const withWeather = prepareOverlayTrack(sampleTrack, {
    time: Array.from({ length: hours }, (_, h) => Date.UTC(2025, 6, 12, 5) + h * 3_600_000),
    stations: [{ lon: 6.77, lat: 45.86, values: weatherValues }],
  })
  const inFrame = (pt: { x: number; y: number }) => pt.x >= 0 && pt.x <= SIZE.width && pt.y >= 0 && pt.y <= SIZE.height
  const px = (t: TextCall) => Number(/(\d+(?:\.\d+)?)px/.exec(t.font)![1])

  describe('Cinéma', () => {
    const BAR = 0.11 * SIZE.height
    const cinema = (patch: Partial<OverlaySettings> = {}) => styled('cinema', patch)
    const inBottomBar = (t: TextCall) => t.y > SIZE.height - BAR
    const inTopBar = (t: TextCall) => t.y < BAR

    it('draws a pure black bar at the top and at the bottom, even with every widget off', () => {
      const bare = cinema({ counters: off(DEFAULT_OVERLAY.counters), profile: off(DEFAULT_OVERLAY.profile) })
      const bars = render(bare, 0.5).rects.filter((r) => r.fill === '#000000')
      expect(bars).toEqual([
        { x: 0, y: 0, w: SIZE.width, h: BAR, fill: '#000000', alpha: 1 },
        { x: 0, y: SIZE.height - BAR, w: SIZE.width, h: BAR, fill: '#000000', alpha: 1 },
      ])
      expect(BAR / SIZE.height).toBeCloseTo(0.11, 9)
      // the bars are part of the overlay: none while it is off
      expect(render({ ...bare, enabled: false }, 0.5).rects).toEqual([])
    })

    it('puts the counters on one line in the middle of the bottom bar, widely spaced and separated by dots, not in the corners', () => {
      const { texts } = render(cinema(), 0.5)
      const line = texts.filter(inBottomBar)
      const parts = line.filter((t) => t.text !== '·')
      expect(parts.map((t) => t.text)).toEqual([
        expect.stringMatching(/^\d+,\d km$/),
        expect.stringMatching(/^alt\. [\d ]+ m$/),
        expect.stringMatching(/^D\+ [\d ]+ m$/),
        expect.stringMatching(/^(\d+ h \d\d|\d+ min)$/),
      ])
      expect(line.filter((t) => t.text === '·')).toHaveLength(3)
      // one baseline, left to right, centred on the frame
      for (const t of line) expect(t.y).toBeCloseTo(line[0].y, 6)
      const xs = line.map((t) => t.x)
      expect(xs).toEqual([...xs].sort((a, b) => a - b))
      expect((xs[0] + xs[xs.length - 1]) / 2).toBeGreaterThan(SIZE.width * 0.4)
      expect((xs[0] + xs[xs.length - 1]) / 2).toBeLessThan(SIZE.width * 0.6)
      expect(xs[0]).toBeGreaterThan(SIZE.width * 0.25)
      expect(xs[xs.length - 1]).toBeLessThan(SIZE.width * 0.75)
      // small type, no label on the line
      expect(line[0].font).toMatch(/^500 \d+(\.\d+)?px "IBM Plex Sans"/)
      expect(texts.map((t) => t.text.toLowerCase())).not.toContain('distance')
      expect(texts.filter((t) => !inBottomBar(t) && !inTopBar(t))).toEqual([])
    })

    it('keeps the place of each figure of the line while the figures change', () => {
      const first = render(cinema(), 0.3).texts.filter(inBottomBar).filter((t) => t.text !== '·')
      const second = render(cinema(), 0.7).texts.filter(inBottomBar).filter((t) => t.text !== '·')
      expect(second.map((t) => t.x)).toEqual(first.map((t) => t.x))
    })

    it('runs the profile as a thin line along the top edge of the bottom bar, full width, with no area under it', () => {
      const { points, fills, calls } = render(cinema({ counters: off(DEFAULT_OVERLAY.counters) }), 0.5)
      const ridge = points.filter((pt) => pt.op !== 'arc')
      const barTop = SIZE.height - BAR
      expect(Math.min(...ridge.map((pt) => pt.x))).toBeCloseTo(0, 6)
      expect(Math.max(...ridge.map((pt) => pt.x))).toBeCloseTo(SIZE.width, 6)
      for (const pt of ridge) {
        expect(pt.y).toBeLessThanOrEqual(barTop)
        expect(pt.y).toBeGreaterThan(barTop - 0.05 * SIZE.height - U)
      }
      // only the position dot is filled
      expect(fills).toHaveLength(1)
      expect(calls).toContain('arc(5)')
    })

    it('puts the weather in the top bar at the left and the map in the top bar at the right', () => {
      const both = cinema({
        counters: off(DEFAULT_OVERLAY.counters),
        profile: off(DEFAULT_OVERLAY.profile),
        weather: { ...DEFAULT_OVERLAY.weather, enabled: true, anchor: 'top-left' },
        minimap: { ...DEFAULT_OVERLAY.minimap, enabled: true, anchor: 'top-right' },
      })
      const { texts, points } = render(both, 0.5, {}, withWeather)
      const weather = texts.find((t) => t.text.toLowerCase().includes('plutôt dégagé'))!
      expect(weather.text).toMatch(/14 °C/)
      expect(inTopBar(weather)).toBe(true)
      expect(weather.x).toBeCloseTo(SAFE_LEFT, 6)
      // the map: what is drawn in the upper half (the weather credit has its box at the foot of the frame)
      const map = points.filter((pt) => (pt.op === 'moveTo' || pt.op === 'lineTo') && pt.y < SIZE.height / 2)
      expect(map.length).toBeGreaterThan(10)
      for (const pt of map) {
        expect(pt.y).toBeGreaterThanOrEqual(0)
        expect(pt.y).toBeLessThanOrEqual(BAR)
        expect(pt.x).toBeGreaterThan(SIZE.width * 0.8)
      }
    })

    it('leaves the opening card centred, in widely spaced light capitals, and the other widgets out of the bars', () => {
      const opening = render(cinema(), 0.02).texts
      const title = opening.find((t) => t.text === t.text.toLocaleUpperCase('fr') && /[A-Z]{4}/.test(t.text))!
      expect(title.font).toMatch(/^300 .*Fraunces/)
      expect(title.x).toBeCloseTo(SIZE.width / 2, 0)
      expect(title.y).toBeGreaterThan(BAR)
      expect(title.y).toBeLessThan(SIZE.height - BAR)
      const texts: FilmText[] = [
        { ...FILM_TEXT, startS: 0.4, durationS: 0.4, anchor: 'bottom-left' },
        { ...FILM_TEXT, id: 'text-2', startS: 0.4, durationS: 0.4, anchor: 'top-left', text: 'Départ' },
      ]
      const drawn = render(cinema(), 0.6, { texts }).texts
      expect(drawn.find((t) => t.text === 'Col de Balme')!.y).toBeLessThan(SIZE.height - BAR)
      expect(drawn.find((t) => t.text === 'Départ')!.y).toBeGreaterThan(BAR)
    })

    it('draws a counter moved out of its slot as an ordinary widget again', () => {
      const moved = cinema({ counters: { ...DEFAULT_OVERLAY.counters, anchor: 'top-left' } })
      const { texts } = render(moved, 0.5)
      expect(texts.map((t) => t.text.toLowerCase())).toContain('distance')
      expect(texts.filter(inBottomBar).filter((t) => t.text !== '·')).toEqual([])
    })
  })

  describe('Journal de bord', () => {
    const SHEET = 0.24 * SIZE.width
    const PAD = 2.6 * U
    const journal = (patch: Partial<OverlaySettings> = {}) =>
      styled('journal', { minimap: { ...withStyleLayout(DEFAULT_OVERLAY, 'journal').minimap, enabled: true }, ...patch })

    it('glues a full-height cream sheet to the left edge, about a quarter of the width, under everything else', () => {
      const { rects, order } = render(journal(), 0.5)
      expect(rects[0]).toMatchObject({ x: 0, y: 0, h: SIZE.height, fill: 'rgba(244, 237, 218, 0.97)', alpha: 1 })
      expect(rects[0].w).toBeCloseTo(SHEET, 6)
      expect(order[0]).toMatch(/^rect /)
      // the sheet is drawn even when nothing else is on
      const bare = journal({ counters: off(DEFAULT_OVERLAY.counters), profile: off(DEFAULT_OVERLAY.profile), minimap: off(DEFAULT_OVERLAY.minimap) })
      expect(render(bare, 0.5).rects[0].w).toBeCloseTo(SHEET, 6)
      expect(render({ ...journal(), enabled: false }, 0.5).rects).toEqual([])
    })

    it('stacks the title in italic serif, the counters as rows with dotted leaders, the map, then the profile with its altitude ticks', () => {
      const { texts, calls } = render(journal(), 0.5)
      const header = texts.find((t) => t.font.startsWith('italic'))!
      expect(header.font).toMatch(/Fraunces/)
      expect(header.x).toBeCloseTo(PAD, 6)
      const rows = ['Distance', 'Altitude', 'D+', 'Temps'].map((label) => texts.find((t) => t.text === label)!)
      // labels on one left edge, one row under the other, values on the right edge of the sheet
      for (const row of rows) expect(row.x).toBeCloseTo(PAD, 6)
      for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeGreaterThan(rows[i - 1].y)
      const values = rows.map((row) => texts.find((t) => t.y === row.y && t.x > row.x)!)
      expect(values[0].text).toMatch(/^\d+,\d km$/)
      for (const value of values) expect(value.x).toBeCloseTo(SHEET - PAD, 6)
      // one dotted leader per row, plus the one of the profile
      expect(calls.filter((c) => c === 'setLineDash(1)').length).toBeGreaterThanOrEqual(rows.length)
      const north = texts.find((t) => t.text === 'N')!
      const ticks = texts.filter((t) => /^[\d ]+ m$/.test(t.text) && t.y > north.y)
      expect(ticks).toHaveLength(2)
      expect(header.y).toBeLessThan(rows[0].y)
      expect(rows[rows.length - 1].y).toBeLessThan(north.y)
      expect(north.y).toBeLessThan(ticks[0].y)
      // highest altitude above the lowest, both on the left axis of the chart
      expect(ticks[0].y).toBeLessThan(ticks[1].y)
      expect(Number(ticks[0].text.replace(/\D/g, ''))).toBe(Math.round(track.profile!.maxEle))
      expect(Number(ticks[1].text.replace(/\D/g, ''))).toBe(Math.round(track.profile!.minEle))
    })

    it('puts nothing in the right half of the frame', () => {
      const settings = journal({ weather: { ...DEFAULT_OVERLAY.weather, enabled: true, anchor: 'middle-left' }, credits: { ...DEFAULT_OVERLAY.credits, enabled: false } })
      const { texts: all, points } = render(settings, 0.5, {}, withWeather)
      // the credit of the weather is required, and drawn on its own at the bottom right
      const texts = all.filter((t) => t.text !== openMeteoAttribution())
      expect(texts.length).toBeGreaterThan(10)
      for (const t of texts) expect(t.x).toBeLessThanOrEqual(SHEET)
      for (const pt of points) expect(pt.x).toBeLessThanOrEqual(SHEET)
      expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Météo', 'Température', 'Vent']))
    })

    it('replaces the content of the sheet with the totals in the same list form for the closing card', () => {
      const { texts } = render(journal(), 0.99)
      for (const label of ['Distance', 'Dénivelé +', 'Altitude max', 'Durée', 'Vitesse max']) {
        expect(texts.find((t) => t.text === label)?.x).toBeCloseTo(PAD, 6)
      }
      // the live rows are gone, the title stays (as the closing card's name)
      expect(texts.map((t) => t.text)).not.toContain('Temps')
      expect(texts.some((t) => t.font.startsWith('italic'))).toBe(true)
      for (const t of texts) expect(t.x).toBeLessThanOrEqual(SHEET)
    })

    it('keeps the free widgets and the credits out of the sheet', () => {
      const texts: FilmText[] = [{ ...FILM_TEXT, startS: 0.4, durationS: 0.4, anchor: 'top-left' }]
      const drawn = render(journal(), 0.6, { texts, credits: ['Relief : © Mapterhorn'] }).texts
      expect(drawn.find((t) => t.text === 'Col de Balme')!.x).toBeGreaterThan(SHEET)
      const credit = drawn.find((t) => t.text.startsWith('Relief'))!
      expect(credit.x).toBeGreaterThan(SHEET)
      expect(credit.x).toBeLessThanOrEqual(SIZE.width)
    })

    it('draws a widget out of the left column as an ordinary widget', () => {
      const moved = journal({ counters: { ...DEFAULT_OVERLAY.counters, anchor: 'top-right' } })
      const { texts } = render(moved, 0.5)
      expect(texts.find((t) => t.text.toLowerCase() === 'distance')!.x).toBeGreaterThan(SIZE.width / 2)
    })
  })

  describe('Tableau sportif', () => {
    const BAND_Y = 0.8 * SIZE.height
    const tableau = (patch: Partial<OverlaySettings> = {}) =>
      styled('tableau', { minimap: { ...withStyleLayout(DEFAULT_OVERLAY, 'tableau').minimap, enabled: true }, ...patch })
    const inBand = (t: TextCall) => t.y > BAND_Y

    it('draws a translucent dark band across the bottom fifth of the frame, under an accent line', () => {
      const { rects } = render(tableau(), 0.5)
      expect(rects[0]).toMatchObject({ x: 0, y: BAND_Y, w: SIZE.width, h: 0.2 * SIZE.height, fill: 'rgba(12, 18, 23, 0.84)' })
      expect(rects[1]).toMatchObject({ x: 0, y: BAND_Y, w: SIZE.width, fill: '#E8501A' })
      expect(render({ ...tableau(), enabled: false }, 0.5).rects).toEqual([])
    })

    it('spreads the counters as big numbers evenly across the band, the unit in the accent and a small capital label under each', () => {
      const { texts } = render(tableau(), 0.5)
      const labels = ['DISTANCE', 'ALTITUDE', 'D+', 'TEMPS'].map((label) => texts.find((t) => t.text === label)!)
      for (const label of labels) expect(inBand(label)).toBe(true)
      for (const label of labels) expect(label.y).toBeCloseTo(labels[0].y, 6)
      // cells of the same width over the safe width, labels centred in them
      const cell = (SIZE.width - 2 * SAFE_LEFT) / labels.length
      labels.forEach((label, i) => expect(label.x).toBeCloseTo(SAFE_LEFT + (i + 0.5) * cell, 6))
      // the number above its label, in bold condensed figures, much bigger than the label
      const number = texts.find((t) => /^\d+,\d$/.test(t.text) && inBand(t))!
      expect(number.font).toMatch(/^700 .*Condensed/)
      expect(number.y).toBeLessThan(labels[0].y)
      expect(px(number)).toBeGreaterThan(3 * px(labels[0]))
      expect(number.color).toBe('#FFFFFF')
      const unit = texts.find((t) => t.text === 'km')!
      expect(unit.color).toBe('#E8501A')
      expect(unit.y).toBeCloseTo(number.y, 6)
      expect(px(unit)).toBeLessThan(px(number))
      // none in the corners of the frame: all between the first and the last cell
      for (const t of texts.filter(inBand)) {
        expect(t.x).toBeGreaterThan(SAFE_LEFT)
        expect(t.x).toBeLessThan(SIZE.width - SAFE_LEFT)
      }
    })

    it('fills the band with the profile as a faded area, over its whole width', () => {
      const { points, fills } = render(tableau({ counters: off(DEFAULT_OVERLAY.counters), minimap: off(DEFAULT_OVERLAY.minimap) }), 0.5)
      expect(fills).toContain('rgba(255, 255, 255, 0.14)')
      const area = points.filter((pt) => pt.op !== 'arc')
      expect(Math.min(...area.map((pt) => pt.x))).toBeCloseTo(0, 6)
      expect(Math.max(...area.map((pt) => pt.x))).toBeCloseTo(SIZE.width, 6)
      for (const pt of area) {
        expect(pt.y).toBeGreaterThanOrEqual(BAND_Y)
        expect(pt.y).toBeLessThanOrEqual(SIZE.height)
      }
    })

    it('puts the title on an accent stripe at the top left, and the map in a circle at the top right', () => {
      const opening = render(tableau(), 0.02)
      const stripe = opening.rects.find((r) => r.fill === '#E8501A' && r.y < BAND_Y)!
      expect(stripe.x).toBe(0)
      expect(stripe.y).toBeCloseTo(SIZE.height * SAFE_MARGIN, 6)
      const title = opening.texts.find((t) => t.color === '#FFFFFF' && /[A-Z]{4}/.test(t.text))!
      expect(title.x).toBeGreaterThan(0)
      expect(title.x).toBeLessThan(stripe.w)
      expect(title.y).toBeGreaterThan(stripe.y)
      expect(title.y).toBeLessThan(stripe.y + stripe.h)
      const { points } = render(tableau(), 0.5)
      const [ring] = points.filter((pt) => pt.op === 'arc' && (pt.r ?? 0) > 5 * U)
      expect(ring.r).toBeCloseTo(10 * U, 6)
      expect(ring.x).toBeCloseTo(SIZE.width - SAFE_LEFT - 10 * U, 6)
      expect(ring.y).toBeCloseTo(SIZE.height * SAFE_MARGIN + 10 * U, 6)
      for (const pt of points.filter((p) => p.op !== 'arc' && p.x > SIZE.width / 2 && p.y < BAND_Y)) {
        expect(Math.hypot(pt.x - ring.x, pt.y - ring.y)).toBeLessThanOrEqual(ring.r! + 1e-6)
      }
    })

    it('keeps the free widgets above the band, and draws a counter out of its slot as an ordinary widget', () => {
      const texts: FilmText[] = [{ ...FILM_TEXT, startS: 0.4, durationS: 0.4, anchor: 'bottom-left' }]
      expect(render(tableau(), 0.6, { texts }).texts.find((t) => t.text === 'Col de Balme')!.y).toBeLessThan(BAND_Y)
      const { texts: moved } = render(tableau({ counters: { ...DEFAULT_OVERLAY.counters, anchor: 'top-center' } }), 0.5)
      expect(moved.filter(inBand).filter((t) => t.text.toLowerCase() === 'distance')).toEqual([])
      expect(moved.map((t) => t.text.toLowerCase())).toContain('distance')
    })
  })

  it.each(['cinema', 'journal', 'tableau'] as const)('%s: every point and text of a frame stays inside it, at every moment of the film', (style) => {
    const layout = withStyleLayout(DEFAULT_OVERLAY, style)
    const settings = styled(style, { minimap: { ...layout.minimap, enabled: true }, weather: { ...layout.weather, enabled: true } })
    for (const progress of [0, 0.02, 0.09, 0.5, 0.92, 1]) {
      const { texts, points } = render(settings, progress, {}, withWeather)
      for (const pt of [...texts, ...points]) expect(inFrame(pt)).toBe(true)
    }
  })
})
