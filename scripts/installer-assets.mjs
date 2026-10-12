#!/usr/bin/env node
/**
 * Generates the images of the desktop installers into src-tauri/installer/ (committed: they are build inputs of
 * `tauri build`, this script is only for regenerating them after a change of look).
 *
 * One headless Chromium does everything: it opens the app (Vite dev server on the sample track, light theme, as in
 * e2e/run.mjs), takes a real screenshot, then composes each image in HTML with the « Carte alpine » palette
 * (src/ui/theme.css), the committed fonts (Fraunces, IBM Plex Sans) and the logo (public/favicon.svg). The pixels are
 * read back with canvas getImageData and written as 24-bit BMP (no alpha, no compression: what NSIS and WiX ask for).
 *
 *   nsis-header.bmp     150 x 57   NSIS pages header (bundle.windows.nsis.headerImage / uninstallerHeaderImage)
 *   nsis-sidebar.bmp    164 x 314  NSIS welcome and finish pages (sidebarImage)
 *   wix-banner.bmp      493 x 58   MSI banner, behind the page title (bannerPath)
 *   wix-dialog.bmp      493 x 312  MSI welcome and finish dialogs, text on the right (dialogImagePath)
 *   dmg-background.png  660 x 400  macOS disk image window (bundle.macOS.dmg.background)
 *
 * Usage: npm run installer-assets
 * Environment: OPENFLYOVER_CHROME = Chromium executable (default: a Playwright headless shell when found).
 *              OPENFLYOVER_INSTALLER_SHOT = an existing screenshot (PNG) to use instead of capturing the app.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'src-tauri/installer')
const SHOT_WIDTH = 1440
const SHOT_HEIGHT = 876 // 900 minus the status bar, which shows the state of the network of the machine

// « Carte alpine » (src/ui/theme.css)
const C = {
  paper: '#f6f3ec',
  card: '#ece7da',
  ink: '#1b2832',
  inkSoft: '#4e5c65',
  accent: '#b9391f',
  accentLight: '#ff9b73',
  glacier: '#a9ccd9',
  line: '#ddd6c6',
}

function findChrome() {
  if (process.env.OPENFLYOVER_CHROME) return process.env.OPENFLYOVER_CHROME
  for (const base of ['/opt/pw-browsers', join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(base)) continue
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const sub of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        if (existsSync(join(base, dir, sub))) return join(base, dir, sub)
      }
    }
  }
  throw new Error('Chromium introuvable : indiquez son chemin dans OPENFLYOVER_CHROME')
}

/** 24-bit BMP (BITMAPINFOHEADER, bottom-up, BI_RGB) from RGBA pixels. */
function encodeBmp(width, height, rgba) {
  const stride = (width * 3 + 3) & ~3
  const out = Buffer.alloc(54 + stride * height)
  out.write('BM', 0, 'latin1')
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(54, 10) // offset of the pixels
  out.writeUInt32LE(40, 14) // size of the info header
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22) // positive: rows from the bottom
  out.writeUInt16LE(1, 26) // planes
  out.writeUInt16LE(24, 28) // bits per pixel
  out.writeUInt32LE(stride * height, 34)
  out.writeInt32LE(2835, 38) // 72 dpi
  out.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      out[o++] = rgba[i + 2]
      out[o++] = rgba[i + 1]
      out[o++] = rgba[i]
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------ screenshot

/** A screenshot of the app with the sample track loaded (light theme, the 3D view and the film overlay on). */
async function captureApp(browser) {
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    cacheDir: join(ROOT, 'node_modules/.vite-installer-assets'),
    server: { host: '127.0.0.1', port: 5290, strictPort: false, hmr: false, watch: null },
  })
  await server.listen()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: SHOT_WIDTH, height: 900 })
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const example = await page.waitForSelector("button::-p-text(Essayer avec l'exemple)", { visible: true, timeout: 60_000 })
    await example.click()
    await page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: 120_000 })
    // the « Trace importée » message hides the 3D view; the waypoint labels need a few frames to be drawn
    await page
      .waitForSelector('button[aria-label="Fermer le message"]', { visible: true, timeout: 20_000 })
      .then((close) => close.click())
      .catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 8000))
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: SHOT_WIDTH, height: SHOT_HEIGHT } })
    await page.close()
    return Buffer.from(png)
  } finally {
    await server.close()
  }
}

// ------------------------------------------------------------------------------------------------ designs

const fontFace = (family, file, weights) =>
  `@font-face{font-family:'${family}';font-weight:${weights};src:url(data:font/woff2;base64,${readFileSync(join(ROOT, 'public/fonts', file)).toString('base64')}) format('woff2')}`

const logo = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8')
  .replace('<svg ', '<svg width="100%" height="100%" ')

const BASE_CSS = `
${fontFace('Fraunces', 'fraunces-variable-latin.woff2', '100 900')}
${fontFace('IBM Plex Sans', 'ibm-plex-sans-variable-latin.woff2', '100 700')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
.root{position:relative;overflow:hidden;font-family:'IBM Plex Sans',system-ui,sans-serif;color:${C.ink}}
.abs{position:absolute}
.name{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-0.01em;white-space:nowrap}
`

