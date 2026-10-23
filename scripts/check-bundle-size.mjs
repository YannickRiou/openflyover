#!/usr/bin/env node
/**
 * Size budget of the first screen, after `npm run build`: the entry script, the modules it preloads and the stylesheet
 * named by dist/index.html (what a visitor downloads before the home screen shows), summed gzipped. Fails above the
 * budget, so that a module pulled into the first screen by accident (three.js, a whole library) shows in the pull
 * request rather than months later. Raise the budget on purpose, in the same pull request, when a feature needs it.
 *
 * Usage: node scripts/check-bundle-size.mjs [dist]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** kB, gzipped (1 kB = 1000 bytes): 4.2.1 measured 756, the five languages and the stylesheet included. */
const FIRST_SCREEN_GZIP_KB = 790

const dist = resolve(process.argv[2] ?? 'dist')
const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
const urls = [
  ...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
  ...html.matchAll(/<link[^>]*rel="(?:modulepreload|stylesheet)"[^>]*href="([^"]+)"/g),
].map((m) => m[1])
const files = [...new Set(urls)]
  .filter((url) => !/^https?:/.test(url))
  .map((url) => {
    const bytes = readFileSync(resolve(dist, url.replace(/^.*?\/assets\//, 'assets/')))
    return { name: url.replace(/^.*\//, ''), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }
  })
  .sort((a, b) => b.gzip - a.gzip)

const kb = (n) => (n / 1000).toFixed(0)
const raw = files.reduce((sum, f) => sum + f.raw, 0)
const gzip = files.reduce((sum, f) => sum + f.gzip, 0)
for (const f of files.slice(0, 8)) console.log(`${kb(f.gzip).padStart(5)} kB gzip  ${kb(f.raw).padStart(5)} kB  ${f.name}`)
console.log(`first screen: ${files.length} files, ${kb(raw)} kB, ${kb(gzip)} kB gzip (budget ${FIRST_SCREEN_GZIP_KB} kB gzip)`)
if (gzip / 1000 > FIRST_SCREEN_GZIP_KB) {
  console.error(`over the budget by ${kb(gzip - FIRST_SCREEN_GZIP_KB * 1000)} kB gzip: see « Loading (bundle splitting) » in ARCHITECTURE.md`)
  process.exit(1)
}
