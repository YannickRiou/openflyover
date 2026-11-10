// Whole-flight measures, old rule vs new rule, same terrain. Usage: node whole.mjs <repo> <outDir> <cases e.g. arolla:ground,example:close> [rule-json] [tag]
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const CASES = process.argv[4].split(',')
const VARIANTS = { old: {}, base: {}, ...(process.argv[5] ? JSON.parse(readFileSync(process.argv[5], 'utf8')) : {}) }
const TAG = process.argv[6] || 'run'
const STEP_S = Number(process.env.STEP_S || 1.5)
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
const gpx = readFileSync(new URL('./arolla.gpx', import.meta.url), 'utf8')
const server = await createServer({
  root: ROOT, logLevel: 'warn', cacheDir: join(ROOT, 'node_modules/.vite-tilt'),
  server: { host: '127.0.0.1', port: 5304, strictPort: false, hmr: false, watch: null },
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
const SETTINGS = {
  ground: { distance: 0.5, pitchDeg: 20 },
  close: { distance: 1, pitchDeg: 30 },
  d043: { distance: 0.4299650699672745, pitchDeg: 15 },
  helicopter: { distance: 1.3, pitchDeg: 25 },
  plane: { distance: 3, pitchDeg: 35 },
  satellite: { distance: 4, pitchDeg: 85 },
}
const resultsFile = join(OUT, `whole-${TAG}.json`)
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : {}
try {
  for (const c of CASES) {
    const [track, cam] = c.split(':')
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
    if (track === 'arolla') {
      await page.evaluate(async (text) => {
        const actions = await import('/src/ui/projectActions.ts')
        actions.importTrackFiles([new File([text], 'arolla.gpx', { type: 'application/gpx+xml' })])
      }, gpx)
    } else await (await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true })).click()
    const skip = await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { visible: true, timeout: 60000 })
    await skip.click()
    await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { hidden: true, timeout: 60000 })
    await page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: 60000 })
    await page.evaluate(async () => {
      const app = await import('/src/state/store.ts')
      window.__e2e = { appStore: app.useAppStore }
    })
    await page.waitForFunction(() => window.__study?.engine && window.__study?.path, { timeout: 60000 })
    await page.evaluate((cs, arolla) => {
      const st = window.__e2e.appStore.getState()
      if (arolla) st.setSetting('flyoverDurationS', 130)
      st.setPlaying(false)
      st.setSetting('camera', { ...st.settings.camera, ...cs })
    }, SETTINGS[cam], track === 'arolla')
    await sleep(1500)
    const total = await page.evaluate(() => window.__study.clock.totalTime())
    const settle = async () => {
      let last = null
      let stable = 0
      const end = Date.now() + 90000
      while (Date.now() < end) {
        await sleep(300)
        const s = await page.evaluate(() => {
          const st = window.__e2e.appStore.getState()
          const cc = window.__study.getThree().camera
          return { pending: st.terrainStats.pendingVisibleTiles, loaded: st.terrainStats.loadedTiles, cam: cc.position.toArray().map((x) => +x.toFixed(1)) }
        })
        const key = JSON.stringify([s.pending, s.loaded, s.cam])
        if (s.pending === 0 && key === last) stable++
        else stable = 0
        last = key
        if (stable >= 2) break
      }
    }
    // sweep the film so the terrain around every shot is loaded
    const t0 = Date.now()
    for (let t = 0; t <= total + 1e-6; t += STEP_S) {
      await page.evaluate((tt) => {
        const { clock } = window.__study
        window.__e2e.appStore.getState().setProgress(clock.progressAtTime(tt), tt)
      }, Math.min(t, total))
      await settle()
    }
    console.log(c, 'swept', total.toFixed(0), 's film in', ((Date.now() - t0) / 1000).toFixed(0), 's')
    const out = await page.evaluate(async (variants) => {
      const { engine, path, clock, frame, follow } = window.__study
      const filmView = await import('/src/scene/filmView.ts')
      const lab = await import('/src/scene/labelModel.ts')
      const mods = {}
      for (const [id, dir] of [['old', 'flyoverOld'], ['new', 'flyover']]) {
        mods[id] = { cam: await import(`/src/${dir}/filmCamera.ts`), audit: await import(`/src/${dir}/filmAudit.ts`) }
      }
      const three = window.__study.getThree()
      const aspect = three.size.width / three.size.height
      const base = filmView.__viewInputs(engine, aspect, follow)
      const exag = base.options.exaggeration
      const asked = base.options.camera.pitchDeg
      const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null }
      const fps = 30
      const result = {}
      for (const id of Object.keys(variants)) {
        globalThis.__rule = variants[id]
        const m = id === 'old' ? mods.old : mods.new
        const sampler = (lon, lat) => engine.sampleHeight(lon, lat)
        const options = { ...base.options, terrainVersion: 0, pins: undefined }
        if (variants[id].lead !== undefined) options.camera = { ...base.options.camera, leadRoomPct: variants[id].lead }
        const hiddenTimes = []
        const gaps = [], hiddenMin = [], dense = []
        let unknown = 0, frames = 0, hiddenApp = 0, hiddenDense = 0, camMin = Infinity, flightFrames = 0
        const series = []
        const clearanceAtFactory = () => {
          let unk = 0
          const f = (x, y, z) => {
            const p = frame.toLonLat({ x, y, z })
            const g = sampler(p.lon, p.lat)
            if (g === undefined) { unk++; return undefined }
            return p.height - g * exag
          }
          f.unk = () => unk
          return f
        }
        for (let i = 0, n = Math.floor(clock.totalTime() * fps) + 1; i < n; i++) {
          const t = i / fps
          const v = m.cam.computeFilmView(path, clock, t, clock.progressAtTime(t), frame, sampler, options)
          const dir = { x: v.target.x - v.position.x, y: v.target.y - v.position.y, z: v.target.z - v.position.z }
          const len = Math.hypot(dir.x, dir.y, dir.z)
          const pitch = (Math.asin(-dir.y / len) * 180) / Math.PI
          const inFlight = t >= clock.openingS && t <= clock.openingS + clock.flightS
          const ca = clearanceAtFactory()
          const clr = lab.lineOfSightClearance(v.position, v.marker, ca)
          let dmin = Infinity
          for (let k = 0; k <= 300; k++) {
            const f = (k / 300) * 0.97
            const c = ca(v.position.x + (v.marker.x - v.position.x) * f, v.position.y + (v.marker.y - v.position.y) * f, v.position.z + (v.marker.z - v.position.z) * f)
            if (c !== undefined) dmin = Math.min(dmin, c)
          }
          const at = frame.toLonLat(v.position)
          const g = sampler(at.lon, at.lat)
          frames++
          if (g === undefined || ca.unk() > 0) unknown++
          if (g !== undefined) camMin = Math.min(camMin, at.height - g * exag)
          if (inFlight) {
            flightFrames++
            gaps.push(pitch - asked)
            if (clr < 0) { hiddenApp++; hiddenTimes.push(+t.toFixed(2)) }
            if (dmin < 0) hiddenDense++
            hiddenMin.push(clr)
            dense.push(dmin)
          }
          if (i % 6 === 0) series.push([+t.toFixed(2), +pitch.toFixed(1), +(at.height - (g ?? 0) * exag).toFixed(0)])
        }
        const issues = m.audit.auditFilmCamera(path, clock, frame, sampler, options)
        const by = {}
        for (const s of issues) { by[s.kind] ??= { n: 0, worst: 0 }; by[s.kind].n++; by[s.kind].worst = Math.max(by[s.kind].worst, s.worst) }
        const abs = gaps.map(Math.abs)
        result[id] = {
          asked, flightFrames, frames, unknownFrames: unknown,
          gapSigned: { median: pct(gaps, 0.5), p90: pct(gaps, 0.9), max: Math.max(...gaps), min: Math.min(...gaps) },
          gapAbs: { median: pct(abs, 0.5), p90: pct(abs, 0.9), max: Math.max(...abs) },
          hiddenApp, hiddenDense, minLineClearanceApp: Math.min(...hiddenMin), minLineClearanceDense: Math.min(...dense),
          cameraMinClearance: camMin, audit: by, hiddenTimes, issues: issues.length, series,
        }
      }
      // frame-wise lower bound: the smallest raise of the unlifted camera for the app's visibility check to give `margin`
      globalThis.__rule = { noLos: 1, noAnticip: 1 }
      {
        const sampler = (lon, lat) => engine.sampleHeight(lon, lat)
        const options = { ...base.options, terrainVersion: 0, pins: undefined }
        const ca = (x, y, z) => { const p = frame.toLonLat({ x, y, z }); const g = sampler(p.lon, p.lat); return g === undefined ? undefined : p.height - g * exag }
        const ideal = { 0: [], 5: [], 10: [] }
        const free = []
        for (let i = 0, n = Math.floor(clock.totalTime() * fps) + 1; i < n; i += 2) {
          const t = i / fps
          if (!(t >= clock.openingS && t <= clock.openingS + clock.flightS)) continue
          const v = mods.new.cam.computeFilmView(path, clock, t, clock.progressAtTime(t), frame, sampler, options)
          const pitchAt = (dy) => { const dx = v.target.x - v.position.x, dz = v.target.z - v.position.z, h = v.target.y - (v.position.y + dy); return (Math.atan2(-h, Math.hypot(dx, dz)) * 180) / Math.PI }
          free.push(pitchAt(0) - asked)
          for (const margin of [0, 5, 10]) {
            const ok = (dy) => lab.lineOfSightClearance({ x: v.position.x, y: v.position.y + dy, z: v.position.z }, v.marker, ca) >= margin
            let lo = 0, hi = 0
            if (!ok(0)) { hi = 20; while (!ok(hi) && hi < 5000) hi *= 2; lo = hi / 2; for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid } } 
            ideal[margin].push(pitchAt(hi) - asked)
          }
        }
        result.ideal = {}
        for (const m of [0, 5, 10]) result.ideal[m] = { median: pct(ideal[m], 0.5), p90: pct(ideal[m], 0.9), max: Math.max(...ideal[m]), n: ideal[m].length }
        result.free = { median: pct(free, 0.5), p90: pct(free, 0.9), max: Math.max(...free) }
      }
      globalThis.__rule = {}
      return result
    }, VARIANTS)
    results[c] = out
    console.log(c, JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...v, series: undefined }]))))
    writeFileSync(resultsFile, JSON.stringify(results, null, 1))
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
