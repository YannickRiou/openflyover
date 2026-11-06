// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { BENCH_PROJECTS, buildBenchProject } from '../../bench/projects'
import gpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { parseProject } from './document'
import { decodeProjectFile, encodeProjectFile } from './file'

// Node's fs, typed here: the app's tsconfig has no Node types (they would change the browser's timers and globals)
interface NodeFs {
  mkdirSync(path: string, options: { recursive: boolean }): void
  readFileSync(path: string): Uint8Array<ArrayBuffer>
  writeFileSync(path: string, data: Uint8Array): void
}
const nodeProcess = (globalThis as unknown as { process: { cwd(): string; env: Record<string, string | undefined> } }).process
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as NodeFs
const dir = `${nodeProcess.cwd()}/bench`

describe('reference projects of the export benchmark', () => {
  for (const project of BENCH_PROJECTS) {
    it(`${project.file} is up to date and opens`, async () => {
      const text = buildBenchProject(project, gpx)
      if (nodeProcess.env.BENCH_WRITE) {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(`${dir}/${project.file}`, new Uint8Array(await (await encodeProjectFile(text)).arrayBuffer()))
      }
      const saved = await decodeProjectFile(new Blob([fs.readFileSync(`${dir}/${project.file}`)]))
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
