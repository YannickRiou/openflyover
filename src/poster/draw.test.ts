// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { buildTrackPath } from '../flyover/path'
import { parseGpx } from '../import/gpx'
import { miniMapOutline } from '../overlay/data'
import { OVERLAY_FONTS } from '../overlay/themes'
import { posterContent } from './content'
import { POSTER_FONTS, coverCrop, drawPoster } from './draw'
import type { PosterContext } from './draw'
import { posterRows } from './export'
import { posterLayout } from './layout'
import { DEFAULT_POSTER, POSTER_FORMATS, POSTER_STYLES } from './settings'

/** 2D context stand-in: records texts (with their measured width) and drawn images; a glyph is half the font size wide. */
function fakeContext() {
  const texts: { text: string; x: number; y: number; width: number; align: string }[] = []
  const images: number[][] = []
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = []
  let lines = 0
  const dashes: number[][] = []
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'left' }
  const fontPx = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * fontPx() * 0.5 }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, width: text.length * fontPx() * 0.5, align: String(state.textAlign) }),
    drawImage: (_image: unknown, ...args: number[]) => images.push(args),
    lineTo: () => lines++,
    fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h, fill: String(state.fillStyle) }),
    setLineDash: (dash: number[]) => dashes.push(dash),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : key in state ? state[key] : () => undefined),
    set: (_t, key: string, value) => {
      state[key] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as PosterContext, texts, images, rects, dashes, lines: () => lines }
}

/** Left edge of a text drawn with its alignment. */
const leftOf = (t: { x: number; width: number; align: string }) => (t.align === 'right' ? t.x - t.width : t.align === 'center' ? t.x - t.width / 2 : t.x)

const track = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
const credits = ['Relief : Mapterhorn', 'Imagerie : Esri, Maxar, Earthstar Geographics', '© contributeurs OpenStreetMap (ODbL)']
const content = posterContent({ tracks: [track], race: false, poster: { ...DEFAULT_POSTER, subtitle: 'Étape 1' }, projectName: 'Tour du Mont-Blanc', climbs: [4], credits })
/** six outings with long names: the most the list holds */
const outings = Array.from({ length: 6 }, (_, i) => ({ ...track, id: `t${i}`, name: `Sortie numéro ${i + 1} par le très long chemin des crêtes`, color: '#C23B22' }))
const several = posterContent({ tracks: outings, race: false, poster: DEFAULT_POSTER, projectName: 'Été', climbs: outings.map(() => 4), credits })

