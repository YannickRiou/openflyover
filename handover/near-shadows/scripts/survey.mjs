// Usage: node shots.mjs <repo> <outDir> <tag>   (stills, fit numbers, frame time, burst)
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [ROOT, OUT, TAG] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
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
  executablePath: '/usr/bin/google-chrome', headless: 'shell',
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1920,1080'],
  defaultViewport: { width: 1920, height: 1080 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
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
  await page.waitForSelector('[role="group"][aria-label="Plans"]', { visible: true, timeout: 60000 })
  await page.waitForSelector('canvas', { visible: true, timeout: 60000 })
  await sleep(3000)
  console.log(await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /three|fiber/.test(n))))
  await page.evaluate(async () => {
    const appModule = await import('/src/state/store.ts')
    const src = await (await fetch('/src/scene/FlyoverCanvas.tsx')).text()
    const url = src.match(/from "([^"]*react-three_fiber[^"]*)"/)[1]
    const fiber = await import(url)
    window.__s = { app: appModule.useAppStore, scene: [...fiber._roots.values()][0].store }
  })
  const canvasShot = async (path) => {
    const el = await page.$('canvas')
    await el.screenshot({ path })
  }
  const settle = async () => {
    for (let i = 0; i < 120; i++) {
      const pending = await page.evaluate(() => window.__s.app.getState().terrainStats?.pendingVisibleTiles)
      if (pending === 0) break
      await sleep(500)
    }
    await sleep(1500)
  }
  const frame = (progress) =>
    page.evaluate(async (p) => {
      const { app, scene } = window.__s
      app.getState().setProgress(p)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      scene.getState().invalidate()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }, progress)
  const info = () =>
    page.evaluate(() => {
      const st = window.__s.scene.getState()
      let light = null
      st.scene.traverse((o) => {
        if (o.isDirectionalLight && o.castShadow) light = o
      })
      const c = st.camera
      const sh = light?.shadow
      const w = sh ? sh.camera.right - sh.camera.left : null
      const h = sh ? sh.camera.top - sh.camera.bottom : null
      return {
        cam: c.position.toArray().map((v) => Math.round(v)), dbg: globalThis.__shadowDbg,
        shadowOn: Boolean(light),
        mapSize: sh?.mapSize.x,
        width: w,
        height: h,
        texel: sh ? Math.max(w, h) / sh.mapSize.x : null,
        left: sh?.camera.left,
        bottom: sh?.camera.bottom,
      }
    })
  const SUN = Number(process.env.SUN ?? 17)
  await page.evaluate((h) => {
    const { setSetting } = window.__s.app.getState()
    setSetting('atmosphere', true)
    setSetting('shadows', true)
    setSetting('sunFromTrack', false)
    setSetting('sunHour', h)
  }, SUN)
  const cams = { ground: { distance: 0.5, pitchDeg: 20 }, close: { distance: 1, pitchDeg: 30 }, helicopter: { distance: 1.3, pitchDeg: 25 }, drone: { distance: 1.8, pitchDeg: 55 }, plane: { distance: 3, pitchDeg: 35 }, satellite: { distance: 4, pitchDeg: 85, style: 'top' } }
  const moments = [0.2, 0.5, 0.8]; if (process.env.NOSHOT) globalThis.__skip = true
  for (const [name, cam] of Object.entries(cams)) {
    await page.evaluate((cam) => {
      const { settings, setSetting } = window.__s.app.getState()
      if (cam) setSetting('camera', { ...settings.camera, ...cam })
      else setSetting('camera', { ...settings.camera, distance: 1, pitchDeg: 30 })
    }, cam)
    results[name] = []
    for (const p of moments) {
      await frame(p)
      await settle()
      await frame(p)
      await sleep(800)
      const f = `${name}-${p}-${TAG}.png`
      await canvasShot(join(OUT, f))
      const i = await info()
      results[name].push({ p, ...i })
      console.log(name, p, JSON.stringify(i))
    }
  }
  const timing = await page.evaluate(async () => {
    const { gl, scene: sc, camera } = window.__s.scene.getState()
    const px = new Uint8Array(4)
    const run = (n) => {
      const g = gl.getContext()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) gl.render(sc, camera)
      g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px)
      return (performance.now() - t0) / n
    }
    run(5)
    const runs = []
    for (let k = 0; k < 5; k++) runs.push(run(30))
    return { msPerFrame: runs }
  })
  results.timing = timing
  console.log('timing', JSON.stringify(timing))
  if (process.env.BURST) {
    await page.evaluate(() => {
      const { settings, setSetting } = window.__s.app.getState()
      setSetting('camera', { ...settings.camera, distance: 0.5, pitchDeg: 20 })
    })
    
    const dp = 1 / (30 * dur)
    results.burst = []
    for (let i = 0; i < 90; i++) {
      await frame(0.5 + i * dp)
      await sleep(i === 0 ? 3000 : 250)
      if (i === 0) await settle()
      results.burst.push(await info())
      await canvasShot(join(OUT, `burst-${TAG}-${String(i).padStart(3, '0')}.png`))
    }
    console.log('burst done', dur)
  }
  writeFileSync(join(OUT, `results-${TAG}.json`), JSON.stringify(results, null, 1))
} finally {
  await browser.close()
  await server.close()
}
