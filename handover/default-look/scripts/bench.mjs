// Usage: node bench.mjs <repo> <outdir> <stills|perf|both> [reps]   (real GPU; stills mode here has the blank-frame issue with the atmosphere off, prefer run-stills.sh)
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const MODE = process.argv[4] ?? 'both'
const REPS = Number(process.argv[5] ?? 2)
mkdirSync(OUT, { recursive: true })
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-look'),
  server: { host: '127.0.0.1', port: 5303, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'shell',
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  defaultViewport: { width: 1920, height: 1080 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = { stills: [], perf: [] }
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' })
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const sample = await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 120000 })
  await sample.click()
  const skip = await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { visible: true, timeout: 60000 })
  await skip.click()
  await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { hidden: true, timeout: 60000 })
  await page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: 60000 })
  await page.evaluate(async () => {
    const [app, exp, hist, probe] = await Promise.all([
      import('/src/state/store.ts'),
      import('/src/export/store.ts'),
      import('/src/export/historyStore.ts'),
      import('/src/scene/perfProbe.ts'),
    ])
    window.__b = { app: app.useAppStore, exp: exp.useExportStore, hist: hist.useExportHistory, probe }
  })
  const settled = async () => {
    for (let i = 0; i < 120; i++) {
      const s = await page.evaluate(() => window.__b.app.getState().terrainStats)
      if (s.pendingTiles === 0 && s.loadedTiles > 0) { await sleep(1500); const s2 = await page.evaluate(() => window.__b.app.getState().terrainStats); if (s2.pendingTiles === 0) return }
      await sleep(500)
    }
  }
  await settled()
  const initial = await page.evaluate(() => {
    const s = window.__b.app.getState().settings
    return { grading: s.grading, glow: [s.trackStyle.glow, s.trackStyle.glowIntensity, s.trackStyle.glowWidth, s.trackStyle.width], atmosphere: s.atmosphere, clouds: s.clouds.mode, bloom: s.lens.bloom, track: s.trackColorBy }
  })
  console.log('initial', JSON.stringify(initial))
  const NATUREL = { preset: 'naturel', contrast: 0, saturation: 0, warmth: 0, vignette: 0 }
  const variants = []
  for (const atmosphere of [true, false]) for (const look of ['after', 'before']) variants.push({ atmosphere, look, name: `${look}-${atmosphere ? 'atm' : 'noatm'}` })
  const apply = async ({ atmosphere, look }, extra = {}) => {
    await page.evaluate(
      (atmosphere, look, NATUREL, initial, extra) => {
        const { app } = window.__b
        const st = app.getState()
        st.setSetting('atmosphere', atmosphere)
        const ts = st.settings.trackStyle
        if (look === 'before') {
          st.setSetting('grading', NATUREL)
          st.setSetting('trackStyle', { ...ts, glow: false })
        } else {
          st.setSetting('grading', initial.grading)
          st.setSetting('trackStyle', { ...ts, glow: true })
        }
        if (extra.bloom !== undefined) st.setSetting('lens', { ...app.getState().settings.lens, bloom: extra.bloom })
      },
      atmosphere, look, NATUREL, initial, extra,
    )
    await sleep(1500)
    await settled()
  }
  const canvasClip = async () => (await (await page.$('canvas[data-engine^="three.js"]')).boundingBox())
  const measurePreview = async (seconds = 8) => {
    await page.evaluate(() => { window.__b.app.getState().setProgress(0.02, null) })
    await sleep(1000)
    const r = await page.evaluate(async (seconds) => {
      const { app, probe } = window.__b
      const times = []
      const stop = probe.getPerfProbe().onFrame(() => times.push(performance.now()))
      app.getState().setPlaying(true)
      await new Promise((res) => setTimeout(res, 1500))
      times.length = 0
      await new Promise((res) => setTimeout(res, seconds * 1000))
      stop()
      app.getState().setPlaying(false)
      const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b)
      return { frames: times.length, fps: times.length / seconds, p50: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], mean: d.reduce((a, b) => a + b, 0) / d.length }
    }, seconds)
    return r
  }
  const measureExport = async () => {
    await page.evaluate(() => { window.__b.exp.getState().reset(); window.__b.app.getState().setProgress(0, null) })
    await sleep(500)
    const t0 = Date.now()
    await page.evaluate(() => {
      window.__b.exp.getState().start({ width: 1280, height: 720, fps: 10, quality: 'standard', durationS: 3, holdStartS: 0, holdEndS: 0, baseName: 'look-bench' })
    })
    for (let i = 0; i < 1200; i++) {
      const phase = await page.evaluate(() => window.__b.exp.getState().phase)
      if (phase === 'done' || phase === 'error' || phase === 'canceled') break
      await sleep(250)
    }
    const wall = Date.now() - t0
    const e = await page.evaluate(() => ({ phase: window.__b.exp.getState().phase, entry: window.__b.hist.getState().entries[0] }))
    return { phase: e.phase, wallMs: e.entry?.wallMs, frames: e.entry?.frames, wallOuter: wall }
  }
  if (MODE === 'stills' || MODE === 'both') {
    for (const v of variants) {
      await apply(v)
      for (const [i, p] of [0.08, 0.5, 0.92].entries()) {
        await page.evaluate((p) => window.__b.app.getState().setProgress(p, null), p)
        await sleep(2500)
        await settled()
        await sleep(1000)
        // a last nudge draws a fresh frame (the canvas keeps no buffer: a screenshot of a sleeping scene can be blank)
        for (let k = 0; k < 3; k++) {
          await page.evaluate((p, k) => window.__b.app.getState().setProgress(p + (k + 1) * 1e-6, null), p, k)
          await sleep(700)
        }
        const file = join(OUT, `${v.name}-${i + 1}.png`)
        await page.screenshot({ path: file, clip: await canvasClip() })
      }
      console.log('stills', v.name)
    }
  }
  if (MODE === 'perf' || MODE === 'both') {
    for (let rep = 0; rep < REPS; rep++) {
      for (const v of variants) {
        await apply(v)
        const preview = await measurePreview()
        const exp = await measureExport()
        const row = { rep, variant: v.name, preview, exp }
        results.perf.push(row)
        console.log(JSON.stringify(row))
      }
    }
    // bloom at a moderate value, look = after, both atmosphere states
    for (const atmosphere of [true, false]) {
      for (const bloom of [0, 0.3]) {
        await apply({ atmosphere, look: 'after' }, { bloom })
        const preview = await measurePreview()
        const exp = await measureExport()
        const row = { variant: `bloom-${bloom}-${atmosphere ? 'atm' : 'noatm'}`, preview, exp }
        results.perf.push(row)
        console.log(JSON.stringify(row))
      }
    }
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
} finally {
  await browser.close()
  await server.close()
}
