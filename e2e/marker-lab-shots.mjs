/**
 * PROTOTYPE: screenshots of the marker looks (`?marker-lab=current|a|b`) in the real scene.
 *   node e2e/marker-lab-shots.mjs <out-dir> [figure] [variants] [stage]
 * Writes <variant>-close.png (marker large), <variant>-film.png (usual size), and a sequence <variant>-seq-<n>.png.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.argv[2]
const FIGURE = process.argv[3] ?? 'randonneur'
const VARIANTS = (process.argv[4] ?? 'current,a,b').split(',')
const FRACTION = Number(process.argv[5] ?? 0.45)
const SEQ = process.env.SEQ === '1'
const CHROME = process.env.OPENFLYOVER_CHROME || '/usr/bin/google-chrome'
mkdirSync(OUT, { recursive: true })

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-lab'),
  server: { host: '127.0.0.1', port: 5391, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--lang=fr', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
})
const stats = {}
try {
  for (const spec of VARIANTS) {
    const [variant, glb = ''] = spec.split(':')
    const tag = spec.replace(':', '-')
    const page = await browser.newPage()
    page.setDefaultTimeout(180_000)
    page.on('pageerror', (e) => console.log('PAGEERROR', variant, e.message))
    page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', variant, m.text().slice(0, 300)))
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }))
    await page.goto(`${base}?marker-lab=${variant}${glb ? `&glb=${glb}` : ''}`, { waitUntil: 'domcontentloaded' })
    for (let attempt = 0; ; attempt++) {
      try {
        await (await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true })).click()
        break
      } catch (error) {
        if (attempt >= 4) throw error
      }
    }
    await page.waitForSelector('canvas[data-engine^="three.js"]')
    await page.waitForSelector('[role="group"][aria-label="Plans"]')
    await page.evaluate(async () => {
      const [{ getFilmSource }, { filmClockFor }, { useAppStore }, { DEFAULT_MARKER }] = await Promise.all([
        import('/src/scene/usePacing.ts'),
        import('/src/film/clock.ts'),
        import('/src/state/store.ts'),
        import('/src/scene/markerSettings.ts'),
      ])
      window.__lab2 = { getFilmSource, filmClockFor, store: useAppStore, DEFAULT_MARKER }
    })
    const info = await page.evaluate(
      (figure) => {
        const { store, DEFAULT_MARKER } = window.__lab2
        store.getState().setSetting('marker', { ...DEFAULT_MARKER, kind: 'figurine', figure, model3d: true, animated: true, size: 1 })
        const c = window.__lab2.filmClockFor(window.__lab2.getFilmSource())
        return { total: c.totalTime(), opening: c.openingS, closing: c.closingS }
      },
      FIGURE,
    )
    console.log(variant, JSON.stringify(info))
    const t0 = info.opening + (info.total - info.opening - info.closing) * FRACTION
    const seek = (t, size) =>
      page.evaluate(
        (time, s) => {
          const { store, filmClockFor, getFilmSource, DEFAULT_MARKER } = window.__lab2
          store.getState().setSetting('marker', { ...store.getState().settings.marker, size: s })
          const c = filmClockFor(getFilmSource())
          store.getState().setProgress(c.progressAtTime(time), time)
        },
        t,
        size,
      )
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const stage = async () => page.$('[data-stage]')
    for (const [name, size] of [['film', 1.5], ['close', 6]]) {
      await seek(t0, size)
      await sleep(variant === 'b' ? 14000 : 9000)
      const el = await stage()
      await el.screenshot({ path: join(OUT, `${tag}-${FIGURE}-${name}.png`) })
      const box = await el.boundingBox()
      console.log(variant, name, 'stage', Math.round(box.width), 'x', Math.round(box.height))
    }
    // cost numbers
    stats[tag] = await page.evaluate(async () => {
      const lab = window.__lab
      if (!lab) return null
      const { root, gl } = lab
      let tris = 0, meshes = 0, skinned = 0
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return
        meshes++
        if (o.isSkinnedMesh) skinned++
        const g = o.geometry
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3
      })
      // time of frames: invalidate a few and measure the render calls
            const { labBench } = await import('/src/scene/markerLab.ts')
      const t = [labBench(gl, root, lab.camera, 40), labBench(gl, root, lab.camera, 40), labBench(gl, root, lab.camera, 40)]
      const empty = labBench(gl, null, lab.camera, 40)
      return { emptyMs: +empty.toFixed(2), tris: Math.round(tris), drawCalls: meshes, skinned, renderMs: t.map((x) => +x.toFixed(2)) }
    })
    console.log(variant, 'stats', JSON.stringify(stats[tag]))
    if (SEQ) {
      // a stride, sampled in 8 steps; cropped round the middle of the stage (the camera follows the marker)
      await seek(t0, 6)
      for (let i = 0; i < 8; i++) {
        // figureStride is a function of the film time: find one stride from the table by stepping time
        await seek(t0 + i * 0.09, 6)
        await sleep(2500)
        const el = await stage()
        const box = await el.boundingBox()
        await page.screenshot({ path: join(OUT, `${tag}-${FIGURE}-seq-${i}.png`), clip: { x: box.x + box.width / 2 - 220, y: box.y + box.height / 2 - 300, width: 440, height: 520 } })
      }
    }
    await page.close()
  }
  writeFileSync(join(OUT, `stats-${FIGURE}.json`), JSON.stringify(stats, null, 2))
} finally {
  await browser.close()
  await server.close()
}