/** The side picture of the welcome and finish pages: logo, name, the app. The text of the page is to the right. */
function sidebar(w, h) {
  return `<div class="root" style="width:${w}px;height:${h}px;background:${C.ink}">
    <div class="abs" style="left:54px;top:24px;width:56px;height:56px;border-radius:13px;background:${C.ink};box-shadow:0 0 0 2px ${C.accent}">${logo}</div>
    <div class="abs name" style="left:0;right:0;top:92px;text-align:center;font-size:23px;color:#fff">OpenFlyover</div>
    <div class="abs" style="left:0;right:0;top:124px;text-align:center;font-size:12.5px;color:${C.glacier}">Films de survol 3D</div>
    <div class="abs" style="left:12px;top:160px;width:140px;height:${Math.round((140 * SHOT_HEIGHT) / SHOT_WIDTH) + 4}px;border:2px solid ${C.paper};border-radius:4px;overflow:hidden"><img src="__SHOT__" style="display:block;width:136px"></div>
    <div class="abs" style="left:0;right:0;top:${h - 58}px;text-align:center;font-size:12px;color:#fff;line-height:1.45">GPX et FIT<br>100&nbsp;% en local</div>
    <div class="abs" style="left:0;right:0;bottom:0;height:6px;background:${C.accent}"></div>
  </div>`
}

const DESIGNS = [
  {
    file: 'nsis-header.bmp',
    w: 150,
    h: 57,
    html: () => `<div class="root" style="width:150px;height:57px;background:${C.ink}">
      <div class="abs" style="left:9px;top:12px;width:30px;height:30px;border-radius:7px;box-shadow:0 0 0 1.5px ${C.accent}">${logo}</div>
      <div class="abs name" style="left:46px;top:13px;font-size:15px;line-height:24px;color:#fff">OpenFlyover</div>
      <div class="abs" style="left:47px;top:35px;font-size:9px;line-height:12px;color:${C.glacier}">Films de survol 3D</div>
      <div class="abs" style="left:0;right:0;bottom:0;height:4px;background:${C.accent}"></div>
    </div>`,
  },
  { file: 'nsis-sidebar.bmp', w: 164, h: 314, html: () => sidebar(164, 314) },
  {
    // the installer writes the title and the description of each page over the left part (up to x = 400 for a long
    // description): white there, the logo alone in a dark block at the right end
    file: 'wix-banner.bmp',
    w: 493,
    h: 58,
    html: () => `<div class="root" style="width:493px;height:58px;background:#fff">
      <div class="abs" style="left:423px;top:0;width:70px;height:58px;background:${C.ink}"></div>
      <div class="abs" style="left:441px;top:11px;width:34px;height:34px;border-radius:8px;box-shadow:0 0 0 1.5px ${C.accent}">${logo}</div>
      <div class="abs" style="left:0;right:0;bottom:0;height:4px;background:${C.accent}"></div>
    </div>`,
  },
  {
    // the welcome text is written by the installer from x = 180: white there
    file: 'wix-dialog.bmp',
    w: 493,
    h: 312,
    html: () => `<div class="root" style="width:493px;height:312px;background:#fff">${sidebar(164, 312)}</div>`,
  },
  {
    // icons (128 px) centred on (180, 170) and (480, 170), their labels below: the picture keeps those places empty
    file: 'dmg-background.png',
    w: 660,
    h: 400,
    html: () => `<div class="root" style="width:660px;height:400px;background:${C.paper}">
      <div class="abs" style="left:0;top:0;width:660px;height:10px;background:${C.ink}"></div>
      <div class="abs" style="left:40px;top:34px;width:44px;height:44px;border-radius:10px;box-shadow:0 0 0 2px ${C.accent}">${logo}</div>
      <div class="abs name" style="left:98px;top:30px;font-size:30px;line-height:36px;color:${C.ink}">OpenFlyover</div>
      <div class="abs" style="left:98px;top:66px;font-size:14px;line-height:20px;color:${C.inkSoft}">Glissez l’application dans le dossier Applications.</div>
      <svg class="abs" style="left:250px;top:140px" width="160" height="60" viewBox="0 0 160 60" fill="none" stroke="${C.accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 30h128"/><path d="M114 8l26 22-26 22"/></svg>
      <div class="abs" style="left:110px;top:284px;width:440px;height:130px;border:2px solid ${C.ink};border-radius:8px 8px 0 0;background:${C.ink};overflow:hidden;box-shadow:0 -2px 12px rgb(27 40 50 / 0.25)"><img src="__SHOT__" style="display:block;width:436px"></div>
    </div>`,
  },
]

/** Pixels of a PNG, through a canvas of the page. */
async function readPixels(page, png) {
  const base64 = await page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
  }, png.toString('base64'))
  return Buffer.from(base64, 'base64')
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'shell',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  })
  try {
    let shot
    if (process.env.OPENFLYOVER_INSTALLER_SHOT) {
      shot = readFileSync(process.env.OPENFLYOVER_INSTALLER_SHOT)
    } else {
      shot = await captureApp(browser)
      const kept = join(tmpdir(), 'openflyover-installer-shot.png')
      writeFileSync(kept, shot)
      console.log(`capture : ${kept} (OPENFLYOVER_INSTALLER_SHOT pour la réutiliser)`)
    }
    const dataUrl = `data:image/png;base64,${shot.toString('base64')}`
    const page = await browser.newPage()
    for (const design of DESIGNS) {
      await page.setViewport({ width: design.w, height: design.h, deviceScaleFactor: 1 })
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style>${design.html().replaceAll('__SHOT__', dataUrl)}`)
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
      const png = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: design.w, height: design.h } }))
      if (design.file.endsWith('.png')) {
        writeFileSync(join(OUT, design.file), png)
      } else {
        const rgba = await readPixels(page, png)
        writeFileSync(join(OUT, design.file), encodeBmp(design.w, design.h, rgba))
      }
      console.log(`src-tauri/installer/${design.file} (${design.w} x ${design.h})`)
    }
  } finally {
    await browser.close()
  }
}

await main()
