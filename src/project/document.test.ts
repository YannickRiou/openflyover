import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { MEDIA_DEFAULTS } from '../film/model'
import { buildTrack } from '../import/stats'
import { DEFAULT_PLAYBACK, DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  migrateProject,
  parseProject,
  projectFileName,
  sanitizeSettings,
  serializeProject,
  serializeProjectBlob,
  toProjectDocument,
} from './document'

function makeTrack(id: string, color: string): Track {
  const track = buildTrack({
    name: `Trace ${id}`,
    source: 'gpx',
    activityType: 'hiking',
    segments: [
      {
        points: [
          { lon: 6.8691234567, lat: 45.9234567891, ele: 1035.123, time: 1_720_000_000_000, hr: 120 },
          { lon: 6.8701, lat: 45.9241, ele: 1042.5, time: 1_720_000_010_000 },
          { lon: 6.8712, lat: 45.9255, time: 1_720_000_020_000, hr: 131 },
        ],
      },
      { points: [{ lon: 6.88, lat: 45.93, ele: 1100 }] },
    ],
  })
  track.id = id
  track.color = color
  return track
}

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, exaggeration: 1.7, imagerySourceId: 'ign-ortho', wireframe: true }
const STATE = { tracks: [makeTrack('a', '#FF5A36'), makeTrack('b', '#5BC0EB')], settings: SETTINGS, playback: { ...DEFAULT_PLAYBACK, speed: 2 } }

/** Valid serialised document as a mutable object. */
function doc(): Record<string, unknown> {
  return JSON.parse(serializeProject(STATE, 'Mont Blanc')) as Record<string, unknown>
}

