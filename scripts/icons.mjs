#!/usr/bin/env node
/**
 * Regenerates every icon from the two drawings of `src-tauri/icons/source/` (committed: the PNG are build inputs, this script
 * is only for a change of the drawing):
 *
 *   icon.svg           → public/icons/icon-192.png, icon-512.png (the web app, transparent corners),
 *                        src-tauri/icons/32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.icns, icon.ico (desktop)
 *   icon-maskable.svg  → public/icons/icon-maskable-512.png (Android crops it), apple-touch-icon.png (iOS rounds it itself)
 *
 * One headless Chromium draws each SVG at its size on a canvas. The PNG are then written with a palette of 256 colours at
 * most and an error-diffusion dither (Floyd–Steinberg, alpha included), which keeps the frosted glass and the glow without
 * banding at a tenth of the truecolor size: the service worker of the website downloads them all. `icon.icns` and
 * `icon.ico` come from `tauri icon` on a 512 px rendering in truecolor (the size the drawing was made for); the Tauri CLI
 * adds a 1024 px size to the .icns, which makes it about three times heavier: run with `--no-desktop-bundle` to keep the
 * committed .icns and .ico when only the PNG change.
 *
 * Usage: npm run icons
 * Environment: OPENFLYOVER_CHROME = Chromium executable (default: a Playwright headless shell when found).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import puppeteer from 'puppeteer-core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = join(ROOT, 'src-tauri/icons/source')
const WEB = join(ROOT, 'public/icons')
const DESKTOP = join(ROOT, 'src-tauri/icons')

/** What to draw: the source, the size, where it goes, whether its pixels may be transparent. */
const OUTPUTS = [
  { svg: 'icon.svg', size: 192, out: join(WEB, 'icon-192.png'), alpha: true },
  { svg: 'icon.svg', size: 512, out: join(WEB, 'icon-512.png'), alpha: true },
  { svg: 'icon-maskable.svg', size: 512, out: join(WEB, 'icon-maskable-512.png'), alpha: false },
  { svg: 'icon-maskable.svg', size: 180, out: join(WEB, 'apple-touch-icon.png'), alpha: false },
  { svg: 'icon.svg', size: 32, out: join(DESKTOP, '32x32.png'), alpha: true },
  { svg: 'icon.svg', size: 128, out: join(DESKTOP, '128x128.png'), alpha: true },
  { svg: 'icon.svg', size: 256, out: join(DESKTOP, '128x128@2x.png'), alpha: true },
  { svg: 'icon.svg', size: 512, out: join(DESKTOP, 'icon.png'), alpha: true },
]

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

// ------------------------------------------------------------------------------------------------ PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** An indexed PNG (colour type 3): `index` one byte per pixel, `palette` [r, g, b, a] per entry. */
function encodeIndexedPng(width, height, index, palette, alpha) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 3
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) index.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width)
  const parts = [chunk('IHDR', header), chunk('PLTE', Buffer.from(palette.flatMap(([r, g, b]) => [r, g, b])))]
  if (alpha) parts.push(chunk('tRNS', Buffer.from(palette.map((c) => c[3]))))
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...parts])
}

// ------------------------------------------------------------------------------------------------ palette

/** At most `count` colours for `rgba` (median cut over the colours weighted by how many pixels have them). */
function medianCut(rgba, count, alpha) {
  const histogram = new Map()
  for (let i = 0; i < rgba.length; i += 4) {
    const a = alpha ? rgba[i + 3] : 255
    // 5 bits a channel for the histogram: enough to place the boxes, the pixels are then matched exactly
    const key = ((rgba[i] >> 3) << 15) | ((rgba[i + 1] >> 3) << 10) | ((rgba[i + 2] >> 3) << 5) | (a >> 3)
    const entry = histogram.get(key)
    if (entry) {
      entry[0] += rgba[i]
      entry[1] += rgba[i + 1]
      entry[2] += rgba[i + 2]
      entry[3] += a
      entry[4]++
    } else histogram.set(key, [rgba[i], rgba[i + 1], rgba[i + 2], a, 1])
  }
  const colours = [...histogram.values()].map(([r, g, b, a, n]) => [r / n, g / n, b / n, a / n, n])
  let boxes = [colours]
  while (boxes.length < count) {
    // split the box with the widest channel, weighted by its pixels
    let best = -1
    let bestScore = 0
    let bestChannel = 0
    boxes.forEach((box, k) => {
      if (box.length < 2) return
      for (let c = 0; c < 4; c++) {
        let lo = Infinity
        let hi = -Infinity
        let n = 0
        for (const colour of box) {
          lo = Math.min(lo, colour[c])
          hi = Math.max(hi, colour[c])
          n += colour[4]
        }
        const score = (hi - lo) * Math.sqrt(n)
        if (score > bestScore) [best, bestScore, bestChannel] = [k, score, c]
      }
    })
    if (best < 0) break
    const box = boxes[best].sort((p, q) => p[bestChannel] - q[bestChannel])
    const half = box.reduce((s, c) => s + c[4], 0) / 2
    let acc = 0
    let cut = 1
    for (; cut < box.length - 1; cut++) {
      acc += box[cut - 1][4]
      if (acc >= half) break
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)]
  }
  return boxes.map((box) => {
    const n = box.reduce((s, c) => s + c[4], 0)
    return [0, 1, 2, 3].map((c) => Math.round(box.reduce((s, colour) => s + colour[c] * colour[4], 0) / n))
  })
}

