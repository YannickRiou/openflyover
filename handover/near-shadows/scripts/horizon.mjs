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
        cam: c.position.toArray().map((v) => Math.round(v)),
        shadowOn: Boolean(light),
        mapSize: sh?.mapSize.x,
        width: w,
        height: h,
        texel: sh ? Math.max(w, h) / sh.mapSize.x : null,
        left: sh?.camera.left,
        bottom: sh?.camera.bottom,
      }
    })

  const PLACES = (process.env.PLACES ?? '0.15,0.45,0.75').split(',').map(Number)
  const PITCHES = (process.env.PITCHES ?? '15,20').split(',').map(Number)
  const SUNS = (process.env.SUNS ?? '8,12,17').split(',').map(Number)
  await page.evaluate(() => {
    const { setSetting } = window.__s.app.getState()
    setSetting('atmosphere', true); setSetting('shadows', true); setSetting('sunFromTrack', false)
  })
  results.views = []
  for (const p of PLACES) {
    await page.evaluate(() => { const { settings, setSetting } = window.__s.app.getState(); setSetting('camera', { ...settings.camera, distance: 1, pitchDeg: 30, style: 'chase' }) })
    await frame(p); await settle(); await frame(p); await sleep(500)
    const base = await page.evaluate(() => {
      const c = window.__s.scene.getState().camera
      const d = c.getWorldDirection(new c.position.constructor())
      return { eye: c.position.toArray(), dir: d.toArray() }
    })
    await page.evaluate(() => { const { settings, setSetting } = window.__s.app.getState(); setSetting('camera', { ...settings.camera, style: 'free' }) })
    await sleep(800)
    for (const pitch of PITCHES) {
      const setPose = () => page.evaluate(async ({ base, pitch }) => {
        const st = window.__s.scene.getState()
        const c = st.camera
        const V = c.position.constructor
        const h = new V(base.dir[0], 0, base.dir[2]).normalize()
        const r = (pitch * Math.PI) / 180
        const fwd = new V(h.x * Math.cos(r), -Math.sin(r), h.z * Math.cos(r))
        c.position.fromArray(base.eye)
        const target = c.position.clone().addScaledVector(fwd, 1000)
        c.lookAt(target)
        if (st.controls) { st.controls.target.copy(target); st.controls.update() }
        c.updateMatrixWorld()
        st.invalidate()
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }, { base, pitch })
      await setPose(); await settle(); await setPose(); await sleep(800)
      const pose = await page.evaluate(() => { const c = window.__s.scene.getState().camera; return { eye: c.position.toArray(), dir: c.getWorldDirection(new c.position.constructor()).toArray() } })
      console.log('pose', p, pitch, JSON.stringify(pose))
      for (const sun of SUNS) {
        await page.evaluate((h) => window.__s.app.getState().setSetting('sunHour', h), sun)
        for (const mode of ['before', 'after']) {
          const view = await page.evaluate(async (mode) => {
            window.__OLD = mode === 'before'
            const st = window.__s.scene.getState()
            st.invalidate()
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
            st.invalidate()
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
            const c = st.camera
            const D = globalThis.__shadowDbg
            let light = null
            st.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) light = o })
            const sh = light?.shadow
            const w = sh.camera.right - sh.camera.left, hh = sh.camera.top - sh.camera.bottom
            // where the shadow distance ends on screen: the point at that horizontal distance, a ground height guessed from the axis
            const V = c.position.constructor
            const dir = c.getWorldDirection(new V())
            const hd = new V(dir.x, 0, dir.z).normalize()
            const pt = c.position.clone().addScaledVector(hd, D.distance)
            pt.y = c.position.y - (Number.isFinite(D.aim) ? D.aim * -dir.y : 300)
            const ndc = pt.clone().project(c)
            return { distance: D.distance, aim: D.aim, texel: Math.max(w, hh) / sh.mapSize.x, bandY: (1 - ndc.y) / 2 }
          }, mode)
          await sleep(300)
          const tag = `h${p}-p${pitch}-s${sun}-${mode}`
          await canvasShot(join(OUT, `${tag}.png`))
          results.views.push({ p, pitch, sun, mode, ...view })
          console.log(tag, JSON.stringify(view))
        }
      }
    }
  }
  writeFileSync(join(OUT, `results-${TAG}.json`), JSON.stringify(results, null, 1))
} finally {
  await browser.close()
  await server.close()
}
