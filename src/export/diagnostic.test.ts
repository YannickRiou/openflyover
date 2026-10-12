import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_BUDGET, budgetFor } from '../core/deviceBudget'
import type { FilmMedia, FilmText } from '../film/model'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import {
  buildReport,
  copyText,
  formatReport,
  noEncodingTest,
  parseReport,
  resultSection,
  setNoEncodingTest,
  withLastExport,
  withResult,
} from './diagnostic'
import { EMPTY_TIMINGS } from './store'
import type { DiagnosticInput } from './diagnostic'
import { MAX_STEPS, describeBreadcrumb } from './guard'

const PHONE = budgetFor({ coarsePointer: true, shortSidePx: 390 })
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1'

/** A track, a photo and texts full of names and coordinates the report must not repeat. */
function privateInput(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  const track = buildTrack({
    name: 'Tour de Chamonix',
    source: 'gpx',
    segments: [{ points: [6.869123, 6.871234, 6.873345].map((lon, i) => ({ lon, lat: 45.923456 + i / 1e4, ele: 1035 })) }],
  })
  const text = { id: 't1', startS: 1, durationS: 3, text: 'Arrivée à Argentière', anchor: 'center', size: 1 } as FilmText
  const photo = { id: 'm1', startS: 2, durationS: 3, kind: 'photo', src: 'photo-1', layout: 'card', anchor: 'center', size: 1 } as unknown as FilmMedia
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    film: { ...DEFAULT_SETTINGS.film, texts: [text], media: [photo] },
    overlay: { ...DEFAULT_SETTINGS.overlay, enabled: true, title: { ...DEFAULT_SETTINGS.overlay.title, title: 'Col de Balme' } },
  }
  return {
    now: Date.UTC(2026, 9, 11, 12, 3, 40),
    version: '0.1.0',
    desktop: false,
    encoder: 'webcodecs',
    canStreamToDisk: false,
    userAgent: IPHONE_UA,
    screen: { width: 390, height: 844 },
    viewport: { width: 390, height: 664 },
    pixelRatio: 3,
    cores: 6,
    budget: PHONE,
    gpu: { maxTextureSize: 16384, renderer: 'Apple GPU', antialias: false },
    settings,
    tracks: [track],
    media: { 'photo-1': { data: `data:image/jpeg;base64,${'A'.repeat(4000)}`, name: 'Chamonix.jpg', lon: 6.869123, lat: 45.923456 } },
    request: { width: 1280, height: 720, fps: 30, quality: 'standard', durationS: 60, holdStartS: 1, holdEndS: 2 },
    ...overrides,
  }
}

const rowsOf = (input: DiagnosticInput, title: string) => Object.fromEntries(buildReport(input).sections.find((s) => s.title === title)!.rows)

