/**
 * Screenshots of the « Film automatique » gabarits: loads the sample, applies each gabarit and captures frames spread
 * over the film (the stage only), to judge by eye what a gabarit makes.
 *
 *   node e2e/gabarit-shots.mjs [out-dir] [reel,resume,souvenir]
 *
 * Environment: OPENFLYOVER_CHROME (default /usr/bin/google-chrome), OPENFLYOVER_SHOTS_WIDTH (page width, default 1280).
 * Writes <out-dir>/<gabarit>-<n>-<film time>.png and prints the film's total length and its stops.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.argv[2] ?? join(ROOT, 'gabarit-shots')
const IDS = (process.argv[3] ?? 'reel,resume,souvenir').split(',')
const CHROME = process.env.OPENFLYOVER_CHROME || '/usr/bin/google-chrome'
const WIDTH = Number(process.env.OPENFLYOVER_SHOTS_WIDTH ?? 1280)
if (!existsSync(CHROME)) throw new Error('Chromium introuvable : OPENFLYOVER_CHROME')
mkdirSync(OUT, { recursive: true })

async function retry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= 3) throw error
    }
  }
}

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-e2e'),
  server: { host: '127.0.0.1', port: 5380, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--lang=fr', `--window-size=${WIDTH},800`],
  defaultViewport: { width: WIDTH, height: 800 },
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(120_000)
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' })
  await (await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true })).click()
  await page.waitForSelector('canvas[data-engine^="three.js"]')
  await page.waitForSelector('[role="group"][aria-label="Plans"]')
  for (const id of IDS) {
    // a dynamic import evaluated from the test can fail once with « Promise was collected »: retried, and made once only
    await retry(() =>
      page.evaluate(async () => {
        if (window.__shots) return
        const [{ applyAutoFilm }, { getFilmSource }, { filmClockFor }, { useAppStore }] = await Promise.all([
          import('/src/ui/autoFilm.ts'),
          import('/src/scene/usePacing.ts'),
          import('/src/film/clock.ts'),
          import('/src/state/store.ts'),
        ])
        window.__shots = { applyAutoFilm, getFilmSource, filmClockFor, store: useAppStore }
      }),
    )
    // the landmarks (the stops at the passes and summits) come from OpenStreetMap: wait for them, up to two minutes
    for (let i = 0; i < 60 && !(await page.evaluate(() => (window.__shots.getFilmSource().landmarks?.length ?? 0) > 0)); i++) await new Promise((r) => setTimeout(r, 2000))
    // a vertical film needs a tall page for the stage to be as large as a horizontal one
    await page.setViewport({ width: WIDTH, height: id === 'reel' ? 1900 : 800 })
    await page.evaluate((gabarit) => window.__shots.applyAutoFilm(gabarit), id)
    const info = await page.evaluate(() => {
      const { getFilmSource, filmClockFor } = window.__shots
      const clock = filmClockFor(getFilmSource())
      return { total: clock.totalTime(), openingS: clock.openingS, closingS: clock.closingS, stops: clock.stops.map((s) => [s.holdStartS, s.holdEndS]) }
    })
    console.log(id, JSON.stringify(info))
    const { total, openingS, closingS, stops } = info
    const times = [0.3, openingS + 1.5, ...(stops[0] ? [stops[0][0] + 1.5] : []), total / 2, total - closingS - 1.5, total - 1.5]
    let n = 0
    for (const t of times) {
      await retry(() =>
        page.evaluate((time) => {
          const { getFilmSource, filmClockFor, store } = window.__shots
          const c = filmClockFor(getFilmSource())
          store.getState().setProgress(c.progressAtTime(time), time)
        }, t),
      )
      // the scene needs a few frames (tiles, terrain) to follow
      await new Promise((r) => setTimeout(r, 6000))
      const stage = await page.$('[data-stage]')
      await stage.screenshot({ path: join(OUT, `${id}-${++n}-${t.toFixed(1)}s.png`) })
    }
  }
} finally {
  await browser.close()
  await server.close()
}
