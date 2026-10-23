#!/usr/bin/env node
/**
 * Exports the same short film from the sample (320 × 180, 2 s, 10 frames/s, no volumetric clouds) in a headless Chrome
 * on a software GPU, and writes it to a file. The CI (export-regression.yml) runs it on the base branch and on the pull
 * request, then compares the frames (`ffmpeg -f framemd5`): a change that alters exported films shows in the pull
 * request. The export waits for the final tiles of each frame, so two runs a few minutes apart give the same film.
 *
 * Usage: node e2e/export-frames.mjs <app folder> <output file>
 *   OPENFLYOVER_CHROME   Chrome / Chromium executable (required)
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const [appDir, outFile] = process.argv.slice(2)
const CHROME = process.env.OPENFLYOVER_CHROME
if (!appDir || !outFile || !CHROME) {
  console.error('usage: OPENFLYOVER_CHROME=… node e2e/export-frames.mjs <app folder> <output file>')
  process.exit(2)
}
const ROOT = resolve(appDir)
const STEP_MS = 120_000
const EXPORT_MS = 900_000

const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  logLevel: 'warn',
  cacheDir: join(ROOT, 'node_modules/.vite-export-frames'),
  server: { host: '127.0.0.1', port: 5290, strictPort: false, hmr: false, watch: null },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
  protocolTimeout: EXPORT_MS,
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(STEP_MS)
  // the French interface, whatever the runner's language
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }))
  page.on('console', (msg) => msg.text().startsWith('[export]') && console.log(`  ${msg.text()}`))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.click("::-p-text(Essayer avec l'exemple)")
  await page.waitForSelector('canvas[data-engine^="three.js"]')
  // the stores, through their module URLs on the dev server (the app's instances)
  await page.waitForFunction(
    async () => {
      const [exportModule, appModule] = await Promise.all([import('/src/export/store.ts'), import('/src/state/store.ts')])
      window.__frames = { exportStore: exportModule.useExportStore, appStore: appModule.useAppStore }
      return appModule.useAppStore.getState().tracks.length > 0
    },
    { polling: 1000 },
  )
  // no volumetric clouds: minutes per frame on a software GPU
  await page.evaluate(() => {
    const { settings, setSetting } = window.__frames.appStore.getState()
    setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
  })
  // the export drawer holds what downloads the film: opened once
  await page.click('button[data-testid="topbar-export"]')
  await page.evaluate(() => {
    const store = window.__frames.exportStore.getState()
    store.reset()
    store.start({ width: 320, height: 180, fps: 10, quality: 'standard', durationS: 2, holdStartS: 0, holdEndS: 0, baseName: 'reference' })
  })
  const state = await (
    await page.waitForFunction(
      () => {
        const { phase, result, error } = window.__frames.exportStore.getState()
        return phase === 'done' || phase === 'error' || phase === 'canceled' ? { phase, result, error } : null
      },
      { timeout: EXPORT_MS, polling: 1000 },
    )
  ).jsonValue()
  if (state.phase !== 'done') throw new Error(`export: ${state.phase} ${state.error ?? ''}`)
  const base64 = await page.evaluate(async (u) => {
    const bytes = new Uint8Array(await (await fetch(u)).arrayBuffer())
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(text)
  }, state.result.url)
  writeFileSync(outFile, Buffer.from(base64, 'base64'))
  console.log(`${outFile}: ${state.result.fileName}, ${state.result.codec}, ${state.result.incompleteFrames} incomplete frame(s)`)
  if (state.result.incompleteFrames > 0) throw new Error('frames rendered before their tiles: the comparison would not hold')
} finally {
  await browser.close().catch(() => undefined)
  await server.close()
}
