// Camera distance study. Usage: node study.mjs <repo> <outDir> [probe]
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const PROBE = process.argv[4] === 'probe'
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
mkdirSync(OUT, { recursive: true })
const gpx = readFileSync(join(OUT, 'arolla.gpx'), 'utf8')

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-study'),
  server: { host: '127.0.0.1', port: 5301, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'shell',
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  // stores + scene
  await page.evaluate(async () => {
    const app = await import('/src/state/store.ts')
    window.__e2e = { appStore: app.useAppStore }
  })
  await page.waitForFunction(() => window.__study?.engine && window.__study?.path, { timeout: 60000 })
  await page.evaluate(() => {
    const s = window.__e2e.appStore.getState()
    s.setSetting('flyoverDurationS', 130)
    window.__e2e.appStore.getState().setPlaying(false)
  })
  await sleep(1500)
  const info = await page.evaluate(() => {
    const { path, clock } = window.__study
    const st = window.__e2e.appStore.getState()
    return {
      lengthM: path.lengthM,
      openingS: clock.openingS,
      flightS: clock.flightS,
      total: clock.totalTime(),
      settings: { camera: st.settings.camera, atmosphere: st.settings.atmosphere, exaggeration: st.settings.exaggeration, duration: st.settings.flyoverDurationS },
      tracks: st.tracks.length,
      days: st.tracks.map((t) => t.segments?.length),
    }
  })
  console.log(JSON.stringify(info))
  const canvasBox = await (await page.$('canvas[data-engine^="three.js"]')).boundingBox()
  console.log('canvas', JSON.stringify(canvasBox))
  await page.screenshot({ path: join(OUT, 'probe-ui.png') })
  if (PROBE) throw new Error('probe done')

  // ---- variants -----------------------------------------------------------------------------------------------------
  const auto = Math.min(4000, Math.max(600, info.lengthM * 0.04))
  console.log('autoDistanceM', auto)
  const VARIANTS = [
    { id: 'V1', name: 'V1 Proche today', distance: 1, pitchDeg: 30 },
    { id: 'V2', name: 'V2 Au ras today', distance: 0.5, pitchDeg: 20 },
    { id: 'V3', name: 'V3 fixed 300 m', metres: 300, pitchDeg: 20 },
    { id: 'V4', name: 'V4 fixed 600 m', metres: 600, pitchDeg: 15 },
    { id: 'V5', name: 'V5 fixed 1000 m', metres: 1000, pitchDeg: 15 },
  ]
  const FRACTIONS = [0.15, 0.35, 0.5, 0.7, 0.9]
  // film time of the flyover fraction (flight time, nights and stops included in the clock)
  const times = await page.evaluate((fr, ) => {
    const { clock } = window.__study
    return fr.map((f) => clock.timeAtProgress(f))
  }, FRACTIONS)
  console.log('times', times)
  for (const v of VARIANTS) {
    const distance = v.distance ?? v.metres / auto
    const ok = distance >= 0.3 && distance <= 4
    console.log(v.id, 'camera.distance', distance, ok ? '(in range)' : '(OUT OF RANGE)')
    const rec = { id: v.id, name: v.name, setDistance: distance, pitchAsked: v.pitchDeg, moments: [] }
    await page.evaluate((d, p) => {
      const st = window.__e2e.appStore.getState()
      st.setSetting('camera', { ...st.settings.camera, distance: d, pitchDeg: p })
    }, distance, v.pitchDeg)
    for (let i = 0; i < times.length; i++) {
      const t = times[i]
      await page.evaluate((tt) => {
        const { clock } = window.__study
        window.__e2e.appStore.getState().setProgress(clock.progressAtTime(tt), tt)
      }, t)
      // wait for tiles to settle and the view to stay put; the preview camera is only re-placed when the progress changes, not
      // when tiles arrive, so it is nudged until it sits where the settled terrain puts it (what an export would render)
      const settle = async () => {
        let last = null
        let stable = 0
        const end = Date.now() + 120000
        while (Date.now() < end) {
          await sleep(700)
          const s = await page.evaluate(() => {
            const st = window.__e2e.appStore.getState()
            const c = window.__study.getThree().camera
            return { pending: st.terrainStats.pendingVisibleTiles, loaded: st.terrainStats.loadedTiles, cam: c.position.toArray().map((x) => +x.toFixed(2)) }
          })
          const key = JSON.stringify([s.pending, s.loaded, s.cam])
          if (s.pending === 0 && key === last) stable++
          else stable = 0
          last = key
          if (stable >= 3) break
        }
      }
      const gap = () =>
        page.evaluate(async (tt) => {
          const { path, clock, frame, engine } = window.__study
          const { filmViewAt } = await import('/src/scene/filmView.ts')
          const three = window.__study.getThree()
          const view = filmViewAt(path, clock, clock.progressAtTime(tt), tt, frame, engine, three.size.width / three.size.height)
          return three.camera.position.distanceTo(view.position)
        }, t)
      await settle()
      for (let n = 0; n < 8 && (await gap()) > 1; n++) {
        await page.evaluate((tt) => {
          const { clock } = window.__study
          const st = window.__e2e.appStore.getState()
          st.setProgress(clock.progressAtTime(tt) + 1e-6, tt + 0.001)
        }, t)
        await sleep(300)
        await page.evaluate((tt) => {
          const { clock } = window.__study
          window.__e2e.appStore.getState().setProgress(clock.progressAtTime(tt), tt)
        }, t)
        await settle()
      }
      const file = `${v.id}-${i}.png`
      const el = await page.$('canvas[data-engine^="three.js"]')
      await el.screenshot({ path: join(OUT, file) })
      const m = await page.evaluate(
        async (tt, exag) => {
          const { path, clock, frame, engine } = window.__study
          const { filmViewAt } = await import('/src/scene/filmView.ts')
          const st = window.__e2e.appStore.getState()
          const three = window.__study.getThree()
          const cam = three.camera.position
          const aspect = three.size.width / three.size.height
          const view = filmViewAt(path, clock, clock.progressAtTime(tt), tt, frame, engine, aspect)
          const marker = view.marker
          const dist = cam.distanceTo(marker)
          const at = frame.toLonLat(cam)
          const groundUnder = engine.sampleHeight(at.lon, at.lat) * exag
          const heightAbove = at.height - groundUnder
          const pitch = (Math.asin((cam.y - marker.y) / dist) * 180) / Math.PI
          // horizontal / slant
          const hor = Math.hypot(cam.x - marker.x, cam.z - marker.z)
          // ground speed (m per film s) by central difference of the film's own progress
          const h = 0.25
          const speed = (path.lengthM * (clock.progressAtTime(tt + h) - clock.progressAtTime(tt - h))) / (2 * h)
          const frameM = 2 * dist * Math.tan((25 * Math.PI) / 180)
          return {
            camPos: cam.toArray(), canvas: [three.size.width, three.size.height], aspect,
            engineVsView: Math.hypot(cam.x - view.position.x, cam.y - view.position.y, cam.z - view.position.z),
            dist, horizM: hor, heightAbove, heightAboveMarker: cam.y - marker.y, pitch, raiseM: view.raiseM, speed, frameM, framesPerS: speed / frameM,
            progress: clock.progressAtTime(tt), state: clock.stateAt(tt).phase, pending: st.terrainStats.pendingVisibleTiles,
          }
        },
        t, info.settings.exaggeration,
      )
      m.timeS = t
      m.fraction = FRACTIONS[i]
      m.file = file
      rec.moments.push(m)
      console.log(v.id, FRACTIONS[i], JSON.stringify({ d: +m.dist.toFixed(0), h: +m.heightAbove.toFixed(0), pitch: +m.pitch.toFixed(1), raise: +m.raiseM.toFixed(0), spd: +m.speed.toFixed(0), fps: +m.framesPerS.toFixed(2), dv: +m.engineVsView.toFixed(2), pend: m.pending }))
    }
    // audit with the app's terrain sampler: windows of +-3 s at each moment (tiles loaded around the camera at that moment)
    rec.audit = await page.evaluate(async (ts) => {
      const { path, clock, frame, engine } = window.__study
      const { auditFilmCamera } = await import('/src/flyover/filmAudit.ts')
      const { LINE_LIFT_M } = await import('/src/scene/trackLineSet.ts')
      const { filmFollow } = await import('/src/scene/filmView.ts')
      const st = window.__e2e.appStore.getState()
      const sampler = (lon, lat) => engine.sampleHeight(lon, lat)
      const options = {
        exaggeration: st.settings.exaggeration, liftM: LINE_LIFT_M, camera: st.settings.camera, durationS: st.settings.flyoverDurationS,
        aspect: 16 / 9, region: null, follow: filmFollow(st.tracks, st.settings.race, st.settings.trackStyle.smoothingM),
      }
      const windows = ts.map((t) => auditFilmCamera(path, clock, frame, sampler, options, { fromS: t - 3, toS: t + 3 }))
      const whole = auditFilmCamera(path, clock, frame, sampler, options, { fromS: clock.openingS, toS: clock.openingS + clock.flightS })
      return { windows, whole }
    }, times)
    console.log(v.id, 'audit windows', JSON.stringify(rec.audit.windows.map((w) => w.length)), 'whole', rec.audit.whole.length)
    results.push(rec)
    writeFileSync(join(OUT, 'results.json'), JSON.stringify({ info, auto, times, results }, null, 1))
  }
} finally {
  await browser.close()
  await server.close()
}
