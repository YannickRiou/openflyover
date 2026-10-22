/**
 * Screenshots of « Photos sur le terrain » (prototype): loads the sample, puts three generated photos on the timeline and
 * captures a wide view, the approach to a pin, the moment the photo plays, and the view after; plus one frame at 9:16.
 *
 *   node e2e/photo-pins-shots.mjs [out-dir]
 *
 * Environment: OPENFLYOVER_CHROME (default: the Playwright headless shell, as e2e/run.mjs), OPENFLYOVER_SHOTS_WIDTH (page width, default 1280).
 * Writes <out-dir>/<n>-<name>.png: the stage only, about 1280 px wide (the page is rendered at 1.69× its CSS size).
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.argv[2] ?? join(ROOT, 'photo-pins-shots')
// the same browser as e2e/run.mjs
const DEFAULT_CHROME = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell')
const CHROME = process.env.OPENFLYOVER_CHROME || (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : '')
const WIDTH = Number(process.env.OPENFLYOVER_SHOTS_WIDTH ?? 1280)
if (!CHROME) throw new Error('Chromium introuvable : OPENFLYOVER_CHROME')
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-e2e'),
  server: { host: '127.0.0.1', port: 5381, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox', '--lang=fr', `--window-size=${WIDTH},800`],
  defaultViewport: { width: WIDTH, height: 800, deviceScaleFactor: 1.69 },
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(120_000)
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' })
  await (await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true })).click()
  await page.waitForSelector('canvas[data-engine^="three.js"]')
  await page.waitForSelector('[role="group"][aria-label="Plans"]')
  await wait(8000)
  // the toast of the import would hide the bottom of the frames
  await page.evaluate(async () => {
    const { dismissToast, useToastStore } = await import('/src/ui/toast.ts')
    for (const toast of useToastStore.getState().toasts) dismissToast(toast.id)
  })
  const info = await page.evaluate(async () => {
    const [{ readMedia }, { useMediaStore }, { addMedia }, { getFilmSource }, { filmClockFor }, { useAppStore }] = await Promise.all([
      import('/src/film/video.ts'),
      import('/src/film/media.ts'),
      import('/src/film/timeline.ts'),
      import('/src/scene/usePacing.ts'),
      import('/src/film/clock.ts'),
      import('/src/state/store.ts'),
    ])
    window.__shots = { getFilmSource, filmClockFor, store: useAppStore }
    const make = async (word, color) => {
      const c = document.createElement('canvas')
      c.width = 1600
      c.height = 1200
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 1600, 1200)
      grad.addColorStop(0, color)
      grad.addColorStop(1, '#113B54')
      g.fillStyle = grad
      g.fillRect(0, 0, 1600, 1200)
      g.fillStyle = 'rgba(255,255,255,0.25)'
      g.beginPath()
      g.arc(1200, 300, 200, 0, 7)
      g.fill()
      g.fillStyle = '#fff'
      g.font = 'bold 330px sans-serif'
      g.textAlign = 'center'
      g.fillText(word, 800, 720)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      return new File([blob], `${word}.jpg`, { type: 'image/jpeg' })
    }
    const files = [await make('LAC', '#E2813C'), await make('COL', '#2E8B57'), await make('SOMMET', '#C0392B')]
    const read = []
    for (const f of files) read.push(await readMedia(f, f.name))
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const store = useAppStore.getState()
    const clock0 = filmClockFor(getFilmSource())
    const total = clock0.totalTime()
    const span = total - clock0.openingS - clock0.closingS
    const times = [0.15, 0.5, 0.85].map((k) => Math.round((clock0.openingS + span * k) * 10) / 10)
    const added = addMedia(store.settings.film, 0, srcs.map((src) => ({ src })))
    const film = { ...added.film, media: added.film.media.map((m, i) => ({ ...m, startS: times[i], durationS: 6, layout: 'carte' })) }
    store.setSetting('film', film)
    return { total, times, openingS: clock0.openingS }
  })
  console.log(JSON.stringify(info))
  const goto = async (t) => {
    await page.evaluate((time) => {
      const { getFilmSource, filmClockFor, store } = window.__shots
      const c = filmClockFor(getFilmSource())
      store.getState().setProgress(c.progressAtTime(time), time)
    }, t)
    await wait(7000)
  }
  const shot = async (name) => {
    const stage = await page.$('[data-stage]')
    await stage.screenshot({ path: join(OUT, name) })
    console.log('shot', name)
  }
  const [t1, t2] = info.times
  // wide: the whole outing seen from above (fit view), paused at the start
  await goto(info.openingS + 0.5)
  await page.evaluate(() => window.__shots.store.getState().requestFit())
  await wait(5000)
  await shot('1-large.png')
  await goto(t2 - 5)
  await shot('2-approche.png')
  await page.evaluate(() => { const st = window.__shots.store.getState(); st.setSetting('labels', { ...st.settings.labels, photoPins: false }) })
  await wait(3000)
  await shot('2b-approche-reglage-coupe.png')
  await page.evaluate(() => { const st = window.__shots.store.getState(); st.setSetting('labels', { ...st.settings.labels, photoPins: true }) })
  await goto(t2 + 2)
  await shot('3-photo-sur-ecran.png')
  await goto(t2 + 6 + 8)
  await shot('4-apres.png')
  await goto(t1 + 2)
  await shot('5-photo-1.png')
  // 9:16
  await page.setViewport({ width: WIDTH, height: 1900, deviceScaleFactor: 0.82 })
  await page.evaluate(() => { const st = window.__shots.store.getState(); st.setSetting('video', { ...st.settings.video, aspect: '9:16' }); st.setFreeFraming(false) })
  await wait(2000)
  await goto(t2 + 2)
  await shot('6-vertical-9-16.png')
} finally {
  await browser.close()
  await server.close()
}
