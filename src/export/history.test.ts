import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import {
  HISTORY_LIMIT,
  HISTORY_VERSION,
  entryOf,
  formatSpeed,
  formatWall,
  estimateRenderSeconds,
  lastFilm,
  layersCost,
  layersRatio,
  parseHistory,
  rateFromHistory,
  recordEntry,
  reuseSettings,
  secondsPerMegapixel,
  serialiseHistory,
  settingsDetails,
  settingsSummary,
  shadowSummary,
  summariseSettings,
  timingsSummary,
  entryDetails,
  trim,
  type HistoryEntry,
  type RenderRecord,
} from './history'
import { EMPTY_TIMINGS } from './store'

const RECORD: RenderRecord = {
  request: { width: 1920, height: 1080, fps: 30, quality: 'high', baseName: 'Tour du Mont-Blanc' },
  outcome: 'done',
  wallMs: 92_400,
  frames: 450,
  encoded: 450,
  timings: { ...EMPTY_TIMINGS, rendered: 300, renderMs: 50_000, waitMs: 30_000, encodeMs: 10_000, timeouts: 2 },
  result: { codec: 'mp4/avc', sizeBytes: 12_345_678 },
  encoder: 'webcodecs',
  settings: DEFAULT_SETTINGS,
  at: 1_800_000_000_000,
}

const entry = (at: number, patch: Partial<HistoryEntry> = {}): HistoryEntry => ({ ...entryOf({ ...RECORD, at }), ...patch })

describe('summariseSettings', () => {
  it('keeps only the settings that change the render time', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      shadows: true,
      lens: { ...DEFAULT_SETTINGS.lens, shutter: 0.5, depthOfField: 0.3 },
      clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'mer', quality: 'high' },
      camera: { ...DEFAULT_SETTINGS.camera, style: 'orbit' },
    }
    const summary = summariseSettings(settings)
    expect(summary).toMatchObject({ shadows: true, camera: 'orbit', imagery: settings.imagerySourceId, terrain: settings.terrainSourceId })
    expect(summary.clouds).toEqual({ mode: 'mer', quality: 'high', coverage: settings.clouds.coverage, seaRender: settings.clouds.seaRender })
    expect(summary.lens).toEqual(settings.lens)
    // no film, track, overlay, title or poster text
    expect(Object.keys(summary).sort()).toEqual(
      ['atmosphere', 'camera', 'clouds', 'imagery', 'imageryZoom', 'lens', 'shadows', 'sunDate', 'sunFromTrack', 'sunHour', 'snow', 'forest', 'terrain', 'tier', 'water'].sort(),
    )
  })
})

describe('effective render values', () => {
  const withClouds = (quality: Settings['clouds']['quality']): Settings => ({ ...DEFAULT_SETTINGS, clouds: { ...DEFAULT_SETTINGS.clouds, quality } })
  const rendered = (quality: 'standard' | 'high' | 'max', settings: Settings) =>
    entryOf({ ...RECORD, request: { ...RECORD.request, quality }, settings })

  it('records what the export quality made the export use, not the project value', () => {
    const [low, mid, high] = (['standard', 'high', 'max'] as const).map((q) => rendered(q, withClouds('auto')).settings)
    expect([low.clouds?.quality, mid.clouds?.quality, high.clouds?.quality]).toEqual(['low', 'medium', 'high'])
    expect([low.tier, mid.tier, high.tier]).toEqual([
      { subFrames: 4, cloudsByHand: false },
      { subFrames: 8, cloudsByHand: false },
      { subFrames: 8, cloudsByHand: false },
    ])
  })

  it('records a quality chosen by hand over the export quality', () => {
    const { settings } = rendered('standard', withClouds('high'))
    expect(settings.clouds?.quality).toBe('high')
    expect(settings.tier).toEqual({ subFrames: 4, cloudsByHand: true })
  })

  it('reads back the tier, and drops a malformed one instead of the entry', () => {
    const e = rendered('standard', withClouds('auto'))
    expect(parseHistory(serialiseHistory([e]))[0].settings.tier).toEqual({ subFrames: 4, cloudsByHand: false })
    for (const tier of [{ subFrames: 99, cloudsByHand: false }, { subFrames: 2.5, cloudsByHand: true }, { subFrames: 4 }, 'x']) {
      const raw = JSON.stringify({ v: 1, entries: [{ ...e, settings: { ...e.settings, tier } }] })
      const [parsed] = parseHistory(raw)
      expect(parsed.settings.tier).toBeUndefined()
      expect(parsed.settings.clouds).toBeDefined()
    }
  })

  it('still reads an entry recorded before the tiers (same version, no tier field)', () => {
    const { tier: _tier, ...old } = entry(1).settings
    const raw = JSON.stringify({ v: 1, entries: [{ ...entry(1), settings: { ...old, clouds: { mode: 'meteo', quality: 'high', coverage: 0.4, seaRender: 'volume' } } }] })
    const [parsed] = parseHistory(raw)
    expect(parsed.settings.tier).toBeUndefined()
    expect(parsed.settings.clouds?.quality).toBe('high')
    // an old entry recorded a fixed quality: reusing it pins that quality; a new one follows the export quality again
    expect(reuseSettings(parsed, DEFAULT_SETTINGS).clouds.quality).toBe('high')
    expect(reuseSettings(rendered('standard', withClouds('auto')), DEFAULT_SETTINGS).clouds.quality).toBe('auto')
    expect(reuseSettings(rendered('standard', withClouds('high')), DEFAULT_SETTINGS).clouds.quality).toBe('high')
  })

  it('shows the cap and the choice in the details', () => {
    const rows = settingsDetails(rendered('standard', { ...withClouds('high'), lens: { ...DEFAULT_SETTINGS.lens, shutter: 0.5 } }).settings)
    expect(rows.find((r) => r.label === 'Nuages')?.value).toContain('fine (choisie)')
    expect(rows.find((r) => r.label === 'Flou de bougé')?.value).toBe('50 %, 4 rendus par image au plus')
  })
})