describe('poster drawing', () => {
  it('draws only embedded faces, all loaded with the overlay ones', () => {
    for (const font of POSTER_FONTS) expect(OVERLAY_FONTS).toContain(font)
  })

  it('crops a view to cover its box, centred', () => {
    expect(coverCrop(200, 100, 100, 100)).toEqual({ x: 50, y: 0, w: 100, h: 100 })
    expect(coverCrop(100, 100, 200, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it.each(POSTER_FORMATS.flatMap((f) => POSTER_STYLES.map((style) => ({ f, style }))))(
    '$f.id $style: title, figures and credits drawn inside the page, the view in its box',
    ({ f, style }) => {
      const layout = posterLayout(f.width, f.height, style, posterRows(content))
      const { ctx, texts, images } = fakeContext()
      drawPoster(ctx, layout, content, style, { image: {} as CanvasImageSource, width: layout.view.w, height: layout.view.h })
      // some styles draw capitals, the logbook sets the title on two lines
      const drawn = texts.map((t) => t.text.toLocaleLowerCase('fr'))
      if (style === 'journal') expect(drawn.join(' ')).toContain('tour du mont-blanc')
      else expect(drawn).toContain('tour du mont-blanc')
      expect(drawn.some((t) => t.startsWith('étape 1 · '))).toBe(true)
      for (const figure of content.figures) expect(drawn).toContain(figure.label.toLocaleLowerCase('fr'))
      expect(drawn.join(' ')).toContain('relief : mapterhorn')
      for (const t of texts) {
        const left = leftOf(t)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + t.width).toBeLessThanOrEqual(f.width + 1e-6)
      }
      expect(images).toEqual([[0, 0, layout.view.w, layout.view.h, layout.view.x, layout.view.y, layout.view.w, layout.view.h]])
    },
  )

  it.each(POSTER_FORMATS.flatMap((f) => POSTER_STYLES.map((style) => ({ f, style }))))(
    '$f.id $style: every listed track drawn in its row, its name cut before its figures',
    ({ f, style }) => {
      const layout = posterLayout(f.width, f.height, style, posterRows(several))
      const { ctx, texts } = fakeContext()
      drawPoster(ctx, layout, several, style, null)
      expect(layout.tracks).toHaveLength(6)
      layout.tracks.forEach((row, i) => {
        const inRow = texts.filter((t) => {
          const left = leftOf(t)
          return t.y >= row.y && t.y <= row.y + row.h && left >= row.x - 1e-6 && left + t.width <= row.x + row.w + 1e-6
        })
        expect(inRow.map((t) => t.text)).toEqual(
          expect.arrayContaining([expect.stringMatching(new RegExp(`^Sortie numéro ${i + 1}`)), several.tracks[i].distance, several.tracks[i].date]),
        )
      })
    },
  )

  it('shows the plan of the track until a view is rendered', () => {
    const layout = posterLayout(2480, 3508, 'editorial', posterRows(content))
    const outline = miniMapOutline(buildTrackPath(track))
    const { ctx, images, lines } = fakeContext()
    drawPoster(ctx, layout, content, 'editorial', null, outline)
    expect(images).toHaveLength(0)
    expect(lines()).toBeGreaterThan(outline?.x.length ?? 0)
  })
})

describe('poster arrangements', () => {
  const A4 = { width: 2480, height: 3508 }
  const draw = (style: 'cinema' | 'journal' | 'tableau', c = content, size = A4) => {
    const layout = posterLayout(size.width, size.height, style, posterRows(c))
    const result = fakeContext()
    drawPoster(result.ctx, layout, c, style, { image: {} as CanvasImageSource, width: layout.view.w, height: layout.view.h })
    return { layout, ...result }
  }
  // some styles draw capitals
  const at = (texts: ReturnType<typeof fakeContext>['texts'], text: string) => texts.find((t) => t.text.toLocaleLowerCase('fr') === text.toLocaleLowerCase('fr'))!

  it('keeps the plan of a single track in the content, none for several tracks', () => {
    expect(content.outline?.x.length).toBeGreaterThan(10)
    expect(several.outline).toBeUndefined()
    expect(posterRows(content).map).toBe(true)
    expect(posterRows(several).map).toBe(false)
  })

  it('Cinéma: black bands over and under the view, the title in capitals centred in the lower one, the figures on one line', () => {
    const { layout, rects, texts } = draw('cinema')
    // the thin band over the view (the lower one is the panel, filled as a path)
    const bands = rects.filter((r) => r.fill === '#000000' && r.w === A4.width && r.h < A4.height)
    expect(bands).toEqual([{ x: 0, y: 0, w: A4.width, h: Math.round(4 * layout.u), fill: '#000000' }])
    expect(layout.panel!.y).toBe(layout.view.y + layout.view.h)
    const title = at(texts, 'Tour du Mont-Blanc')
    expect(title.align).toBe('center')
    expect(title.x).toBeCloseTo(A4.width / 2, 6)
    expect(title.y).toBeGreaterThan(layout.panel!.y)
    // each figure: its label then its value on one baseline, left to right
    const labels = content.figures.map((f) => at(texts, f.label))
    for (const label of labels) expect(label.y).toBeCloseTo(labels[0].y, 6)
    expect(labels.map((l) => l.x)).toEqual([...labels.map((l) => l.x)].sort((a, b) => a - b))
    for (const f of content.figures) expect(at(texts, f.value).y).toBeCloseTo(labels[0].y, 6)
    expect(title.y).toBeLessThan(labels[0].y)
  })

  it('Journal de bord: a paper column with the title on two lines, the figures as a list with dotted leaders, the map and the profile', () => {
    const { layout, rects, texts, dashes, lines } = draw('journal')
    const column = layout.panel!
    expect(rects.some((r) => r.fill === '#F4EDDA' && r.x === 0 && r.w === A4.width && r.h === A4.height)).toBe(true)
    // title: two lines in the column
    const [first, second] = [at(texts, 'Tour du'), at(texts, 'Mont-Blanc')]
    expect(first.x).toBeCloseTo(column.x + 3 * layout.u, 6)
    expect(second.y).toBeGreaterThan(first.y)
    // figures: labels on one left edge, values on the right edge of the column, one dotted leader each
    const labels = content.figures.map((f) => at(texts, f.label))
    for (const label of labels) expect(label.x).toBeCloseTo(layout.figures[0].x, 6)
    labels.slice(1).forEach((label, i) => expect(label.y).toBeGreaterThan(labels[i].y))
    const values = content.figures.map((f, i) => texts.find((t) => t.y === labels[i].y && t.align === 'right' && t.text.startsWith(f.value))!)
    for (const value of values) expect(value.x).toBeCloseTo(layout.figures[0].x + layout.figures[0].w, 6)
    expect(dashes.length).toBeGreaterThanOrEqual(content.figures.length)
    // the map: its frame in the room of the layout, then the plan of the track
    expect(layout.map).not.toBeNull()
    expect(lines()).toBeGreaterThan(content.outline!.x.length)
    expect(texts.some((t) => t.text === 'N')).toBe(true)
  })

  it('Journal de bord: no map frame without a map room', () => {
    const { layout, texts } = draw('journal', several)
    expect(layout.map).toBeNull()
    expect(texts.some((t) => t.text === 'N')).toBe(false)
  })

  it('Tableau sportif: a dark band with an accent line, the title on an accent stripe, big figures centred in even cells, the unit in the accent', () => {
    const { layout, rects, texts } = draw('tableau')
    const band = layout.panel!
    expect(rects.filter((r) => r.fill === '#E8501A').map((r) => r.y)).toEqual(expect.arrayContaining([layout.title.y, band.y]))
    const stripe = rects.find((r) => r.fill === '#E8501A' && r.y === layout.title.y)!
    expect(stripe.x).toBe(0)
    expect(stripe.h).toBe(layout.title.h)
    // labels centred in the cells of the figures
    layout.figures.forEach((cell, i) => {
      const label = at(texts, content.figures[i].label)
      expect(label.align).toBe('center')
      expect(label.x).toBeCloseTo(cell.x + cell.w / 2, 6)
    })
    const value = at(texts, content.figures[0].value)
    expect(value.y).toBeLessThan(at(texts, content.figures[0].label).y)
    // the band carries the profile as a filled area behind them, over the figures' row
    expect(layout.profile!.y).toBe(layout.figures[0].y)
  })

  it.each(['cinema', 'journal', 'tableau'] as const)('%s: a poster of several tracks lists them and keeps every text inside the page', (style) => {
    const { texts } = draw(style, several)
    expect(texts.length).toBeGreaterThan(20)
    for (const t of texts) {
      expect(leftOf(t)).toBeGreaterThanOrEqual(0)
      expect(leftOf(t) + t.width).toBeLessThanOrEqual(A4.width + 1e-6)
    }
  })
})