describe('diagnostic report', () => {
  it('holds no coordinate, no track, place or file name', () => {
    const text = formatReport({ ...buildReport(privateInput()), steps: ['export : démarrage à 14:03:40'] })
    for (const secret of ['Chamonix', 'Argentière', 'Balme', '6.869', '6,869', '45.92', '45,92', '.jpg']) expect(text).not.toContain(secret)
  })

  it('tells the device, its budget and the GPU', () => {
    const device = rowsOf(privateInput(), 'Appareil')
    expect(device).toMatchObject({
      Version: '0.1.0, site web',
      Navigateur: IPHONE_UA,
      'Écran': '390 × 844, densité 3',
      'Mémoire annoncée': 'inconnue',
      'Carte graphique': 'Apple GPU',
      'Texture max': '16384 px',
      'Anticrénelage du canevas': 'non',
      'budget.kind': 'phone',
      'budget.shadowMapSize': '2048',
      'budget.maxLodHeightPx': '720',
      'budget.maxVideoBitrate': '8000000',
    })
    expect(rowsOf(privateInput({ budget: DESKTOP_BUDGET, desktop: true }), 'Appareil')).toMatchObject({
      Version: '0.1.0, application de bureau',
      'budget.maxLodHeightPx': 'illimité',
    })
  })

  it('tells the export: size, effective render, capped bitrate, destination, length and size estimate', () => {
    expect(rowsOf(privateInput(), 'Export')).toEqual({
      Demande: 'film',
      Taille: '1280 × 720',
      'Images par seconde': '30',
      'Qualité': 'standard',
      'Rendu effectif': 'nuages low, 4 rendus par image au plus',
      'Débit vidéo (H.264)': '4,1 Mbit/s',
      Destination: 'mémoire',
      'Durée du film': '63,0 s, 1890 images',
      'Taille estimée': '32,6 Mo',
    })
    const high = rowsOf(privateInput({ request: { ...privateInput().request!, width: 1920, height: 1080, quality: 'max' } }), 'Export')
    expect(high['Débit vidéo (H.264)']).toBe('8,0 Mbit/s, plafonné à 8,0 Mbit/s')
    // no request: what the current settings would export
    expect(rowsOf(privateInput({ request: undefined }), 'Export')).toMatchObject({ Demande: 'aucune (réglages actuels)', Destination: 'mémoire' })
  })

  it('says when « Export de test sans encodage » is on, a switch of the tab only', () => {
    expect(rowsOf(privateInput({ noEncoding: true }), 'Export').Encodage).toBe('désactivé (test)')
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
    expect(noEncodingTest(storage)).toBe(false)
    setNoEncodingTest(true, storage)
    expect(noEncodingTest(storage)).toBe(true)
    setNoEncodingTest(false, storage)
    expect(noEncodingTest(storage)).toBe(false)
    expect(noEncodingTest(undefined)).toBe(false)
  })

  it('tells every setting that weighs on memory, the tracks and the media by kind and size', () => {
    const settings = rowsOf(privateInput(), 'Réglages')
    expect(settings).toMatchObject({
      'Atmosphère': 'oui',
      Ombres: 'oui',
      'Exagération du relief': expect.stringMatching(/^× /),
      Marqueur: expect.any(String),
      Traces: '1, 3 points',
      'Médias du film': '1 photo(s), 0 vidéo(s), 0 musique(s), 0,0 Mo',
      'Textes du film': '1',
      Habillage: expect.stringMatching(/^oui, \d+ élément\(s\)$/),
    })
    expect(Object.keys(settings)).toEqual(expect.arrayContaining(['Nuages', 'Fond de carte', 'Étiquettes', 'Repères OpenStreetMap', 'Trace', 'Flou de bougé']))
  })

  it('formats one « clé : valeur » per line, by section, in a stable order', () => {
    const report = { at: '2026-10-11T12:03:40.000Z', sections: [{ title: 'Export', rows: [['Taille', '1280 × 720'] as [string, string]] }] }
    expect(formatReport({ ...report, steps: ['export : démarrage à 14:03:40', 'pagehide à 14:03:44'] })).toBe(
      [
        'Rapport de diagnostic OpenFlyover',
        'Fait le : 2026-10-11T12:03:40.000Z',
        '',
        '[Export]',
        'Taille : 1280 × 720',
        '',
        '[Étapes]',
        '1 : export : démarrage à 14:03:40',
        '2 : pagehide à 14:03:44',
      ].join('\n'),
    )
    const full = formatReport(buildReport(privateInput()))
    expect(full).toBe(formatReport(buildReport(privateInput())))
    expect(full.split('\n').filter((l) => l.startsWith('['))).toEqual(['[Appareil]', '[Export]', '[Réglages]'])
  })

  it('stays small: long values cut, the stored report and the steps under 16 KB', () => {
    const report = buildReport(privateInput({ userAgent: 'x'.repeat(5000), gpu: { maxTextureSize: 4096, renderer: 'y'.repeat(5000), antialias: true } }))
    const rows = Object.fromEntries(report.sections[0].rows)
    expect(rows.Navigateur.length).toBe(200)
    const counters = { textures: 999, geometries: 999, tiles: 999, pending: 999, bitmaps: 999, bitmapMb: 999, grids: 999, inFlight: 99, queue: 99, drapes: 999 }
    const steps = Array.from({ length: MAX_STEPS }, (_, i) =>
      describeBreadcrumb({ event: `export : image ${i * 25} / 1890`.padEnd(80, '.'), at: 0, ...counters, heapMb: 9999 }, { event: '', at: -99_000 }),
    )
    expect(new TextEncoder().encode(JSON.stringify(report)).length + new TextEncoder().encode(JSON.stringify(steps)).length).toBeLessThan(16_000)
  })

  it('reads a stored report back, tolerates garbage, and adds the last export to the one made now', () => {
    const report = buildReport(privateInput())
    expect(parseReport(JSON.stringify(report))).toEqual(report)
    expect(parseReport('{')).toBeNull()
    expect(parseReport(null)).toBeNull()
    expect(parseReport(JSON.stringify({ at: 1 }))).toBeNull()
    const now = buildReport(privateInput({ request: undefined }))
    const merged = withLastExport(now, report)
    expect(merged.sections.map((s) => s.title)).toEqual(['Appareil', 'Export', 'Réglages', 'Dernier export'])
    expect(merged.sections[3].rows[0]).toEqual(['Commencé le', report.at])
    expect(withLastExport(now, null)).toBe(now)
  })

  it('adds how the export ended: the error naming the tiles, where the time went, the encoder', () => {
    const error = "Tuiles introuvables pour l'image 12 : data.geopf.fr, tuile 14/8345/5843 (imagerie) : HTTP 503, 8 essais. Export arrêté…"
    const timings = { ...EMPTY_TIMINGS, rendered: 11, renders: 22, renderMs: 4000, gpuMs: 2000, gpuRenders: 22, givenUp: 1 }
    const result = resultSection({ phase: 'error', error, frame: 11, frameCount: 300, timings, result: null })
    const rows = Object.fromEntries(result.rows)
    expect(rows['Issue']).toBe('échoué')
    expect(rows['Erreur']).toBe(error)
    expect(rows['Images']).toBe('11 / 300, 11 rendues, 22 rendus')
    expect(rows['Répartition']).toContain('GPU 2,0 s')
    expect(rows['Tuiles']).toBe('0 image(s) au délai, 1 image(s) aux tuiles abandonnées')
    expect(rows['Temps GPU']).toBeUndefined()
    // stored with the report of the export, shown with it in « Dernier export »
    const report = withResult(withResult(buildReport(privateInput()), result), result)
    expect(report.sections.map((s) => s.title)).toEqual(['Appareil', 'Export', 'Réglages', 'Résultat'])
    const merged = withLastExport(buildReport(privateInput({ request: undefined })), parseReport(JSON.stringify(report)))
    expect(merged.sections[3].rows).toContainEqual(['Erreur', error])
    const unmeasured = resultSection({ phase: 'done', error: null, frame: 1, frameCount: 1, timings: EMPTY_TIMINGS, result: { codec: 'mp4/avc', hardware: true } as never })
    expect(Object.fromEntries(unmeasured.rows)['Temps GPU']).toMatch(/^non mesuré/)
    expect(Object.fromEntries(unmeasured.rows)['Fichier']).toBe('mp4/avc, encodeur matériel')
  })
})

describe('copyText', () => {
  it('writes the clipboard, and says so when it is refused or missing', async () => {
    const writeText = vi.fn(async () => undefined)
    await expect(copyText('rapport', { writeText } as unknown as Clipboard)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('rapport')
    const refused = { writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) } as unknown as Clipboard
    await expect(copyText('rapport', refused)).resolves.toBe(false)
    await expect(copyText('rapport', undefined)).resolves.toBe(false)
  })
})
