// Fifteen stills of the Arolla flight with the app's own camera. Usage: node stills.mjs <repo> <outDir> <before|after> <ground|d043>
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const MODE = process.argv[4]
const CAM = process.argv[5]
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
const gpx = readFileSync(new URL('./arolla.gpx', import.meta.url), 'utf8')
const redirectOld = {
  name: 'old-film-camera',
  enforce: 'pre',
  resolveId(source, importer) {
    if (MODE === 'before' && importer && importer.endsWith('src/scene/filmView.ts') && source === '../flyover/filmCamera') return join(ROOT, 'src/flyoverOld/filmCamera.ts')
    return null
  },
}
const server = await createServer({
  root: ROOT, logLevel: 'warn', cacheDir: join(ROOT, `node_modules/.vite-tilt-${MODE}`), plugins: [redirectOld],
  server: { host: '127.0.0.1', port: MODE === 'before' ? 5305 : 5306, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'shell',
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
  userDataDir: join(OUT, 'profile'),
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SETTINGS = { ground: { distance: 0.5, pitchDeg: 20 }, d043: { distance: 0.4299650699672745, pitchDeg: 15 } }
const FRACTIONS = Array.from({ length: 15 }, (_, i) => +(0.04 + (i * 0.92) / 14).toFixed(4))
const results = []
try {
  const page = await browser.newPage()
  const cdp = await page.createCDPSession()
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'local_storage,indexeddb,session_storage,cache_storage' })
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' })
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 120000 })
  await page.evaluate(async (text) => {
    const actions = await import('/src/ui/projectActions.ts')
    actions.importTrackFiles([new File([text], 'arolla.gpx', { type: 'application/gpx+xml' })])
  }, gpx)
  const skip = await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { visible: true, timeout: 60000 })
  await skip.click()
  await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { hidden: true, timeout: 60000 })
  await page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: 60000 })
  await page.evaluate(async () => {
    const app = await import('/src/state/store.ts')
    window.__e2e = { appStore: app.useAppStore }
  })
  await page.waitForFunction(() => window.__study?.engine && window.__study?.path, { timeout: 60000 })
  await page.evaluate((cs) => {
    const st = window.__e2e.appStore.getState()
    st.setSetting('flyoverDurationS', 130)
    st.setPlaying(false)
    st.setSetting('camera', { ...st.settings.camera, ...cs })
  }, SETTINGS[CAM])
  await sleep(1500)
  const settle = async () => {
    let last = null
    let stable = 0
    const end = Date.now() + 120000
    while (Date.now() < end) {
      await sleep(500)
      const s = await page.evaluate(() => {
        const st = window.__e2e.appStore.getState()
        const c = window.__study.getThree().camera
        return { pending: st.terrainStats.pendingVisibleTiles, loaded: st.terrainStats.loadedTiles, cam: c.position.toArray().map((x) => +x.toFixed(2)) }
      })
      const key = JSON.stringify([s.pending, s.loaded, s.cam])
      if (s.pending === 0 && key === last) stable++
      else stable = 0
      last = key
      if (stable >= 2) break
    }
  }
  const gap = (t) =>
    page.evaluate(async (tt) => {
      const { path, clock, frame, engine } = window.__study
      const { filmViewAt } = await import('/src/scene/filmView.ts')
      const three = window.__study.getThree()
      const view = filmViewAt(path, clock, clock.progressAtTime(tt), tt, frame, engine, three.size.width / three.size.height)
      return three.camera.position.distanceTo(view.position)
    }, t)
  const setProgress = (t, eps) =>
    page.evaluate((tt, e) => {
      const { clock } = window.__study
      window.__e2e.appStore.getState().setProgress(clock.progressAtTime(tt) + e, tt + (e ? 0.001 : 0))
    }, t, eps)
  const times = await page.evaluate((fr) => fr.map((f) => window.__study.clock.timeAtProgress(f)), FRACTIONS)
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    await setProgress(t, 0)
    await settle()
    for (let n = 0; n < 8 && (await gap(t)) > 1; n++) {
      await setProgress(t, 1e-6)
      await sleep(300)
      await setProgress(t, 0)
      await settle()
    }
    const file = `stills-${MODE}-${CAM}-${i}.png`
    await (await page.$('canvas[data-engine^="three.js"]')).screenshot({ path: join(OUT, file) })
    const m = await page.evaluate(() => {
      const camera = window.__study.getThree().camera
      camera.updateMatrixWorld()
      const fwd = camera.getWorldDirection(new camera.position.constructor())
      return { axisPitch: (-Math.asin(fwd.y) * 180) / Math.PI }
    })
    results.push({ i, fraction: FRACTIONS[i], timeS: t, file, ...m })
    console.log(MODE, CAM, i, FRACTIONS[i], m.axisPitch.toFixed(1))
    writeFileSync(join(OUT, `stills-${MODE}-${CAM}.json`), JSON.stringify(results, null, 1))
  }
} finally {
  await browser.close()
  await server.close()
}