describe('serializeProject / parseProject', () => {
  it('round-trips name, settings, speed and tracks (same ids, colours, stats)', () => {
    const text = serializeProject(STATE, '  Mont Blanc  ')
    const loaded = parseProject(text)
    expect(loaded.name).toBe('Mont Blanc')
    expect(loaded.settings).toEqual(SETTINGS)
    expect(loaded.speed).toBe(2)
    expect(loaded.warnings).toEqual([])
    expect(loaded.tracks).toHaveLength(2)
    loaded.tracks.forEach((track, i) => {
      const original = STATE.tracks[i]
      expect(track.id).toBe(original.id)
      expect(track.color).toBe(original.color)
      expect(track.name).toBe(original.name)
      expect(track.activityType).toBe('hiking')
      expect(track.segments.map((s) => s.points.length)).toEqual([3, 1])
      expect(track.stats.pointCount).toBe(original.stats.pointCount)
      expect(track.stats.distanceM).toBeCloseTo(original.stats.distanceM, 2)
      expect(track.stats.ascentM).toBeCloseTo(original.stats.ascentM, 1)
      expect(track.stats.startTime).toBe(original.stats.startTime)
      expect(track.bounds.west).toBeCloseTo(original.bounds.west, 6)
    })
    // missing values stay missing
    const [p0, p1, p2] = loaded.tracks[0].segments[0].points
    expect(p0).toEqual({ lon: 6.8691235, lat: 45.9234568, ele: 1035.12, time: 1_720_000_000_000, hr: 120 })
    expect(p1.hr).toBeUndefined()
    expect(p2.ele).toBeUndefined()
  })

  it('writes a compact column layout, one line per track, without absent columns', () => {
    const text = serializeProject(STATE, 'x')
    const parsed = JSON.parse(text) as ReturnType<typeof toProjectDocument>
    expect(parsed.format).toBe(PROJECT_FORMAT)
    expect(parsed.version).toBe(PROJECT_VERSION)
    expect(parsed.tracks[0].segments[0]).toEqual({
      lon: [6.8691235, 6.8701, 6.8712],
      lat: [45.9234568, 45.9241, 45.9255],
      ele: [1035.12, 1042.5, null],
      time: [1_720_000_000_000, 1_720_000_010_000, 1_720_000_020_000],
      hr: [120, null, 131],
    })
    expect(Object.keys(parsed.tracks[0].segments[1])).toEqual(['lon', 'lat', 'ele'])
    expect(text.split('\n').filter((l) => l.startsWith('    {"id"'))).toHaveLength(2)
    expect(serializeProject({ ...STATE, tracks: [] }, 'x')).toContain('"tracks": []')
    expect(toProjectDocument(STATE, '   ').name).toBe('Sans titre')
  })

  it('carries the pictures of the film, one line each; leaves out the photos without a readable picture', () => {
    const data = 'data:image/jpeg;base64,/9j/AAEC'
    const picture = { data, thumb: data, width: 4, height: 3, name: 'lac.jpg' }
    const photo = { id: 'media-1', startS: 8, durationS: 5, kind: 'image' as const, src: 'photo-1', ...MEDIA_DEFAULTS, caption: 'Lac Blanc' }
    const state = { ...STATE, settings: { ...SETTINGS, film: { ...SETTINGS.film, media: [photo] } } }
    const text = serializeProject(state, 'x', { 'photo-1': picture, 'photo-2': { ...picture, name: 'inutile.jpg' } })
    expect(text.split('\n').filter((l) => l.startsWith('    "photo-'))).toHaveLength(1)
    const loaded = parseProject(text)
    expect(loaded.media).toEqual({ 'photo-1': picture })
    expect(loaded.settings.film.media).toEqual([photo])
    expect(loaded.warnings).toEqual([])

    const raw = JSON.parse(text) as Record<string, unknown>
    delete raw.media
    const without = parseProject(JSON.stringify(raw))
    expect(without.settings.film.media).toEqual([])
    expect(without.warnings).toEqual(['1 média sans fichier lisible dans le projet, retiré du film.'])
    // a film without photos writes no table
    expect(serializeProject(STATE, 'x', { 'photo-1': picture })).not.toContain('"media": {')
    // the sound files of the music too; a music without its file is left out
    const sound = { data: 'data:audio/mpeg;base64,AAAA', name: 'air.mp3', durationS: 90, peaks: [0.5, 1] }
    const music = { id: 'music-1', src: 'audio-1', startS: 0, durationS: 90, inS: 0, volume: 0.8, fadeInS: 0.5, fadeOutS: 2 }
    const scored = { ...STATE, settings: { ...SETTINGS, film: { ...SETTINGS.film, audio: [music] } } }
    const withMusic = parseProject(serializeProject(scored, 'x', { 'audio-1': sound, 'photo-1': picture }))
    expect(withMusic.media).toEqual({ 'audio-1': sound })
    expect(withMusic.settings.film.audio).toEqual([music])
    const silent = parseProject(serializeProject(scored, 'x'))
    expect(silent.settings.film.audio).toEqual([])
    expect(silent.warnings).toEqual(['1 musique sans fichier lisible dans le projet, retirée du film.'])
    expect(parseProject(serializeProject(STATE, 'x')).media).toEqual({})
  })

  it('serializeProjectBlob writes the same document, reusing the stored bytes of each medium', async () => {
    const data = 'data:video/mp4;base64,AAAAGGZ0eXBtcDQy'
    const clip = { data, thumb: 'data:image/jpeg;base64,/9j/AAEC', name: 'col.mp4', durationS: 12, width: 4, height: 3 }
    const photo = { data: 'data:image/jpeg;base64,/9j/AAEC', thumb: 'data:image/jpeg;base64,/9j/AAEC', width: 4, height: 3, name: 'lac é.jpg' }
    const media = [
      { id: 'media-1', startS: 8, durationS: 5, kind: 'video' as const, src: 'video-1', ...MEDIA_DEFAULTS },
      { id: 'media-2', startS: 20, durationS: 5, kind: 'image' as const, src: 'photo-1', ...MEDIA_DEFAULTS },
    ]
    const state = { ...STATE, settings: { ...SETTINGS, film: { ...SETTINGS.film, media } } }
    const table = { 'video-1': clip, 'photo-1': photo }
    const stringify = vi.spyOn(JSON, 'stringify')
    const first = serializeProjectBlob(state, 'Tour', table)
    expect(await first.text()).toBe(serializeProject(state, 'Tour', table))
    // a setting changed: the media are not serialised again
    stringify.mockClear()
    const next = serializeProjectBlob({ ...state, settings: { ...state.settings, exaggeration: 2 } }, 'Tour', table)
    expect(stringify.mock.calls.some(([value]) => value === clip || value === photo)).toBe(false)
    expect(parseProject(await next.text()).media).toEqual(table)
    // a medium replaced (new object) is serialised: nothing stale is written
    const edited = { ...clip, durationS: 13 }
    expect(JSON.parse(await serializeProjectBlob(state, 'Tour', { ...table, 'video-1': edited }).text()).media['video-1'].durationS).toBe(13)
    stringify.mockRestore()
    // no media, no table: same text
    expect(await serializeProjectBlob(STATE, 'x').text()).toBe(serializeProject(STATE, 'x'))
    expect(await serializeProjectBlob({ ...STATE, tracks: [] }, 'x').text()).toBe(serializeProject({ ...STATE, tracks: [] }, 'x'))
  })

  it('falls back to the default per invalid or missing setting and ignores unknown keys', () => {
    const d = doc()
    d.settings = { exaggeration: 'beaucoup', wireframe: true, imageryZoomOffset: 5, terrainSourceId: 'inconnu', sunHour: 14, extra: 1 }
    d.playback = { speed: 3 }
    d.unknownTopLevel = { anything: true }
    const loaded = parseProject(JSON.stringify(d))
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true, sunHour: 14 })
    expect(loaded.settings).not.toHaveProperty('extra')
    expect(loaded.speed).toBe(1)
    expect(loaded.warnings).toEqual([
      'Réglages invalides remplacés par leur valeur par défaut : terrainSourceId, imageryZoomOffset, exaggeration.',
      'Vitesse de lecture invalide : vitesse ×1 utilisée.',
    ])
  })

  it('handles any key of DEFAULT_SETTINGS, including keys added later', () => {
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
    defaults.futureColour = 'speed'
    defaults.futureNested = { size: 2, visible: true }
    try {
      const state = { ...STATE, settings: { ...SETTINGS, futureColour: 'slope', futureNested: { size: 3, visible: false } } as Settings }
      expect(parseProject(serializeProject(state, 'x')).settings).toMatchObject({ futureColour: 'slope', futureNested: { size: 3, visible: false } })
      const { settings, invalid } = sanitizeSettings({ futureColour: 4, futureNested: { size: 'big', visible: true } })
      expect(settings).toMatchObject({ futureColour: 'speed', futureNested: { size: 2, visible: true } })
      expect(invalid).toEqual(['futureColour', 'futureNested'])
    } finally {
      delete defaults.futureColour
      delete defaults.futureNested
    }
  })

  it('keeps the base value for missing keys in sanitizeSettings', () => {
    const base = { ...DEFAULT_SETTINGS, exaggeration: 2.5 }
    expect(sanitizeSettings({ wireframe: true }, base).settings).toEqual({ ...base, wireframe: true })
    expect(sanitizeSettings(null, base)).toEqual({ settings: base, invalid: [] })
  })

  it('validates the ghost race and loads projects saved before it', () => {
    const d = doc()
    const settings = d.settings as Record<string, unknown>
    delete settings.race
    expect(parseProject(JSON.stringify(d)).settings.race).toEqual({ enabled: false, sync: 'elapsed' })
    settings.race = { enabled: true, sync: 'clock' }
    expect(parseProject(JSON.stringify(d)).settings.race).toEqual({ enabled: true, sync: 'clock' })
    const { settings: sanitized, invalid } = sanitizeSettings({ race: { enabled: true, sync: 'warp' } })
    expect(sanitized.race).toEqual(DEFAULT_SETTINGS.race)
    expect(invalid).toEqual(['race'])
  })

  it('loads the keyframes (« Images clés ») of older projects as they were, and saves a pose taken in 3D exactly', () => {
    const d = doc()
    const settings = d.settings as Record<string, unknown>
    // saved by « Garder ce cadrage ici »: no aim shift, rounded figures within the camera ranges
    const old = { id: 'camera-1', atM: 2500, distance: 2.35, pitchDeg: 61.3, headingOffsetDeg: -170 }
    settings.film = { ...(settings.film as object), cameraKeys: [old] }
    expect(parseProject(JSON.stringify(d)).settings.film.cameraKeys).toEqual([old])
    const taken = { id: 'camera-1', atM: 2500.123456, distance: 0.071234567, pitchDeg: 87.654321, headingOffsetDeg: 12.3456789, aimRightM: -31.25, aimAheadM: 4.5 }
    const film = { ...SETTINGS.film, cameraKeys: [taken] }
    expect(parseProject(serializeProject({ ...STATE, settings: { ...SETTINGS, film } }, 'x')).settings.film.cameraKeys).toEqual([taken])
  })

  it('loads « Plusieurs traces » (à la suite, camera of the race) and rejects unknown values', () => {
    const d = doc()
    const settings = d.settings as Record<string, unknown>
    const race = { enabled: false, sync: 'elapsed', sequence: true, stageCards: false, stageTransition: 'fondu-blanc', camera: 'ensemble' }
    settings.race = race
    // saved before the junctions: the transition and the cards of its stages become the film's default junction
    const loaded = parseProject(JSON.stringify(d)).settings
    expect(loaded.race).toEqual({ enabled: false, sync: 'elapsed', sequence: true, camera: 'ensemble' })
    expect(loaded.film.junctionDefault).toEqual({ kind: 'fondu-blanc', holdS: 1.5, card: false })
    expect(sanitizeSettings({ race: { ...race, stageTransition: 'enchaine' } }).invalid).toEqual(['race'])
    expect(sanitizeSettings({ race: { ...race, camera: 'drone' } }).invalid).toEqual(['race'])
    // the order of the stages is saved with the project; a project without it keeps the list order
    const ordered = { ...SETTINGS, race: { ...SETTINGS.race, sequence: true, order: ['b', 'a'] } }
    expect(parseProject(serializeProject({ ...STATE, settings: ordered }, 'x')).settings.race.order).toEqual(['b', 'a'])
    expect(sanitizeSettings({ race: { ...race, order: [1] } }).invalid).toEqual(['race'])
    expect(sanitizeSettings({ race: { enabled: false, sync: 'elapsed', sequence: true } }).settings.race).not.toHaveProperty('order')
    // the flight time of a stage is saved with the film; a project without any, or with one out of range, is the film as ever
    const timed = { ...SETTINGS, film: { ...SETTINGS.film, stageDurations: { a: 42.5 } } }
    expect(parseProject(serializeProject({ ...STATE, settings: timed }, 'x')).settings.film.stageDurations).toEqual({ a: 42.5 })
    expect(parseProject(serializeProject(STATE, 'x')).settings.film).not.toHaveProperty('stageDurations')
    expect(sanitizeSettings({ film: { ...SETTINGS.film, stageDurations: { a: 2 } } }).invalid).toEqual(['film'])
  })

  it('migrates the transition of « À la suite » into the film’s default junction, once', () => {
    const migrated = (race: object, film?: object) => sanitizeSettings({ race: { enabled: false, sync: 'elapsed', sequence: true, ...race }, ...(film && { film }) }).settings
    // a cut holds nothing, a fade the default hold; absent = the default (no junction default to store)
    expect(migrated({ stageTransition: 'coupe' }).film.junctionDefault).toEqual({ kind: 'coupe', holdS: 0, card: true })
    expect(migrated({ stageTransition: 'fondu-noir' }).film.junctionDefault).toEqual({ kind: 'fondu-noir', holdS: 1.5, card: true })
    expect(migrated({ stageCards: false }).film.junctionDefault).toEqual({ kind: 'fondu-noir', holdS: 1.5, card: false })
    expect(migrated({}).film.junctionDefault).toBeUndefined()
    // a film that already chose keeps its choice; the old fields are dropped either way
    const chosen = { ...DEFAULT_SETTINGS.film, junctionDefault: { kind: 'nuit', holdS: 2, card: true } }
    const both = migrated({ stageTransition: 'coupe' }, chosen)
    expect(both.film.junctionDefault).toEqual({ kind: 'nuit', holdS: 2, card: true })
    expect(both.race).not.toHaveProperty('stageTransition')
    // junctions of a film are loaded as saved, invalid ones refuse the film
    const own = { ...DEFAULT_SETTINGS.film, junctions: [{ id: 'junction-a', afterTrackId: 'a', kind: 'fondu-blanc', holdS: 3 }] }
    expect(sanitizeSettings({ film: own }).settings.film.junctions).toEqual(own.junctions)
    expect(sanitizeSettings({ film: { ...own, junctions: [{ ...own.junctions[0], holdS: 99 }] } }).invalid).toEqual(['film'])
  })

  it('opens a removed imagery source in its successor, without a warning', () => {
    const opened = (imagerySourceId: string) => sanitizeSettings({ imagerySourceId })
    expect(opened('eox-s2cloudless')).toMatchObject({ invalid: [], settings: { imagerySourceId: 'arcgis-world-imagery' } })
    for (const id of ['ign-ortho-1950-1965', 'ign-ortho-1965-1980', 'ign-ortho-2000-2005']) {
      expect(opened(id)).toMatchObject({ invalid: [], settings: { imagerySourceId: 'ign-ortho' } })
    }
    expect(opened('swisstopo').settings.imagerySourceId).toBe('swisstopo')
    // an id that never existed is still refused
    expect(opened('nowhere').invalid).toEqual(['imagerySourceId'])
  })

  it('loads the fixed video formats of older projects as aspect × resolution', () => {
    const { settings, invalid } = sanitizeSettings({ video: { format: '1080x1920', fps: 60, quality: 'max' } })
    expect(invalid).toEqual([])
    expect(settings.video).toEqual({ ...DEFAULT_SETTINGS.video, aspect: '9:16', resolution: '1080p', fps: 60, quality: 'max' })
    expect(sanitizeSettings({ video: { aspect: '1:1', resolution: '8k', fps: 30, quality: 'high' } }).invalid).toEqual(['video'])
  })

  it('loads the landmarks of older projects without hidden ids and rejects ids that are not strings', () => {
    const { hiddenIds: _ignored, ...older } = DEFAULT_SETTINGS.landmarks
    const { settings, invalid } = sanitizeSettings({ landmarks: older })
    expect(invalid).toEqual([])
    expect(settings.landmarks).toEqual({ ...older, hiddenIds: [] })
    const kept = sanitizeSettings({ landmarks: { ...DEFAULT_SETTINGS.landmarks, hiddenIds: ['node/1'] } })
    expect(kept.settings.landmarks.hiddenIds).toEqual(['node/1'])
    expect(sanitizeSettings({ landmarks: { ...DEFAULT_SETTINGS.landmarks, hiddenIds: [1] } }).invalid).toEqual(['landmarks'])
  })

  it('loads the landmarks of older projects without density or pinned ids, and rejects invalid ones', () => {
    const { density: _density, pinnedIds: _pinned, ...older } = DEFAULT_SETTINGS.landmarks
    const { settings, invalid } = sanitizeSettings({ landmarks: older })
    expect(invalid).toEqual([])
    expect(settings.landmarks).toEqual({ ...older, density: 'normal', pinnedIds: [] })
    // the cap of the projects saved before the density becomes the nearest one; a pinned and hidden landmark is Jamais
    const capped = sanitizeSettings({ landmarks: { ...older, maxCount: 20, hiddenIds: ['node/1'], pinnedIds: ['node/1', 'node/2'] } })
    expect(capped.invalid).toEqual([])
    expect(capped.settings.landmarks).toMatchObject({ density: 'few', hiddenIds: ['node/1'], pinnedIds: ['node/2'] })
    expect(capped.settings.landmarks).not.toHaveProperty('maxCount')
    const kept = sanitizeSettings({ landmarks: { ...DEFAULT_SETTINGS.landmarks, density: 'many', pinnedIds: ['node/1'] } })
    expect(kept.settings.landmarks).toMatchObject({ density: 'many', pinnedIds: ['node/1'] })
    for (const bad of [{ density: 'lots' }, { density: 40 }, { pinnedIds: [1] }, { pinnedIds: 'x' }]) {
      expect(sanitizeSettings({ landmarks: { ...DEFAULT_SETTINGS.landmarks, ...bad } }).invalid).toEqual(['landmarks'])
    }
  })

  it('loads older projects with the manual haze setting, since removed, without a warning', () => {
    const d = doc()
    d.settings = { ...(d.settings as object), haze: 0.6 }
    const loaded = parseProject(JSON.stringify(d))
    expect(loaded.settings).not.toHaveProperty('haze')
    expect(loaded.warnings).toEqual([])
  })

  it('loads the clouds of older projects without the sea of clouds and validates its top', () => {
    const { seaTopM: _ignored, ...older } = DEFAULT_SETTINGS.clouds
    const { settings, invalid } = sanitizeSettings({ clouds: { ...older, mode: 'manuel' } })
    expect(invalid).toEqual([])
    expect(settings.clouds).toEqual({ ...DEFAULT_SETTINGS.clouds, mode: 'manuel' })
    expect(sanitizeSettings({ clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'mer', seaTopM: 2400 } }).settings.clouds.seaTopM).toBe(2400)
    expect(sanitizeSettings({ clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'mer', seaTopM: 9000 } }).invalid).toEqual(['clouds'])
  })

  it('loads the sea of clouds of older projects as volumetric and validates its rendering', () => {
    const { seaRender: _ignored, ...older } = DEFAULT_SETTINGS.clouds
    const { settings, invalid } = sanitizeSettings({ clouds: { ...older, mode: 'mer', seaTopM: 2400 } })
    expect(invalid).toEqual([])
    expect(settings.clouds).toEqual({ ...DEFAULT_SETTINGS.clouds, mode: 'mer', seaTopM: 2400, seaRender: 'volume' })
    expect(sanitizeSettings({ clouds: { ...DEFAULT_SETTINGS.clouds, seaRender: 'surface' } }).settings.clouds.seaRender).toBe('surface')
    expect(sanitizeSettings({ clouds: { ...DEFAULT_SETTINGS.clouds, seaRender: 'plat' } }).invalid).toEqual(['clouds'])
  })

  it('loads projects saved before « Objectif » with every lens effect off, partial ones filled, and checks the ranges', () => {
    expect(sanitizeSettings({ exaggeration: 1.2 }).settings.lens).toEqual(DEFAULT_SETTINGS.lens)
    const partial = sanitizeSettings({ lens: { shutter: 0.5 } })
    expect(partial.invalid).toEqual([])
    expect(partial.settings.lens).toEqual({ ...DEFAULT_SETTINGS.lens, shutter: 0.5 })
    expect(sanitizeSettings({ lens: { ...DEFAULT_SETTINGS.lens, bloom: 2 } }).invalid).toEqual(['lens'])
  })

  it('rejects an unknown track colour mode and an out-of-range exposure', () => {
    const { settings, invalid } = sanitizeSettings({ trackColorBy: 'rainbow', exposureEv: 12 })
    expect(settings.trackColorBy).toBe(DEFAULT_SETTINGS.trackColorBy)
    expect(settings.exposureEv).toBe(DEFAULT_SETTINGS.exposureEv)
    expect(invalid).toEqual(expect.arrayContaining(['trackColorBy', 'exposureEv']))
  })

  it('replaces an invalid colour by the palette and a missing name by a label', () => {
    const d = doc()
    const tracks = d.tracks as Record<string, unknown>[]
    tracks[0].color = 'red; background: url(x)'
    delete tracks[1].name
    const loaded = parseProject(JSON.stringify(d))
    expect(loaded.tracks[0].color).toBe('#FF5A36')
    expect(loaded.tracks[1].name).toBe('Trace n°2')
  })

  it('round-trips GPX waypoints (rounded) and omits them when a track has none', () => {
    const track = makeTrack('w', '#FF5A36')
    track.waypoints = [
      { lon: 6.78201234567, lat: 45.86312345678, ele: 1653.456, name: 'Col de Voza' },
      { lon: 6.77, lat: 45.85, name: 'Point 2' },
    ]
    const text = serializeProject({ ...STATE, tracks: [track, makeTrack('b', '#5BC0EB')] }, 'x')
    const parsed = JSON.parse(text) as ReturnType<typeof toProjectDocument>
    expect(parsed.tracks[1]).not.toHaveProperty('waypoints')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].waypoints).toEqual([
      { lon: 6.7820123, lat: 45.8631235, ele: 1653.46, name: 'Col de Voza' },
      { lon: 6.77, lat: 45.85, name: 'Point 2' },
    ])
    expect(loaded.tracks[1].waypoints).toBeUndefined()
  })

  it('round-trips the UTC offset of a track and drops an invalid one', () => {
    const track = { ...makeTrack('o', '#FF5A36'), utcOffsetMin: 120 }
    const text = serializeProject({ ...STATE, tracks: [track, makeTrack('b', '#5BC0EB')] }, 'x')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].utcOffsetMin).toBe(120)
    expect(loaded.tracks[1]).not.toHaveProperty('utcOffsetMin')
    const d = JSON.parse(text) as { tracks: Record<string, unknown>[] }
    d.tracks[0].utcOffsetMin = 'UTC+2'
    expect(parseProject(JSON.stringify(d)).tracks[0]).not.toHaveProperty('utcOffsetMin')
  })

  it('round-trips estimated times, and drops the flag on an untimed track or a wrong value', () => {
    const track = { ...makeTrack('e', '#FF5A36'), timesEstimated: true }
    const text = serializeProject({ ...STATE, tracks: [track, makeTrack('b', '#5BC0EB')] }, 'x')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].timesEstimated).toBe(true)
    expect(loaded.tracks[1]).not.toHaveProperty('timesEstimated')
    const d = JSON.parse(text) as { tracks: { timesEstimated?: unknown; segments: Record<string, unknown>[] }[] }
    d.tracks[0].timesEstimated = 'oui'
    d.tracks[1].timesEstimated = true
    for (const segment of d.tracks[1].segments) delete segment.time
    const reloaded = parseProject(JSON.stringify(d))
    expect(reloaded.tracks[0]).not.toHaveProperty('timesEstimated')
    expect(reloaded.tracks[1]).not.toHaveProperty('timesEstimated')
  })

  it('round-trips computed elevations, and drops the flag on a track without elevation or a wrong value', () => {
    const track: Track = { ...makeTrack('a', '#FF5A36'), elevationEstimated: 'all' }
    const text = serializeProject({ ...STATE, tracks: [track, makeTrack('b', '#5BC0EB')] }, 'x')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].elevationEstimated).toBe('all')
    expect(loaded.tracks[1]).not.toHaveProperty('elevationEstimated')
    const d = JSON.parse(text) as { tracks: { elevationEstimated?: unknown; segments: Record<string, unknown>[] }[] }
    d.tracks[0].elevationEstimated = true
    d.tracks[1].elevationEstimated = 'gaps'
    for (const segment of d.tracks[1].segments) delete segment.ele
    const reloaded = parseProject(JSON.stringify(d))
    expect(reloaded.tracks[0]).not.toHaveProperty('elevationEstimated')
    expect(reloaded.tracks[1]).not.toHaveProperty('elevationEstimated')
  })

  it('round-trips the flights; an old project or a wrong list leaves the track on the ground', () => {
    const flights = [{ startM: 100, endM: 900, offsetM: 12.5 }]
    const text = serializeProject({ ...STATE, tracks: [{ ...makeTrack('a', '#FF5A36'), flights }, makeTrack('b', '#5BC0EB')] }, 'x')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].flights).toEqual(flights)
    expect(loaded.tracks[1]).not.toHaveProperty('flights')
    const d = JSON.parse(text) as { tracks: { flights?: unknown }[] }
    d.tracks[0].flights = [{ startM: 900, endM: 100, offsetM: 0 }]
    expect(parseProject(JSON.stringify(d)).tracks[0]).not.toHaveProperty('flights')
  })
})

