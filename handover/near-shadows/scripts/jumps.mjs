// Shadow-distance inputs over whole flights. Usage: node jumps.mjs <repo> <outFile> [flights]
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [ROOT, OUTFILE, ONLY] = process.argv.slice(2)
const GPX = readFileSync('' + (process.env.AROLLA_GPX ?? 'arolla.gpx') + '', 'utf8')
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
const server = await createServer({
  root: ROOT, logLevel: 'warn', cacheDir: join(ROOT, 'node_modules/.vite-shadows'),
  server: { host: '127.0.0.1', port: 5302, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'shell', protocolTimeout: 3600000,
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FLIGHTS = [
  { id: 'example-ground', track: 'example', cam: { distance: 0.5, pitchDeg: 20 } },
  { id: 'example-close', track: 'example', cam: { distance: 1, pitchDeg: 30 } },
  { id: 'arolla-ground', track: 'arolla', cam: { distance: 0.5, pitchDeg: 20 } },
].filter((f) => !ONLY || ONLY.split(',').includes(f.id))
const out = {}
try {
  for (const flight of FLIGHTS) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('pageerror', e.message))
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' })
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
    })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (flight.track === 'example') {
      const sample = await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 120000 })
      await sample.click()
    } else {
      await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 120000 })
      await page.evaluate(async (text) => {
        const actions = await import('/src/ui/projectActions.ts')
        actions.importTrackFiles([new File([text], 'arolla.gpx', { type: 'application/gpx+xml' })])
      }, GPX)
    }
    const skip = await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { visible: true, timeout: 60000 })
    await skip.click()
    await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { hidden: true, timeout: 60000 })
    await page.waitForSelector('canvas', { visible: true, timeout: 60000 })
    await sleep(3000)
    await page.evaluate(async () => {
      const appModule = await import('/src/state/store.ts')
      const src = await (await fetch('/src/scene/FlyoverCanvas.tsx')).text()
      const fiber = await import(src.match(/from "([^"]*react-three_fiber[^"]*)"/)[1])
      window.__s = { app: appModule.useAppStore, scene: [...fiber._roots.values()][0].store }
      window.__shadowMod = await import('/src/scene/terrainShadow.ts')
    })
    await page.evaluate((cam) => {
      const { settings, setSetting, setPlaying } = window.__s.app.getState()
      setSetting('atmosphere', true); setSetting('shadows', true); setSetting('flyoverDurationS', 60)
      setSetting('camera', { ...settings.camera, ...cam })
      setPlaying(false)
    }, flight.cam)
    await sleep(4000)
    const data = await page.evaluate(async () => {
      const { app, scene } = window.__s
      const { groundDistance, shadowDistance } = window.__shadowMod
      const T = scene.getState().camera.position.constructor
      const groundUnder = globalThis.__groundUnder
      if (!groundUnder) return { error: 'no groundUnder' }
      const rad = (d) => (d * Math.PI) / 180
      const march = (eye, dir, maxM) => groundDistance(eye, dir, groundUnder, maxM)
      const N = 1800
      const rows = []
      const eye = new T(), fwd = new T(), right = new T(), up = new T(), dir = new T(), p = new T()
      for (let i = 0; i <= N; i++) {
        app.getState().setProgress(i / N)
        scene.getState().invalidate()
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        for (let k = 0; k < 20 && app.getState().terrainStats?.pendingVisibleTiles > 0; k++) await new Promise((r) => setTimeout(r, 100))
        const c = scene.getState().camera
        c.getWorldPosition(eye); c.getWorldDirection(fwd)
        const row = { i }
        const poses = {
          real: { eye: eye.clone(), fwd: fwd.clone() },
        }
        // the coming camera, emulated: same place, a low 250 m over the ground under it, axis 15 degrees below the heading
        const heading = new T(fwd.x, 0, fwd.z).normalize()
        const g = groundUnder(eye)
        const e15 = eye.clone()
        if (g !== undefined) e15.y = g + 250
        poses.low15 = { eye: e15, fwd: new T(heading.x * Math.cos(rad(15)), -Math.sin(rad(15)), heading.z * Math.cos(rad(15))) }
        for (const [name, { eye: e, fwd: f }] of Object.entries(poses)) {
          const A = march(e, f, 2000)
          // height over the ground under the camera, with the tilt
          const gg = groundUnder(e)
          const h = gg === undefined ? Infinity : Math.max(0, e.y - gg)
          const sinp = Math.max(1e-3, -f.y)
          const B = f.y < 0 ? h / sinp : Infinity
          // rays over the lower half of the frame
          right.crossVectors(f, new T(0, 1, 0)).normalize(); up.crossVectors(right, f).normalize()
          const hits = []
          for (const az of [-30, -15, 0, 15, 30]) for (const el of [0, -6, -12, -18, -24]) {
            dir.copy(f).addScaledVector(right, Math.tan(rad(az))).addScaledVector(up, Math.tan(rad(el))).normalize()
            hits.push(march(e, dir, 2000))
          }
          hits.sort((a, b) => a - b)
          const C25 = hits[Math.floor(hits.length * 0.25)], C50 = hits[Math.floor(hits.length * 0.5)]
          const D = (aim) => shadowDistance(5000, 0, aim)
          row[name] = { h, pitch: Math.asin(Math.min(1, Math.max(-1, f.y))) * 180 / Math.PI, A: D(A), B: D(B), C25: D(C25), C50: D(C50), aimA: A, aimB: B }
        }
        rows.push(row)
      }
      return { rows }
    })
    out[flight.id] = data
    console.log(flight.id, data.error ?? data.rows.length)
    await page.close()
    await ctx.close()
    writeFileSync(OUTFILE, JSON.stringify(out))
  }
  writeFileSync(OUTFILE, JSON.stringify(out))
} finally {
  await browser.close()
  await server.close()
}
