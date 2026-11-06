// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BENCH_PROJECTS, buildBenchProject } from '../../bench/projects'
import gpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { parseProject } from './document'
import { decodeProjectFile, encodeProjectFile } from './file'

const dir = join(process.cwd(), 'bench')

describe('reference projects of the export benchmark', () => {
  for (const project of BENCH_PROJECTS) {
    it(`${project.file} is up to date and opens`, async () => {
      const text = buildBenchProject(project, gpx)
      if (process.env.BENCH_WRITE) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, project.file), Buffer.from(await (await encodeProjectFile(text)).arrayBuffer()))
      }
      const saved = await decodeProjectFile(new Blob([readFileSync(join(dir, project.file))]))
      expect(saved).toBe(text)
      const loaded = parseProject(saved)
      expect(loaded.warnings).toEqual([])
      expect(loaded.tracks).toHaveLength(1)
    })
  }

  it('sets what docs/benchmark.md says', () => {
    const [phone, computer] = BENCH_PROJECTS.map((p) => parseProject(buildBenchProject(p, gpx)).settings)
    expect(phone.video).toMatchObject({ aspect: '9:16', resolution: '1080p', quality: 'high' })
    expect(phone.clouds).toMatchObject({ mode: 'manuel', coverage: 0.55, quality: 'medium' })
    expect(computer.video).toMatchObject({ aspect: '16:9', resolution: '1080p' })
    expect(computer.forest.enabled).toBe(true)
  })
})