describe('parseProject errors', () => {
  const cases: [string, (d: Record<string, unknown>) => unknown, RegExp][] = [
    ['not JSON', () => '{', /pas du JSON valide/],
    ['another JSON', () => ({ type: 'FeatureCollection' }), /pas un projet OpenFlyover/],
    ['an array', () => [], /pas un projet OpenFlyover/],
    ['a future version', (d) => ({ ...d, version: 7 }), /format v7, plus récent .*\(v2\)/],
    ['a bad version', (d) => ({ ...d, version: '1' }), /version/],
    ['no tracks', (d) => ({ ...d, tracks: undefined }), /liste des traces/],
    ['a track without id', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], id: '' }] }), /Trace n°1 : identifiant/],
    ['an unknown source', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], source: 'kml' }] }), /origine/],
    [
      'out-of-range coordinates',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6, 200], lat: [45, 45] }] }] }),
      /Trace n°1, segment 1 : coordonnées invalides au point 2/,
    ],
    [
      'columns of different lengths',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6, 7], lat: [45, 45], ele: [1] }] }] }),
      /colonne « ele » invalide \(2 valeurs attendues\)/,
    ],
    [
      'a non-numeric value',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6], lat: [45], time: ['hier'] }] }] }),
      /valeur « time » invalide au point 1/,
    ],
    ['a track without points', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [], lat: [] }] }] }), /aucun point/],
    [
      'a waypoint with bad coordinates',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], waypoints: [{ lon: 6, lat: 95, name: 'x' }] }] }),
      /Trace n°1, point 1 : coordonnées invalides/,
    ],
    ['waypoints that are not a list', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], waypoints: {} }] }), /« waypoints »/],
    ['duplicate ids', (d) => ({ ...d, tracks: [(d.tracks as object[])[0], (d.tracks as object[])[0]] }), /deux traces .*« a »/],
  ]
  it.each(cases)('rejects %s with a French message', (_, mutate, message) => {
    const value = mutate(doc())
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    expect(() => parseProject(text)).toThrow(message)
  })
})

