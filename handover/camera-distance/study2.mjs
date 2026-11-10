// Why the camera does not stay low: rule by rule. Usage: node study2.mjs <repo> <outDir>
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
const gpx = readFileSync(join(OUT, 'arolla.gpx'), 'utf8')
const server = await createServer({
  root: ROOT, logLevel: 'warn', cacheDir: join(ROOT, 'node_modules/.vite-study'),
  server: { host: '127.0.0.1', port: 5301, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'shell',
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VARIANTS = [
  { id: 'V2', pitchDeg: 20, distance: 0.5 },
  { id: 'V4', pitchDeg: 15, distance: 0.2579790419803647 },
  { id: 'V5', pitchDeg: 15, distance: 0.4299650699672745 },
]
const CONFIGS = [
  { id: 'base', ovr: {}, lead: 15 },
  { id: 'a', ovr: { noLos: true }, lead: 15 },
  { id: 'b', ovr: { noClear: true }, lead: 15 },
  { id: 'c', ovr: {}, lead: 0 },
  { id: 'd', ovr: { noLos: true, noClear: true }, lead: 0 },
  { id: 'e', ovr: { noAnticip: true }, lead: 15 },
  { id: 'f', ovr: { noLos: true, noClear: true, noAnticip: true }, lead: 0 },
]
const SHOTS = new Set(['V4:d', 'V5:d', 'V4:f', 'V5:f', 'V5:a', 'V5:b', 'V5:c', 'V5:e'])
const FRACTIONS = [0.15, 0.35, 0.5, 0.7, 0.9]
const results = []
try {
  const page = await browser.newPage()
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
  await page.evaluate(() => {
    window.__e2e.appStore.getState().setSetting('flyoverDurationS', 130)
    window.__e2e.appStore.getState().setPlaying(false)
  })
  await sleep(1500)
  const times = await page.evaluate((fr) => fr.map((f) => window.__study.clock.timeAtProgress(f)), FRACTIONS)
  console.log('times', times)

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

  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    await setProgress(t, 0)
    for (const v of VARIANTS) {
      for (const c of CONFIGS) {
        await page.evaluate((vv, cc) => {
          globalThis.__ovr = cc.ovr
          const st = window.__e2e.appStore.getState()
          st.setSetting('camera', { ...st.settings.camera, distance: vv.distance, pitchDeg: vv.pitchDeg, leadRoomPct: cc.lead })
        }, v, c)
        await setProgress(t, 1e-6)
        await sleep(200)
        await setProgress(t, 0)
        await settle()
        for (let n = 0; n < 8 && (await gap(t)) > 1; n++) {
          await setProgress(t, 1e-6)
          await sleep(300)
          await setProgress(t, 0)
          await settle()
        }
        const key = `${v.id}:${c.id}`
        let file = null
        if (SHOTS.has(key)) {
          file = `W-${v.id}-${c.id}-${i}.png`
          await (await page.$('canvas[data-engine^="three.js"]')).screenshot({ path: join(OUT, file) })
        }
        const m = await page.evaluate(async (tt, exag) => {
          const { path, clock, frame, engine } = window.__study
          const { filmViewAt } = await import('/src/scene/filmView.ts')
          const three = window.__study.getThree()
          const camera = three.camera
          camera.updateMatrixWorld()
          const view = filmViewAt(path, clock, clock.progressAtTime(tt), tt, frame, engine, three.size.width / three.size.height)
          const cam = camera.position
          const marker = view.marker
          const fwd = camera.getWorldDirection(new camera.position.constructor())
          const axisPitch = (-Math.asin(fwd.y) * 180) / Math.PI
          const dist = cam.distanceTo(marker)
          const at = frame.toLonLat(cam)
          const ground = engine.sampleHeight(at.lon, at.lat) * exag
          const ndc = marker.clone().project(camera)
          // line of sight camera -> marker against the terrain actually drawn (all but the last 3 % near the marker)
          let minClear = Infinity
          const p = marker.clone()
          for (let k = 0; k <= 200; k++) {
            const f = (k / 200) * 0.97
            p.lerpVectors(cam, marker, f)
            const ll = frame.toLonLat(p)
            const g = engine.sampleHeight(ll.lon, ll.lat)
            if (g === undefined) continue
            minClear = Math.min(minClear, p.y - g * exag)
          }
          return {
            dist, axisPitch,
            horizonFromTop: (25 - axisPitch) / 50,
            camToMarkerPitch: (Math.asin((cam.y - marker.y) / dist) * 180) / Math.PI,
            heightAbove: at.height - ground, camY: cam.y,
            markerY: marker.y, aimY: view.aim ? view.aim.y : null, targetY: view.target.y,
            hAboveMarker: cam.y - marker.y, hAboveAim: view.aim ? cam.y - view.aim.y : null,
            markerShareFromTop: (1 - ndc.y) / 2, markerShareX: (ndc.x + 1) / 2,
            markerInFrame: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1,
            losMinClear: minClear, hidden: minClear < 0,
            low: at.height - ground < 39, raiseM: view.raiseM ?? null,
          }
        }, t, 1)
        Object.assign(m, { variant: v.id, config: c.id, moment: i, fraction: FRACTIONS[i], timeS: t, file })
        results.push(m)
        console.log(key, FRACTIONS[i], JSON.stringify({ d: +m.dist.toFixed(0), axis: +m.axisPitch.toFixed(1), hor: +m.horizonFromTop.toFixed(2), c2m: +m.camToMarkerPitch.toFixed(1), h: +m.heightAbove.toFixed(0), mk: +m.markerShareFromTop.toFixed(2), los: +m.losMinClear.toFixed(0), hid: m.hidden, low: m.low }))
        writeFileSync(join(OUT, 'results2.json'), JSON.stringify({ times, results }, null, 1))
      }
    }
  }
} finally {
  await browser.close()
  await server.close()
}