describe('entryOf', () => {
  it('records the output, the real time and the frames of a finished render', () => {
    const e = entryOf(RECORD)
    expect(e).toMatchObject({
      name: 'Tour du Mont-Blanc',
      outcome: 'done',
      wallMs: 92_400,
      frames: 450,
      rendered: 300,
      timeouts: 2,
      filmS: 15,
      width: 1920,
      height: 1080,
      fps: 30,
      quality: 'high',
      aspect: '16:9',
      resolution: '1080p',
      codec: 'mp4/avc',
      bytes: 12_345_678,
      encoder: 'webcodecs',
    })
  })

  it('has no file for a render that did not finish, keeps a short error', () => {
    const e = entryOf({ ...RECORD, outcome: 'error', error: 'x'.repeat(500), result: null, encoded: 120 })
    expect(e.codec).toBeUndefined()
    expect(e.bytes).toBeUndefined()
    expect(e.encoded).toBe(120)
    expect(e.error?.length).toBeLessThanOrEqual(120)
  })

  it('leaves the aspect out for a size the app does not make', () => {
    const e = entryOf({ ...RECORD, request: { ...RECORD.request, width: 1234, height: 567 } })
    expect(e.aspect).toBeUndefined()
    expect(e.resolution).toBeUndefined()
  })

  it('gives each entry its own id', () => {
    expect(entryOf(RECORD).id).not.toBe(entryOf(RECORD).id)
  })
})

describe('trim and recordEntry', () => {
  it('keeps the newest entries first, at most the limit', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) list = recordEntry(list, entry(i))
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list[0].at).toBe(HISTORY_LIMIT + 4)
    expect(list.at(-1)?.at).toBe(5)
  })

  it('drops the oldest entries to stay under the byte cap, never the last one', () => {
    const list = [entry(3), entry(2), entry(1)]
    expect(trim(list, 20, 100)).toHaveLength(1)
    expect(trim(list, 20, 100)[0].at).toBe(3)
    const one = new TextEncoder().encode(serialiseHistory([entry(1)])).length
    expect(trim(list, 20, one * 2)).toHaveLength(1 + 1)
  })

  it('does not record the same entry twice', () => {
    const e = entry(1)
    expect(recordEntry([e], e)).toHaveLength(1)
  })
})

