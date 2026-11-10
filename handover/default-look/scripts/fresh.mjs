// Stills with a fresh page per variant. Usage: node fresh.mjs <repo> <outdir>
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const ROOT = process.argv[2]
const OUT = process.argv[3]
const ONLY = process.argv[4]
mkdirSync(OUT, { recursive: true })
const require = createRequire(join(ROOT, 'package.json'))
const puppeteer = (await import(require.resolve('puppeteer-core'))).default
const { createServer } = await import(require.resolve('vite'))
const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-look'),
  server: { host: '127.0.0.1', port: 5303, strictPort: false, hmr: false, watch: null },
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
const NATUREL = { preset: 'naturel', contrast: 0, saturation: 0, warmth: 0, vignette: 0 }
try {
  for (const atmosphere of [true, false]) {
    for (const look of ['before', 'after']) {
      if (ONLY !== `${look}-${atmosphere ? 'atm' : 'noatm'}`) continue
      const page = await browser.newPage()
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' })
        Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] })
      })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await (await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 120000 })).click()
      await (await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { visible: true, timeout: 60000 })).click()
      await page.waitForSelector('[role="dialog"] button::-p-text(Passer)', { hidden: true, timeout: 60000 })
      await page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: 60000 })
      await page.evaluate(async () => {
        window.__b = { app: (await import('/src/state/store.ts')).useAppStore }
      })
      await page.evaluate((atmosphere, look, NATUREL) => {
        const st = window.__b.app.getState()
        st.setSetting('atmosphere', atmosphere)
        if (look === 'before') {
          st.setSetting('grading', NATUREL)
          st.setSetting('trackStyle', { ...st.settings.trackStyle, glow: false })
        }
      }, atmosphere, look, NATUREL)
      const name = `${look}-${atmosphere ? 'atm' : 'noatm'}`
      for (const [i, p] of [0.08, 0.5, 0.92].entries()) {
        await page.evaluate((p) => window.__b.app.getState().setProgress(p, null), p)
        for (let k = 0; k < 14; k++) {
          await sleep(1000)
          await page.evaluate((p, k) => window.__b.app.getState().setProgress(p + (k + 1) * 1e-6, null), p, k)
        }
        await page.screenshot({ path: join(OUT, `${name}-${i + 1}.png`), clip: await (await page.$('canvas[data-engine^="three.js"]')).boundingBox() })
      }
      console.log('done', name)
      await page.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