describe('migrateProject', () => {
  const migrations = {
    1: (d: Record<string, unknown>) => ({ ...d, renamed: d.old, old: undefined }),
    2: (d: Record<string, unknown>) => ({ ...d, extra: 'v3' }),
  }

  it('chains the migrations from the document version up to the target', () => {
    expect(migrateProject({ version: 1, old: 'x' }, migrations, 3)).toEqual({ version: 3, renamed: 'x', old: undefined, extra: 'v3' })
    expect(migrateProject({ version: 2 }, migrations, 3)).toEqual({ version: 3, extra: 'v3' })
    expect(migrateProject({ version: 3, a: 1 }, migrations, 3)).toEqual({ version: 3, a: 1 })
  })

  it('fails on a missing step or a newer version', () => {
    expect(() => migrateProject({ version: 1 }, { 2: migrations[2] }, 3)).toThrow(/du format v1 vers v2/)
    expect(() => migrateProject({ version: 4 }, migrations, 3)).toThrow(/v4, plus récent/)
    expect(() => migrateProject({ version: 0 }, migrations, 3)).toThrow(/version/)
  })

  it('leaves current documents untouched with the built-in table', () => {
    const d = doc()
    expect(migrateProject(d)).toEqual(d)
  })
})

describe('projectFileName', () => {
  it('builds a safe <name>.opnflvr', () => {
    expect(projectFileName('Tour du Mont-Blanc J1')).toBe('Tour du Mont-Blanc J1.opnflvr')
    expect(projectFileName('a/b:c*?')).toBe('a-b-c-.opnflvr')
    expect(projectFileName('  ..  ')).toBe('projet.opnflvr')
  })
})