describe('parseHistory', () => {
  it('reads back what serialiseHistory wrote', () => {
    const list = [entry(2), entry(1)]
    expect(parseHistory(serialiseHistory(list))).toEqual(list)
  })

  it('never throws and gives nothing for unreadable data', () => {
    for (const raw of [null, undefined, '', 'not json', '42', 'null', '[]', '{}', '{"v":1}', '{"v":1,"entries":3}', '{"v":99,"entries":[]}']) {
      expect(parseHistory(raw)).toEqual([])
    }
  })

  it('leaves out the corrupted entries and keeps the others, newest first', () => {
    const good = entry(5)
    const raw = JSON.stringify({
      v: HISTORY_VERSION,
      entries: [entry(1), null, 'x', { ...good, outcome: 'weird' }, { ...good, id: 'b', width: -1 }, { ...good, id: 'c', fps: 'fast' }, { ...good, id: 'd', quality: 'ultra' }, good],
    })
    expect(parseHistory(raw).map((e) => e.at)).toEqual([5, 1])
  })

  it('drops invalid settings fields instead of the entry', () => {
    const e = entry(1)
    const raw = JSON.stringify({
      v: 1,
      entries: [{ ...e, settings: { ...e.settings, camera: 'flying', lens: { shutter: 9 }, clouds: { mode: 'x' }, sunHour: 99, shadows: true } }],
    })
    const [parsed] = parseHistory(raw)
    expect(parsed.settings.camera).toBeUndefined()
    expect(parsed.settings.lens).toBeUndefined()
    expect(parsed.settings.clouds).toBeUndefined()
    expect(parsed.settings.sunHour).toBeUndefined()
    expect(parsed.settings.shadows).toBe(true)
  })

  it('reads the snow and the forests, and shows « — » for an entry recorded before them', () => {
    const e = entry(1)
    const fresh = { ...e, settings: { ...e.settings, snow: 'manuelle', forest: { enabled: true, density: 90 } } }
    const before = { ...e.settings, snow: undefined, forest: undefined }
    const old = { ...entry(2), settings: before }
    const [parsedFresh, parsedOld] = parseHistory(JSON.stringify({ v: 1, entries: [fresh, old] })).sort((a, b) => a.at - b.at)
    expect(parsedFresh.settings).toMatchObject({ snow: 'manuelle', forest: { enabled: true, density: 90 } })
    expect(parsedOld.settings.snow).toBeUndefined()
    expect(parsedOld.settings.forest).toBeUndefined()
    const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value
    const rows = settingsDetails(parsedFresh.settings)
    expect(value(rows, 'Neige')).toBe('Manuelle')
    expect(value(rows, 'Forêts')).toBe('90 arbres par hectare')
    expect(value(settingsDetails(parsedOld.settings), 'Neige')).toBe('—')
    expect(value(settingsDetails(parsedOld.settings), 'Forêts')).toBe('—')
    expect(value(settingsDetails({ forest: { enabled: false, density: 60 } }), 'Forêts')).toBe('non')
    // a bad value drops the field, not the entry
    const bad = { ...e, settings: { ...e.settings, snow: 'blizzard', forest: { enabled: true, density: 9999 } } }
    const [parsedBad] = parseHistory(JSON.stringify({ v: 1, entries: [bad] }))
    expect(parsedBad.settings.snow).toBeUndefined()
    expect(parsedBad.settings.forest).toBeUndefined()
  })

  it('caps a list written with more entries than the limit, and ignores duplicate ids', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(i))
    expect(parseHistory(JSON.stringify({ v: 1, entries: many }))).toHaveLength(HISTORY_LIMIT)
    const e = entry(1)
    expect(parseHistory(JSON.stringify({ v: 1, entries: [e, e] }))).toHaveLength(1)
  })
})

