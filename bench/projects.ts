/**
 * The reference projects of the export benchmark (docs/benchmark.md): the settings of each, built on the same
 * track (Tour du Mont-Blanc, day 1, dated 2025-07-12 so that the weather is the same at each version) and written
 * with the app's own serializer. `src/project/bench.test.ts` checks that the committed files are what this builds
 * and that the app parses them; `BENCH_WRITE=1 npx vitest run src/project/bench.test.ts` writes them again.
 */
import { assignColors } from '../src/import'
import { parseGpx } from '../src/import/gpx'
import { serializeProject } from '../src/project/document'
import type { ProjectSource } from '../src/project/document'
import { DEFAULT_PLAYBACK, DEFAULT_SETTINGS } from '../src/state/store'
import type { Settings } from '../src/state/store'

export interface BenchProject {
  /** file name in bench/ */
  file: string
  /** name shown in the app */
  name: string
  settings: (base: Settings) => Settings
}

/** a few overlay elements: title, figures, profile, map */
const overlay = (base: Settings): Settings['overlay'] => ({
  ...base.overlay,
  enabled: true,
  title: { ...base.overlay.title, enabled: true, title: 'Benchmark', subtitle: 'Tour du Mont-Blanc, jour 1' },
  minimap: { ...base.overlay.minimap, enabled: true },
})

export const BENCH_PROJECTS: readonly BenchProject[] = [
  {
    // vertical 9:16, 1080 x 1920, « Haute », medium clouds at 55 % cover, shadows, water, overlay; no forests, no landmarks
    file: 'phone.opnflvr',
    name: 'Benchmark téléphone (9:16, Haute, nuages)',
    settings: (base) => ({
      ...base,
      shadows: true,
      cloudShadows: true,
      clouds: { ...base.clouds, mode: 'manuel', coverage: 0.55, quality: 'medium' },
      water: { ...base.water, enabled: true },
      forest: { ...base.forest, enabled: false },
      landmarks: { ...base.landmarks, enabled: false },
      overlay: overlay(base),
      video: { ...base.video, aspect: '9:16', resolution: '1080p', fps: 24, quality: 'high' },
    }),
  },
  {
    // 16:9 1080p, forests, water, landmarks, overlay; no clouds
    file: 'computer.opnflvr',
    name: 'Benchmark ordinateur (16:9, 1080p, forêts)',
    settings: (base) => ({
      ...base,
      shadows: true,
      clouds: { ...base.clouds, mode: 'aucun' },
      water: { ...base.water, enabled: true },
      forest: { ...base.forest, enabled: true },
      landmarks: { ...base.landmarks, enabled: true },
      overlay: overlay(base),
      video: { ...base.video, aspect: '16:9', resolution: '1080p', fps: 30, quality: 'high' },
    }),
  },
]

/** The JSON text of a reference project, the same for the same code (a fixed track id, the track's own dates). */
export function buildBenchProject(project: BenchProject, gpx: string): string {
  const [track] = assignColors(parseGpx(gpx, 'tour-du-mont-blanc-j1.gpx'))
  const state: ProjectSource = {
    tracks: [{ ...track, id: 'bench-tmb-j1' }],
    settings: project.settings(DEFAULT_SETTINGS),
    playback: { ...DEFAULT_PLAYBACK },
  }
  return serializeProject(state, project.name)
}
