import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire('/home/yriou/openflyover/package.json')
const puppeteer = require('puppeteer-core')
const B = '<dossier de travail>'
mkdirSync(`${B}/sprites`, { recursive: true })
const names = (process.argv[2] ?? 'current,adventurer,adventurerF,rogue,kaykit,ual').split(',')
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'shell', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
try {
  for (const name of names) {
    const page = await browser.newPage()
    page.setDefaultTimeout(120_000)
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message.slice(0, 200)))
    page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', name, m.text().slice(0, 200)))
    await page.goto(`http://127.0.0.1:5399/index.html?glb=${name}&px=30,44,120,260`, { waitUntil: 'load' })
    const out = await page.evaluate(() => window.run())
    for (const [key, url] of Object.entries(out)) writeFileSync(`${B}/sprites/${name}-${key}.png`, Buffer.from(url.split(',')[1], 'base64'))
    console.log(name, Object.keys(out).length, 'sprites')
    await page.close()
  }
} finally {
  await browser.close()
}