describe('reuseSettings', () => {
  const past = entry(1, {
    width: 1080,
    height: 1920,
    aspect: '9:16',
    resolution: '1080p',
    fps: 60,
    quality: 'max',
    settings: {
      atmosphere: true,
      shadows: false,
      clouds: { mode: 'aucun', quality: 'low', coverage: 0.2, seaRender: 'surface' },
      lens: { shutter: 0.5, bloom: 0, bloomRadius: 0.6, flare: 0, depthOfField: 0.2 },
      camera: 'top',
      water: false,
      imageryZoom: 2,
    },
  })

  it('puts back the export options and the recorded render settings, nothing else', () => {
    const current: Settings = { ...DEFAULT_SETTINGS, exaggeration: 2.5, camera: { ...DEFAULT_SETTINGS.camera, distance: 3 } }
    const next = reuseSettings(past, current)
    // the encoding settings (bitrate by hand, codec…) are not recorded: they stay as they are
    expect(next.video).toEqual({ ...current.video, aspect: '9:16', resolution: '1080p', fps: 60, quality: 'max' })
    expect(next.shadows).toBe(false)
    expect(next.clouds).toEqual({ ...current.clouds, mode: 'aucun', quality: 'low', coverage: 0.2, seaRender: 'surface' })
    expect(next.lens.shutter).toBe(0.5)
    expect(next.camera).toEqual({ ...current.camera, style: 'top' })
    expect(next.water).toEqual({ ...current.water, enabled: false })
    expect(next.imageryZoomOffset).toBe(2)
    // untouched: not part of the summary
    expect(next.exaggeration).toBe(2.5)
    expect(next.camera.distance).toBe(3)
    expect(next.film).toBe(current.film)
    expect(next.overlay).toBe(current.overlay)
    expect(next.poster).toBe(current.poster)
    expect(next.imagerySourceId).toBe(current.imagerySourceId)
  })

  it('puts back the snow and the forests with the rest, and leaves them when the entry lacks them', () => {
    const current: Settings = { ...DEFAULT_SETTINGS, snow: { mode: 'meteo', lineM: 1800 }, forest: { enabled: true, density: 60 } }
    const next = reuseSettings(entry(4, { settings: { snow: 'aucune', forest: { enabled: false, density: 120 } } }), current)
    expect(next.snow).toEqual({ mode: 'aucune', lineM: 1800 })
    expect(next.forest).toEqual({ enabled: false, density: 120 })
    const old = reuseSettings(entry(5, { settings: { shadows: true } }), current)
    expect(old.snow).toBe(current.snow)
    expect(old.forest).toBe(current.forest)
  })

  it('keeps the reference of what is already as recorded', () => {
    const same = entry(2, { settings: summariseSettings(DEFAULT_SETTINGS), ...DEFAULT_SETTINGS.video, aspect: '16:9', resolution: '1080p', width: 1920, height: 1080 })
    const next = reuseSettings(same, DEFAULT_SETTINGS)
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) expect(next[key]).toBe(DEFAULT_SETTINGS[key])
  })

  it('ignores a source the app does not know, and a missing value', () => {
    const next = reuseSettings(entry(3, { settings: { imagery: 'gone', terrain: 'gone' } }), DEFAULT_SETTINGS)
    expect(next.imagerySourceId).toBe(DEFAULT_SETTINGS.imagerySourceId)
    expect(next.terrainSourceId).toBe(DEFAULT_SETTINGS.terrainSourceId)
    expect(next.shadows).toBe(DEFAULT_SETTINGS.shadows)
  })
})

