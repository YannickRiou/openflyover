import { describe, expect, it } from 'vitest'
import { PROJECT_VERSION, migrateProject, parseProject } from './document'

// One frozen project file per format version, in __fixtures__/ (see its README: never regenerate them).
const FILES = import.meta.glob('./__fixtures__/v*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const frozen = Object.entries(FILES)
  .map(([path, text]) => ({ version: Number(/v(\d+)\.json$/.exec(path)?.[1]), text }))
  .sort((a, b) => a.version - b.version)

describe('frozen project files, one per format version', () => {
  it('has a file for every version up to the current one, so raising PROJECT_VERSION needs a new one', () => {
    const have = frozen.map((f) => f.version)
    const expected = Array.from({ length: PROJECT_VERSION }, (_, i) => i + 1)
    const missing = expected.filter((v) => !have.includes(v))
    expect(
      missing,
      `No frozen project file for format version(s) ${missing.join(', ')}. PROJECT_VERSION was raised (or a file removed): ` +
        'add src/project/__fixtures__/v<N>.json, a project as the app wrote it at the commit that makes the bump ' +
        '(serialise with the code of that commit, never regenerate an old file from later code), and a row in the README there. ' +
        'See docs/project-format.md, "Changing the format".',
    ).toEqual([])
  })

  it.each(frozen)('v$version: opens, migrates to the current version and gives a sane film', ({ version, text }) => {
    const raw = JSON.parse(text) as Record<string, unknown>
    expect(raw.version).toBe(version)
    expect(migrateProject(raw).version).toBe(PROJECT_VERSION)

    const p = parseProject(text)
    expect(p.tracks).toHaveLength(1)
    const [track] = p.tracks
    expect(track.segments[0].points).toHaveLength(3)
    expect(track.stats.pointCount).toBe(3)
    expect(p.settings.flyoverDurationS).toBeGreaterThan(0)
    expect(p.speed).toBeGreaterThan(0)
    const film = p.settings.film
    for (const lane of [film.stops, film.speeds, film.texts, film.cameraKeys, film.media, film.audio] as unknown[][]) {
      expect(Array.isArray(lane)).toBe(true)
    }
    expect(p.warnings).toEqual([])
  })

  it('every version: the name, a setting and the text written by the app of that version are still there', () => {
    for (const { version, text } of frozen) {
      const { settings, name } = parseProject(text)
      expect(name, `v${version}`).toBe('Lac Blanc')
      expect(settings.exaggeration, `v${version}`).toBe(1.7)
      expect(settings.film.texts.map((s) => s.id), `v${version}`).toEqual(['text-1'])
    }
  })
})
