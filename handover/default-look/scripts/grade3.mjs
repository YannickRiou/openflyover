// One page, grading variants on one frame. Usage: node grade3.mjs <repo> <outdir> <atm:0|1> <preset,preset,...>
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const [ROOT, OUT, ATM, PRESETS] = process.argv.slice(2)
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
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VALUES = {
  naturel: { preset: 'naturel', contrast: 0, saturation: 0, warmth: 0, vignette: 0 },
  contraste: { preset: 'contraste', contrast: 0.4, saturation: 0.1, warmth: 0, vignette: 0.25 },
  bw: { preset: 'noir-et-blanc', contrast: 0.3, saturation: -1, warmth: 0, vignette: 0.3 },
}
try {
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
  await page.evaluate(async () => { window.__b = { app: (await import('/src/state/store.ts')).useAppStore } })
  await page.evaluate((atm, V) => {
    const st = window.__b.app.getState()
    st.setSetting('atmosphere', atm === '1')
    st.setSetting('grading', V.naturel)
    st.setProgress(0.5, null)
  }, ATM, VALUES)
  await sleep(15000)
  for (const name of PRESETS.split(',')) {
    await page.evaluate((v) => window.__b.app.getState().setSetting('grading', v), VALUES[name])
    for (let k = 0; k < 6; k++) {
      await sleep(1000)
      await page.evaluate((k) => window.__b.app.getState().setProgress(0.5 + (k + 1) * 1e-6, null), k)
    }
    await page.screenshot({ path: join(OUT, `${ATM === '1' ? 'atm' : 'noatm'}-${name}.png`), clip: await (await page.$('canvas[data-engine^="three.js"]')).boundingBox() })
    console.log('shot', name)
  }
} finally {
  await browser.close()
  await server.close()
}