describe('where the time went', () => {
  const split = { ...EMPTY_TIMINGS, rendered: 100, renders: 140, renderMs: 50_000, gpuMs: 21_000, gpuRenders: 140, waitMs: 3_000, composeMs: 6_000, frameMs: 1_500, encodeWaitMs: 2_500, encodeMs: 10_000 }

  it('splits the render (GPU when measured), the tiles, the composing, the video frame and the encoder wait', () => {
    expect(timingsSummary(split)).toBe(
      "rendu 50,0 s (GPU 21,0 s), 1,4 rendu par image, tuiles 3,0 s, composition 6,0 s, image vidéo 1,5 s, attente de l'encodeur 2,5 s",
    )
    // a few queries lost: the average of the measured ones, marked as an estimate
    expect(timingsSummary({ ...split, gpuMs: 15_000, gpuRenders: 100 })).toContain('(GPU ≈ 21,0 s)')
    expect(timingsSummary({ ...split, gpuRenders: 0, gpuMs: 0 })).toMatch(/^rendu 50,0 s, /)
    // an entry recorded before the split: the composing and encoding together
    expect(timingsSummary({ ...EMPTY_TIMINGS, renderMs: 1000, waitMs: 2000, encodeMs: 3000 })).toBe('rendu 1,0 s, tuiles 2,0 s, composition et encodage 3,0 s')
  })

  it('tells the wait for the graphics card apart, only where it was measured', () => {
    expect(timingsSummary({ ...split, gpuWaitMs: 4_000 })).toContain('tuiles 3,0 s, attente de la carte graphique 4,0 s, composition 6,0 s')
    expect(timingsSummary({ ...split, gpuWaitMs: 0 })).not.toContain('carte graphique')
  })

  it('records the wait for the graphics card and the frame handover, and reads them back', () => {
    const e = entryOf({ ...RECORD, timings: { ...split, gpuWaitMs: 4_000, handover: 'canvas' } })
    expect(e).toMatchObject({ gpuWaitMs: 4000, handover: 'canvas' })
    expect(parseHistory(serialiseHistory([e]))[0]).toEqual(e)
    expect(Object.fromEntries(entryDetails(e).map((r) => [r.label, r.value]))['Image vidéo']).toBe('méthode canevas de la page')
    // an entry stored before, or with a method this version does not know: nothing invented
    const { gpuWaitMs: _w, handover: _h, ...older } = e
    expect(parseHistory(serialiseHistory([older as HistoryEntry]))[0]).toMatchObject({ gpuWaitMs: 0 })
    expect(parseHistory(serialiseHistory([older as HistoryEntry]))[0]).not.toHaveProperty('handover')
    expect(parseHistory(serialiseHistory([{ ...e, handover: 'teleport' } as unknown as HistoryEntry]))[0]).not.toHaveProperty('handover')
    expect(entryOf({ ...RECORD, timings: split })).not.toHaveProperty('handover')
  })

  it('sums the shadow pass per render, and says nothing without one', () => {
    const shadows = { ...split, renders: 2, shadowTiles: 200, shadowOffscreenTiles: 60, shadowTriangles: 820_000, shadowOffscreenTriangles: 240_000 }
    expect(shadowSummary(shadows)).toBe('ombres : 100 tuiles (30 hors champ), 410\u00a0k triangles (120\u00a0k hors champ) par rendu')
    expect(shadowSummary(split)).toBe('')
  })

  it('records the split, the tiles given up on and the hardware encoder, and reads them back', () => {
    const e = entryOf({ ...RECORD, timings: { ...split, givenUp: 1 }, result: { ...RECORD.result!, hardware: true } })
    expect(e).toMatchObject({ renders: 140, gpuMs: 21_000, gpuRenders: 140, composeMs: 6000, frameMs: 1500, encodeWaitMs: 2500, givenUp: 1, hardware: true })
    expect(parseHistory(serialiseHistory([e]))[0]).toEqual(e)
    const rows = Object.fromEntries(entryDetails(e).map((r) => [r.label, r.value]))
    expect(rows['Tuiles abandonnées']).toBe('1 image(s)')
    expect(rows['Encodeur']).toBe('WebCodecs (navigateur), encodeur matériel')
    // an entry stored before: zeros, nothing invented
    const { renders: _r, gpuMs: _g, givenUp: _u, ...older } = e
    expect(parseHistory(serialiseHistory([older as HistoryEntry]))[0]).toMatchObject({ renders: 0, gpuMs: 0, givenUp: 0 })
  })
})

describe('formatting', () => {
  it('writes the duration as m:ss', () => {
    expect(formatWall(0)).toBe('0:00')
    expect(formatWall(92_400)).toBe('1:32')
    expect(formatWall(59_600)).toBe('1:00')
    expect(formatWall(3_725_000)).toBe('1:02:05')
  })

  it('gives the speed per rendered image and per megapixel', () => {
    const e = entry(1)
    expect(formatSpeed(e)).toBe('0,3\u00a0s\u00a0/\u00a0image')
    expect(secondsPerMegapixel(e)).toBeCloseTo(92.4 / 300 / 2.0736, 5)
    expect(formatSpeed({ ...e, rendered: 0 })).toBe('')
    expect(secondsPerMegapixel({ ...e, rendered: 0 })).toBeNull()
  })

  it('sums the costly options up in one line', () => {
    expect(settingsSummary({})).toBe('Réglages de base')
    expect(settingsSummary({ atmosphere: false, lens: { shutter: 0, bloom: 0, bloomRadius: 0.6, flare: 1, depthOfField: 0 } })).toBe('Sans atmosphère')
    expect(
      settingsSummary({
        atmosphere: true,
        shadows: true,
        clouds: { mode: 'meteo', quality: 'high', coverage: 0.4, seaRender: 'volume' },
        lens: { shutter: 0.5, bloom: 0.2, bloomRadius: 0.6, flare: 0, depthOfField: 0.3 },
      }),
    ).toBe('Nuages fine · Ombres · Flou de bougé 50 % · Profondeur de champ · Halo')
  })

  it('lists every recorded setting with a French label', () => {
    const rows = settingsDetails(summariseSettings(DEFAULT_SETTINGS))
    expect(rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(['Atmosphère', 'Ombres', 'Nuages', 'Flou de bougé', 'Soleil', 'Fond de carte', 'Relief', 'Caméra']),
    )
    expect(rows.every((r) => r.value !== '' && !r.value.includes('undefined'))).toBe(true)
  })
})