/** Each pixel to its nearest colour of `palette`, the error carried to the next ones (Floyd–Steinberg). */
function dither(width, height, rgba, palette, alpha) {
  const work = Float32Array.from(rgba)
  if (!alpha) for (let i = 3; i < work.length; i += 4) work[i] = 255
  const index = Buffer.alloc(width * height)
  const cache = new Map()
  const nearest = (r, g, b, a) => {
    const key = ((r >> 2) << 18) | ((g >> 2) << 12) | ((b >> 2) << 6) | (a >> 2)
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let best = 0
    let bestD = Infinity
    palette.forEach(([pr, pg, pb, pa], k) => {
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2 + 2 * (pa - a) ** 2
      if (d < bestD) [best, bestD] = [k, d]
    })
    cache.set(key, best)
    return best
  }
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  const spread = (x, y, err, weight) => {
    if (x < 0 || x >= width || y >= height) return
    const j = (y * width + x) * 4
    for (let c = 0; c < 4; c++) work[j + c] += err[c] * weight
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const k = nearest(clamp(work[i]), clamp(work[i + 1]), clamp(work[i + 2]), clamp(work[i + 3]))
      index[y * width + x] = k
      const err = [0, 1, 2, 3].map((c) => work[i + c] - palette[k][c])
      spread(x + 1, y, err, 7 / 16)
      spread(x - 1, y + 1, err, 3 / 16)
      spread(x, y + 1, err, 5 / 16)
      spread(x + 1, y + 1, err, 1 / 16)
    }
  }
  return index
}

// ------------------------------------------------------------------------------------------------ run

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'shell', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setContent('<!doctype html><body style="margin:0"></body>')

/** RGBA pixels of `svg` drawn at `size` × `size`. */
async function render(svg, size) {
  const data = await page.evaluate(
    async (source, s) => {
      const image = new Image()
      image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = s
      canvas.height = s
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, s, s)
      return Array.from(ctx.getImageData(0, 0, s, s).data)
    },
    readFileSync(join(SOURCE, svg), 'utf8'),
    size,
  )
  return Uint8Array.from(data)
}

const sizeOf = (file) => (existsSync(file) ? statSync(file).size : 0)
for (const { svg, size, out, alpha } of OUTPUTS) {
  const before = sizeOf(out)
  const rgba = await render(svg, size)
  const palette = medianCut(rgba, 256, alpha)
  writeFileSync(out, encodeIndexedPng(size, size, dither(size, size, rgba, palette, alpha), palette, alpha))
  console.log(`${out.replace(ROOT, '')} (${size} px): ${before} → ${sizeOf(out)} octets`)
}

// the desktop's .icns and .ico from a truecolor rendering at 512 px, by the Tauri CLI (skipped with --no-desktop-bundle)
const bundle = !process.argv.includes('--no-desktop-bundle')
const big = await page.evaluate(
  async (source) => {
    const image = new Image()
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    canvas.getContext('2d').drawImage(image, 0, 0, 512, 512)
    return canvas.toDataURL('image/png').split(',')[1]
  },
  readFileSync(join(SOURCE, 'icon.svg'), 'utf8'),
)
await browser.close()
if (!bundle) process.exit(0)
const work = mkdtempSync(join(tmpdir(), 'openflyover-icons-'))
try {
  const input = join(work, 'icon-512.png')
  writeFileSync(input, Buffer.from(big, 'base64'))
  execFileSync('npx', ['tauri', 'icon', input, '--output', join(work, 'out')], { cwd: ROOT, stdio: 'ignore' })
  for (const name of ['icon.icns', 'icon.ico']) {
    const before = sizeOf(join(DESKTOP, name))
    copyFileSync(join(work, 'out', name), join(DESKTOP, name))
    console.log(`/src-tauri/icons/${name}: ${before} → ${sizeOf(join(DESKTOP, name))} octets`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
