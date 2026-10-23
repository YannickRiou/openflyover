#!/usr/bin/env node
/**
 * Checks that the user guide exists in every language of the interface (src/i18n/languages.ts) and that the
 * translations keep the structure of the English one (docs/user-guide.html): the same anchors, the same links inside
 * the page, the same pictures, the right `lang`, and the language links to every other page. Run by the CI (lint job):
 * a section added to one guide and not to the others fails here.
 *
 * Usage: node scripts/check-user-guides.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const codes = [...readFileSync(resolve(ROOT, 'src/i18n/languages.ts'), 'utf8').matchAll(/\{ code: '([a-z]{2})'/g)].map((m) => m[1])
const fileOf = (code) => `docs/user-guide${code === 'en' ? '' : `.${code}`}.html`

/** The parts of a page that must not differ between languages. */
function skeleton(html) {
  const all = (re) => [...html.matchAll(re)].map((m) => m[1])
  return {
    ids: all(/\sid="([^"]+)"/g),
    anchors: all(/href="(#[^"]*)"/g),
    pictures: all(/<img[^>]*\ssrc="([^"]+)"/g),
    languages: all(/<a href="(user-guide[^"]*\.html)" hreflang=/g),
  }
}

const problems = []
const english = skeleton(readFileSync(resolve(ROOT, fileOf('en')), 'utf8'))
for (const code of codes) {
  const file = fileOf(code)
  if (!existsSync(resolve(ROOT, file))) {
    problems.push(`${file}: missing (the interface is offered in « ${code} »)`)
    continue
  }
  const html = readFileSync(resolve(ROOT, file), 'utf8')
  if (!new RegExp(`<html lang="${code}"`).test(html)) problems.push(`${file}: <html lang="${code}"> expected`)
  const page = skeleton(html)
  for (const key of ['ids', 'anchors', 'pictures']) {
    if (page[key].join('\n') !== english[key].join('\n')) problems.push(`${file}: its ${key} differ from ${fileOf('en')}`)
  }
  const expected = codes.map(fileOf).map((f) => f.replace('docs/', '')).sort()
  if ([...page.languages].sort().join() !== expected.join()) problems.push(`${file}: the language links should be ${expected.join(', ')}`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`user guides: ${codes.length} languages, same structure`)