describe('render time before the first film of a session', () => {
  const entry = (patch: Partial<HistoryEntry>): Pick<HistoryEntry, 'at' | 'outcome' | 'overlayOnly' | 'frames' | 'renderMs' | 'waitMs' | 'encodeMs' | 'width' | 'height'> => ({
    at: 100,
    outcome: 'done',
    frames: 300,
    renderMs: 120_000,
    waitMs: 20_000,
    encodeMs: 10_000,
    width: 1920,
    height: 1080,
    ...patch,
  })

  it('the rate of the last film rendered through to the end, per frame and megapixel (as the export measures it)', () => {
    const rate = rateFromHistory([entry({})])
    expect(rate).toBeCloseTo(150 / 300 / 2.0736, 9)
    // the newest one, in any order; not a canceled, failed or overlay-only render
    expect(rateFromHistory([entry({ at: 50, renderMs: 10_000 }), entry({ at: 300 }), entry({ at: 200, renderMs: 900_000 })])).toBeCloseTo(rate!, 9)
    expect(rateFromHistory([entry({ at: 400, outcome: 'canceled' }), entry({ at: 450, outcome: 'error' }), entry({ at: 500, overlayOnly: true }), entry({ at: 10 })])).toBeCloseTo(rate!, 9)
  })

  it('none without a usable render', () => {
    expect(rateFromHistory([])).toBeNull()
    expect(rateFromHistory([entry({ outcome: 'canceled' })])).toBeNull()
    expect(rateFromHistory([entry({ frames: 0 })])).toBeNull()
    expect(rateFromHistory([entry({ renderMs: 0, waitMs: 0, encodeMs: 0 })])).toBeNull()
  })

  it('the time of a film: its frames and megapixels at that rate', () => {
    expect(estimateRenderSeconds(0.25, 1800, 1920, 1080)).toBeCloseTo(0.25 * 1800 * 2.0736, 9)
    expect(estimateRenderSeconds(0.25, 1800, 3840, 2160)).toBeCloseTo(4 * estimateRenderSeconds(0.25, 1800, 1920, 1080), 9)
    expect(estimateRenderSeconds(0.25, 0, 1920, 1080)).toBe(0)
    expect(estimateRenderSeconds(0.25, 1800, 1920, 1080, 1.2)).toBeCloseTo(1.2 * estimateRenderSeconds(0.25, 1800, 1920, 1080), 9)
  })

  it('counts the forests (+15 % at 60 trees per hectare, in proportion) and the snow (+3 %) against the film the rate comes from', () => {
    const off = { snow: 'aucune', forest: { enabled: false, density: 60 } } as const
    const forests = { snow: 'aucune', forest: { enabled: true, density: 60 } } as const
    expect(layersCost(off)).toBe(1)
    expect(layersCost(forests)).toBeCloseTo(1.15, 9)
    expect(layersCost({ snow: 'aucune', forest: { enabled: true, density: 120 } })).toBeCloseTo(1.3, 9)
    expect(layersCost({ snow: 'meteo', forest: { enabled: false, density: 60 } })).toBeCloseTo(1.03, 9)
    expect(layersRatio(off, forests)).toBeCloseTo(1.15, 9)
    expect(layersRatio(forests, off)).toBeCloseTo(1 / 1.15, 9)
    expect(layersRatio(forests, forests)).toBe(1)
    // a film recorded before the layers were: nothing to compare with, the rate is used as it is
    expect(layersCost({})).toBeNull()
    expect(layersRatio({}, forests)).toBe(1)
    expect(layersRatio(forests, { snow: 'meteo' })).toBe(1)
  })

  it('reads the last film of the list', () => {
    expect(lastFilm([entry({ at: 5, outcome: 'error' }), entry({ at: 3 }), entry({ at: 4, overlayOnly: true })])?.at).toBe(3)
    expect(lastFilm([])).toBeUndefined()
  })
})
