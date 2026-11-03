import puppeteer from '/home/madcreator/openflyover/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { writeFileSync } from 'node:fs'
const env = process.env
const MODE = env.MODE ?? 'gl'
const W = +(env.W ?? 1920), H = +(env.H ?? 1080), FPS = +(env.FPS ?? 30), DUR = +(env.DUR ?? 3)
const CLOUDS = env.CLOUDS ?? 'default'
const QUALITY = env.QUALITY ?? 'standard'
const PROFILE = env.PROFILE === '1'
const OUT = env.OUT ?? `/tmp/bench-${MODE}.json`
const PANEL = env.PANEL !== '0'
const args = { sw: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], gl: ['--use-gl=angle', '--use-angle=gl'] }[MODE]
const b = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'shell', protocolTimeout: 3_600_000,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--lang=fr', '--window-size=1440,900', ...args, ...(env.EXTRA ? env.EXTRA.split(' ') : [])],
  defaultViewport: { width: 1440, height: 900 },
  env: { ...process.env, MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', GALLIUM_DRIVER: 'd3d12', LD_LIBRARY_PATH: '/usr/lib/wsl/lib' },
})
const page = await b.newPage()
page.setDefaultTimeout(120_000)
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }); window.__prof = { frames: [], on: true } })
const logs = []
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[export]')) { console.log(t); logs.push(t) } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid="empty-state"]', { visible: true })
const btn = await page.waitForSelector("::-p-text(Essayer avec l'exemple)")
await btn.click()
await page.waitForFunction(() => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Clôture'))
await page.waitForSelector('canvas[data-engine^="three.js"]')
await page.waitForFunction(() => !!window.__bench)
console.log('GPU', await page.evaluate(() => { const gl = document.querySelector('canvas[data-engine^="three.js"]').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL) }))
await new Promise((r) => setTimeout(r, 4000)) // let the preview settle
if (CLOUDS === 'none') await page.evaluate(() => { const { settings, setSetting } = window.__bench.appStore.getState(); setSetting('clouds', { ...settings.clouds, mode: 'aucun' }) })
if (PANEL) { await page.click('button[data-testid="topbar-export"]'); await page.waitForSelector('[data-testid="export-dock"]:not([hidden]) button::-p-text(Exporter la vidéo)', { visible: true }) }
if (env.NOYIELD) await page.evaluate((n) => { window.__prof.noYield = true; window.__prof.yieldEvery = n }, +env.NOYIELD)
if (env.DEPTH) await page.evaluate((d) => { window.__prof.depth = d }, +env.DEPTH)
if (env.NOGPUWAIT) await page.evaluate(() => { window.__prof.noGpuWait = true })
if (env.NOENC) await page.evaluate(() => sessionStorage.setItem('openflyover.export.noEncoding', '1'))
const cdp = await page.createCDPSession()
await cdp.send('Performance.enable')
const m0 = await cdp.send('Performance.getMetrics')
let profile = null
await page.evaluate((o) => { window.__bench.exportStore.getState().reset(); window.__bench.exportStore.getState().start({ width: o.W, height: o.H, fps: o.FPS, quality: o.QUALITY, durationS: o.DUR, holdStartS: 0, holdEndS: 0, baseName: 'bench' }) }, { W, H, FPS, DUR, QUALITY })
// wait for first frame then start profiler/metrics window
await page.waitForFunction(() => window.__prof.frames.length >= 2, { timeout: 3_600_000 })
const m1 = await cdp.send('Performance.getMetrics')
const t1 = Date.now()
if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start') }
const st = await page.waitForFunction(() => { const s = window.__bench.exportStore.getState(); return ['done', 'error', 'canceled'].includes(s.phase) ? { phase: s.phase, error: s.error, timings: s.timings, frameCount: s.frameCount, startedAt: s.startedAt } : null }, { timeout: 3_600_000, polling: 1000 })
const state = await st.jsonValue()
if (PROFILE) profile = (await cdp.send('Profiler.stop')).profile
const m2 = await cdp.send('Performance.getMetrics')
const frames = await page.evaluate(() => window.__prof.frames)
const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter((m) => m.name.startsWith('of:')).map((m) => [m.name, m.startTime]))
console.log('marks', marks.map(([n, t], i) => `${n} +${(t - marks[0][1]).toFixed(0)}`).join(' '))
const mm = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]))
writeFileSync(OUT, JSON.stringify({ cfg: { MODE, W, H, FPS, DUR, CLOUDS, QUALITY, PANEL }, state, frames, marks, metrics: { m0: mm(m0), m1: mm(m1), m2: mm(m2) }, logs }))
if (profile) writeFileSync(OUT.replace('.json', '.cpuprofile'), JSON.stringify(profile))
console.log('phase', state.phase, state.error ?? '', 'frames', frames.length)
await b.close()
