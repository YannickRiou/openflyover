/**
 * End-to-end smoke tests: the real app in a headless Chromium (software GPU, SwiftShader), one scenario after the
 * other in the same page. Starts its own Vite server on a free port (no file watching, no reload), so the source
 * tree as it is now is tested and the export store can be reached through its module URL.
 *
 *   npm run e2e
 *
 * Environment:
 *   OPENFLYOVER_CHROME            Chromium / Chrome executable (default: Playwright's headless shell when present)
 *   OPENFLYOVER_E2E_SKIP_EXPORT=1 skip the export scenario (the slowest, it needs the tile servers)
 *   OPENFLYOVER_E2E_ONLY=a,b      run only the scenarios whose id is listed (ids: see SCENARIOS)
 *
 * Fails on any console error or page error that is not network noise (ALLOWED_ERRORS). Screenshots of failed
 * scenarios and the downloaded files are kept in the output directory printed at the end.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CHROME = join(
  homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
)
const CHROME = process.env.OPENFLYOVER_CHROME || (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : '')
const SKIP_EXPORT = process.env.OPENFLYOVER_E2E_SKIP_EXPORT === '1'
const ONLY = (process.env.OPENFLYOVER_E2E_ONLY ?? '').split(',').filter(Boolean)
const OUT = mkdtempSync(join(tmpdir(), 'openflyover-e2e-'))
const DOWNLOADS = join(OUT, 'downloads')
mkdirSync(DOWNLOADS)

/** Software GPU: generous timeouts. */
const STEP_MS = 60_000
const EXPORT_MS = 600_000

/**
 * Console errors that are network noise, not bugs: tiles, weather, Overpass (slow, rate-limited or refused
 * servers). Everything else fails the scenario.
 */
const ALLOWED_ERRORS = [
  /Failed to load resource: the server responded with a status of (4|5)\d\d/,
  /Failed to load resource: net::ERR_/,
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|NETWORK|HTTP2|QUIC|SSL|ABORTED)/,
  /\b(tile|tuile)s?\b.*(fail|échec|erreur|error)/i,
  /overpass|open-meteo/i,
  // SwiftShader / ANGLE chatter
  /GL_INVALID_|WebGL: too many errors|GPU stall due to ReadPixels/,
]

const log = (...args) => console.log(...args)
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

// ---------------------------------------------------------------------------------------------------- helpers

/** The tabs of the side panel, in the order of the rail (SHELL_TABS in src/ui/shell.ts). */
const TABS = ['trace', 'carte', 'meteo', 'lumiere', 'survol', 'objectif', 'habillage', 'projet', 'reglages']

/** Waits until `fn` (run in the page) returns a truthy value. */
const until = (page, fn, arg, timeout = STEP_MS) => page.waitForFunction(fn, { timeout, polling: 250 }, arg)

/** Clicks the first visible button whose text contains `text`. */
async function clickButton(page, text, timeout = STEP_MS) {
  const button = await page.waitForSelector(`button::-p-text(${text})`, { visible: true, timeout })
  await button.click()
}

/** Number of blocks in a timeline lane (« Plans », « Arrêts », « Textes »…). */
const laneCount = (page, lane) =>
  page.evaluate(
    (name) => document.querySelectorAll(`[role="group"][aria-label="${name}"] .film-tl__block`).length,
    lane,
  )

/**
 * The 3D scene, loaded in its own chunk after the timeline shows: its WebGL canvas (three.js tags it) is there, so
 * the export controller it holds is mounted.
 */
const waitForScene = (page) => page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: STEP_MS })

/** Takes the keyboard away from any field or button (shortcuts are ignored in a text field). */
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

/** A file that appears in the download folder after `since` (finished: no .crdownload). */
async function waitForDownload(extension, since, timeout = STEP_MS) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const files = readdirSync(DOWNLOADS)
      .filter((name) => name.endsWith(extension))
      .map((name) => ({ name, path: join(DOWNLOADS, name), ...statSync(join(DOWNLOADS, name)) }))
      .filter((f) => f.mtimeMs >= since && f.size > 0)
    if (files.length > 0) return files[0]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`aucun fichier ${extension} téléchargé en ${seconds(timeout)}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * The app's stores, reached through their module URLs on the dev server (same instances as the app's) and kept on
 * `window.__e2e`. A dynamic import evaluated from the test can fail once with « Promise was collected »: retried.
 */
async function exposeStores(page) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.evaluate(async () => {
        const [exportModule, appModule, history, historyStore] = await Promise.all([
          import('/src/export/store.ts'),
          import('/src/state/store.ts'),
          import('/src/export/history.ts'),
          import('/src/export/historyStore.ts'),
        ])
        window.__e2e = { exportStore: exportModule.useExportStore, isExportBusy: exportModule.isExportBusy, appStore: appModule.useAppStore, history, historyStore }
        return true
      })
    } catch (error) {
      if (attempt >= 3) throw error
      log(`    accès aux stores : ${error.message}, nouvel essai`)
    }
  }
}

/**
 * The 3D scene's state (camera, orbit controls) on `window.__e2e.scene`: the store of the react-three-fiber root, through
 * the module URL the dev server gave the app (same instance).
 */
async function exposeScene(page) {
  await exposeStores(page)
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((name) => name.includes('/@react-three_fiber.js'))
    const fiber = await import(url)
    window.__e2e.scene = [...fiber._roots.values()][0].store
  })
}

/** Camera pose of the 3D view: position, orientation, field of view. */
const cameraPose = (page) =>
  page.evaluate(() => {
    const { camera } = window.__e2e.scene.getState()
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov }
  })

/** Distance (m) and angle (°) between two poses. */
function poseGap(a, b) {
  const metres = Math.hypot(...a.position.map((v, i) => v - b.position[i]))
  const dot = Math.min(1, Math.abs(a.quaternion.reduce((sum, v, i) => sum + v * b.quaternion[i], 0)))
  return { metres, degrees: (2 * Math.acos(dot) * 180) / Math.PI, fov: Math.abs(a.fov - b.fov) }
}

/** Waits until the camera shows `pose` again (within 5 cm and 0.1°), the film time at `timeS`. */
async function expectPose(page, pose, timeS, label) {
  let gap = null
  for (const end = Date.now() + STEP_MS; Date.now() < end; ) {
    const state = await page.evaluate(() => window.__e2e.appStore.getState().playback)
    gap = poseGap(await cameraPose(page), pose)
    if (Math.abs((state.timeS ?? -1) - timeS) < 1e-3 && gap.metres < 0.05 && gap.degrees < 0.1 && gap.fov === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label} : la vue n’est pas celle de l’image clé (${gap.metres.toFixed(3)} m, ${gap.degrees.toFixed(3)}°)`)
}

async function waitForExport(page, label) {
  const handle = await until(
    page,
    () => {
      const { phase, result, error, frame, frameCount } = window.__e2e.exportStore.getState()
      if (phase === 'done' || phase === 'error' || phase === 'canceled') return { phase, result, error, frame, frameCount }
      return null
    },
    undefined,
    EXPORT_MS,
  )
  const state = await handle.jsonValue()
  assert(state.phase === 'done', `${label} : phase « ${state.phase} »${state.error ? ` (${state.error})` : ''}`)
  return state
}

/** Size of the blob behind an object URL of the page. */
const blobSize = (page, url) => page.evaluate(async (u) => (await (await fetch(u)).blob()).size, url)

// -------------------------------------------------------------------------------------------------- scenarios

const SCENARIOS = [
  {
    id: 'accueil',
    title: "Accueil vide, puis l'exemple chargé",
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('#empty-title::-p-text(Votre sortie)', { visible: true, timeout: STEP_MS })
      // the home screen: « Projet » alone in the rail, no export
      const homeTabs = await page.$$eval('.rail [role="tab"]', (tabs) => tabs.map((t) => t.id.replace('tab-', '')))
      assert(homeTabs.join() === 'projet', `onglets de l'accueil : ${homeTabs.join(', ')}`)
      assert(!(await page.$('.topbar__export')), '« Exporter » est affiché sans trace')
      await clickButton(page, "Essayer avec l'exemple")
      await until(page, () => {
        const lane = document.querySelector('[role="group"][aria-label="Plans"]')
        const text = lane?.textContent ?? ''
        return text.includes('Ouverture') && text.includes('Survol') && text.includes('Clôture')
      })
      assert(!(await page.$('#empty-title')), "l'accueil est resté affiché après le chargement de l'exemple")
      // the tabs come back, on « Trace »
      await until(page, (all) => [...document.querySelectorAll('.rail [role="tab"]')].map((t) => t.id.replace('tab-', '')).join() === all, TABS.join())
      assert(await page.$eval('#tab-trace', (t) => t.getAttribute('aria-selected') === 'true'), "l'onglet Trace n'est pas ouvert après l'exemple")
      assert(await page.$('.topbar__export'), "« Exporter » manque après l'exemple")
      await waitForScene(page)
    },
  },
  {
    id: 'onglets',
    title: 'Onglets du rail et aide des raccourcis',
    async run({ page }) {
      const shown = await page.$$eval('.rail [role="tab"]', (tabs) => tabs.map((t) => t.id.replace('tab-', '')))
      assert(shown.join() === TABS.join(), `onglets du rail : ${shown.join(', ')}`)
      for (const tab of TABS) {
        const open = await page.evaluate(
          (t) => document.getElementById(`tab-${t}`)?.getAttribute('aria-selected') === 'true' && !document.getElementById('side-panel')?.hidden,
          tab,
        )
        // a click on the open tab folds the panel
        if (!open) await page.click(`#tab-${tab}`)
        await until(
          page,
          (t) => {
            const panel = document.getElementById(`tab-panel-${t}`)
            return panel && !panel.hidden && !document.getElementById('side-panel')?.hidden && panel.getBoundingClientRect().width > 100
          },
          tab,
        )
      }
      // the « ? » button, then the « ? » key; Escape closes the dialog both times
      await page.click('button[aria-label="Raccourcis clavier"]')
      await page.waitForSelector('dialog.help[open]', { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await until(page, () => !document.querySelector('dialog.help[open]'))
      await blur(page)
      await page.keyboard.press('?')
      await page.waitForSelector('dialog.help[open]', { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await until(page, () => !document.querySelector('dialog.help[open]'))
    },
  },
  {
    id: 'diagnostic',
    title: 'Rapport de diagnostic (onglet Projet) : appareil et réglages, sans nom de trace',
    async run({ page }) {
      if (await page.evaluate(() => document.getElementById('tab-projet')?.getAttribute('aria-selected') !== 'true')) await page.click('#tab-projet')
      await page.click('#tab-panel-projet .setting-row__head::-p-text(Diagnostic)')
      await clickButton(page, 'Afficher le rapport')
      await page.waitForSelector('dialog.diagnostic[open]', { visible: true, timeout: STEP_MS })
      const text = await page.$eval('dialog.diagnostic pre', (pre) => pre.textContent)
      for (const part of ['[Appareil]', '[Export]', '[Réglages]', 'Traces : 1,', 'budget.kind : desktop']) {
        assert(text.includes(part), `le rapport ne contient pas « ${part} »`)
      }
      assert(!/Mont-Blanc|Chamonix/i.test(text), 'le rapport contient le nom de la trace')
      await page.keyboard.press('Escape')
      await until(page, () => !document.querySelector('dialog.diagnostic[open]'))
    },
  },
  {
    id: 'reglage-repli',
    title: 'Réglage replié (onglet Lumière) : nom et valeur, curseur au clavier, Par défaut',
    async run({ page }) {
      if (await page.evaluate(() => document.getElementById('tab-lumiere')?.getAttribute('aria-selected') !== 'true')) {
        await page.click('#tab-lumiere')
      }
      const head = '#tab-panel-lumiere .setting-row__head::-p-text(Exposition)'
      const rowState = () =>
        page.evaluate(() => {
          const button = [...document.querySelectorAll('#tab-panel-lumiere .setting-row__head')].find((b) => b.textContent.startsWith('Exposition'))
          const body = button && document.getElementById(button.getAttribute('aria-controls'))
          return button && { expanded: button.getAttribute('aria-expanded'), value: button.querySelector('.setting-row__value').textContent, hidden: body.hidden }
        })
      const before = await rowState()
      assert(before && before.expanded === 'false' && before.hidden && before.value.startsWith('0'), `ligne Exposition au départ : ${JSON.stringify(before)}`)
      // pressed: the slider shows under the row and takes the focus; the arrows move it, the row says the new value
      await page.click(head)
      await until(page, () => document.activeElement?.matches('#tab-panel-lumiere .setting-row__body input[type="range"]'))
      await page.keyboard.press('ArrowRight')
      await until(page, () => document.querySelector('#tab-panel-lumiere .setting-row__value--modified')?.textContent.startsWith('+0,5'))
      // the section's « Par défaut » puts it back
      await page.click('#tab-panel-lumiere button[aria-label="Rétablir les réglages par défaut : Atmosphère"]')
      await until(page, () => !document.querySelector('#tab-panel-lumiere .setting-row__value--modified'))
      // Enter on the row folds it again
      await page.evaluate(() =>
        [...document.querySelectorAll('#tab-panel-lumiere .setting-row__head')].find((b) => b.textContent.startsWith('Exposition')).focus(),
      )
      await page.keyboard.press('Enter')
      const after = await rowState()
      assert(after.expanded === 'false' && after.hidden && after.value === before.value, `ligne Exposition à la fin : ${JSON.stringify(after)}`)
      await blur(page)
    },
  },
  {
    id: 'poids-de-rendu',
    title: 'Poids de rendu : pictogramme sur la ligne des nuages (nom accessible), point sur les onglets Météo et Objectif',
    async run({ page }) {
      await exposeStores(page)
      const set = (key, patch) =>
        page.evaluate((k, p) => {
          const { settings, setSetting } = window.__e2e.appStore.getState()
          setSetting(k, { ...settings[k], ...p })
        }, key, patch)
      const dot = (tab) => page.evaluate((t) => !!document.querySelector(`#tab-${t} .rail__weight`), tab)
      try {
        // clouds « Fine »: three bars, « lourd », and the dot on « Météo »
        await set('clouds', { mode: 'meteo', quality: 'high' })
        await page.click('#tab-meteo')
        await page.waitForSelector('#tab-panel-meteo .setting-row__label .render-weight--3', { timeout: STEP_MS })
        const name = await page.$eval('#tab-panel-meteo .setting-row__label .render-weight .visually-hidden', (el) => el.textContent)
        assert(name === 'Poids de rendu : lourd', `nom accessible du pictogramme : ${name}`)
        await until(page, () => !!document.querySelector('#tab-meteo .rail__weight'))
        // « Aucun »: no pictogram, no dot
        await set('clouds', { mode: 'aucun' })
        await until(page, () => !document.querySelector('#tab-panel-meteo .render-weight') && !document.querySelector('#tab-meteo .rail__weight'))
        // « Moyenne » with the motion blur: the dot moves to « Objectif »
        await set('clouds', { mode: 'meteo', quality: 'medium' })
        assert(!(await dot('meteo')) && !(await dot('objectif')), 'point sur un onglet avec les réglages par défaut')
        await set('lens', { shutter: 0.5 })
        await until(page, () => !!document.querySelector('#tab-objectif .rail__weight'))
        assert(!(await dot('meteo')), 'point sur Météo avec des nuages « Moyenne »')
      } finally {
        await set('clouds', { mode: 'meteo', quality: 'medium' })
        await set('lens', { shutter: 0 })
      }
    },
  },
  {
    id: 'qualite-export',
    title: 'Qualité d’export : pastille « Imposé par … » sur les nuages et le flou de bougé, « Personnalisé » après un choix à la main, retour au préréglage',
    async run({ page }) {
      await exposeStores(page)
      const set = (key, patch) =>
        page.evaluate((k, p) => {
          const { settings, setSetting } = window.__e2e.appStore.getState()
          setSetting(k, { ...settings[k], ...p })
        }, key, patch)
      // a click on the open tab folds the panel
      const openTab = async (tab) => {
        const shown = await page.evaluate((t) => document.getElementById(`tab-panel-${t}`)?.offsetParent !== null, tab)
        if (!shown) await page.click(`#tab-${tab}`)
      }
      const badge = (tab, knob) => page.evaluate((t, k) => document.querySelector(`#tab-panel-${t} [data-testid="preset-badge-${k}"]`)?.textContent ?? null, tab, knob)
      try {
        await set('clouds', { mode: 'meteo', quality: 'auto' })
        await set('video', { quality: 'standard' })
        await openTab('meteo')
        await until(page, () => document.querySelector('#tab-panel-meteo [data-testid="preset-badge-clouds"]')?.textContent === 'Imposé par Standard')
        // the pictogram weighs the export that will really run: « Rapide » = one bar
        const tip = await page.$eval('#tab-panel-meteo .setting-row__label .render-weight', (el) => el.dataset.tip)
        assert(tip.includes('×16') && tip.includes('imposé par la qualité Standard'), `info-bulle du pictogramme : ${tip}`)
        // another quality in the export settings: the badge follows
        await set('video', { quality: 'max' })
        await until(page, () => document.querySelector('#tab-panel-meteo [data-testid="preset-badge-clouds"]')?.textContent === 'Imposé par Maximale')
        assert(await page.$('#tab-panel-meteo .render-weight--3'), 'pictogramme « lourd » avec des nuages « Fine » imposés')
        // chosen by hand: « Personnalisé », and the project keeps the choice
        await set('clouds', { quality: 'low' })
        await until(page, () => document.querySelector('#tab-panel-meteo [data-testid="preset-badge-clouds"]')?.textContent === 'Personnalisé')
        // the way back: the row's button
        await page.click('#tab-panel-meteo .setting-row__head[aria-expanded]:has([data-testid="preset-badge-clouds"])')
        await clickButton(page, 'Revenir au préréglage')
        await until(page, () => window.__e2e.appStore.getState().settings.clouds.quality === 'auto')
        assert((await badge('meteo', 'clouds')) === 'Imposé par Maximale', `pastille après le retour : ${await badge('meteo', 'clouds')}`)
        // motion blur: only a quality that lowers the 8 sub-frames is badged
        await set('lens', { shutter: 0.5 })
        await openTab('objectif')
        assert((await badge('objectif', 'shutter')) === null, 'pastille sur le flou de bougé en qualité Maximale')
        await set('video', { quality: 'standard' })
        await until(page, () => document.querySelector('#tab-panel-objectif [data-testid="preset-badge-shutter"]')?.textContent === 'Imposé par Standard')
      } finally {
        await set('clouds', { mode: 'meteo', quality: 'medium' })
        await set('video', { quality: 'high' })
        await set('lens', { shutter: 0 })
      }
    },
  },
  {
    id: 'image-cle',
    title: 'Image clé : la vue orbitée gardée telle quelle, retrouvée exactement par « précédente / suivante », Alt+← / Alt+→ et son losange',
    async run({ page }) {
      await exposeScene(page)
      await blur(page)
      // Space plays / pauses (the logic for a clicked button or a slider is unit-tested: headless Chromium reports
      // focus-visible after a click, unlike a browser used with a mouse)
      const playing = () => page.evaluate(() => window.__e2e.appStore.getState().playback.playing)
      await page.keyboard.press(' ')
      await until(page, () => window.__e2e.appStore.getState().playback.playing === true)
      await page.keyboard.press(' ')
      await until(page, () => window.__e2e.appStore.getState().playback.playing === false)
      assert((await playing()) === false, 'Espace : la lecture ne se met pas en pause')
      await blur(page)
      // 20 s into the film, paused
      await page.keyboard.press('Home')
      await page.keyboard.down('Shift')
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.up('Shift')
      await until(page, () => window.__e2e.appStore.getState().playback.timeS === 20)
      // orbit the view with the mouse, without inertia (the pose read is then the one the button keeps)
      await page.evaluate(() => (window.__e2e.scene.getState().controls.enableDamping = false))
      const film = await cameraPose(page)
      const box = await (await page.$('canvas[data-engine^="three.js"]')).boundingBox()
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
      await page.mouse.move(x, y)
      await page.mouse.down()
      for (let i = 1; i <= 15; i++) await page.mouse.move(x + i * 16, y - i * 3)
      await page.mouse.up()
      await new Promise((resolve) => setTimeout(resolve, 500))
      const orbited = await cameraPose(page)
      assert(poseGap(orbited, film).metres > 100, 'la vue n’a pas tourné sous la souris')

      try {
        await page.click('button[aria-label="Ajouter une image clé"]')
        await until(page, () => window.__e2e.appStore.getState().settings.film.cameraKeys.length === 1)
        await page.waitForSelector('.film-tl__key[aria-label^="Image clé"]', { visible: true, timeout: STEP_MS })
        // the view stays as it was framed
        await expectPose(page, orbited, 20, 'après « Ajouter une image clé »')

        // away (10 s later, the film's camera), then back with « Image clé précédente »
        await blur(page)
        await page.keyboard.down('Shift')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.up('Shift')
        await until(page, () => window.__e2e.appStore.getState().playback.timeS === 30)
        await page.click('button[aria-label="Image clé précédente"]')
        await expectPose(page, orbited, 20, '« Image clé précédente »')
        // from the start with Alt+→, from the end with Alt+←
        await blur(page)
        await page.keyboard.press('Home')
        await until(page, () => window.__e2e.appStore.getState().playback.timeS === 0)
        await page.keyboard.down('Alt')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.up('Alt')
        await expectPose(page, orbited, 20, 'Alt+→')
        await page.keyboard.press('End')
        await page.keyboard.down('Alt')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.up('Alt')
        await expectPose(page, orbited, 20, 'Alt+←')
        // a click on its diamond on the « Plans » track
        await page.keyboard.press('Home')
        await page.click('.film-tl__key')
        await expectPose(page, orbited, 20, 'clic sur le losange')
        assert(await page.evaluate(() => document.querySelector('button[aria-label="Image clé suivante"]').disabled), '« Image clé suivante » active après la dernière')
        // the ◆ between the arrows removes the keyframe under the playhead
        await page.click('button[aria-label="Supprimer l’image clé"]')
        await until(page, () => window.__e2e.appStore.getState().settings.film.cameraKeys.length === 0)
        await page.waitForSelector('button[aria-label="Ajouter une image clé"]', { visible: true, timeout: STEP_MS })
      } finally {
        await page.evaluate(() => (window.__e2e.scene.getState().controls.enableDamping = true))
        await page.keyboard.press('Escape')
        await blur(page)
        await page.keyboard.press('Home')
      }
    },
  },
  {
    id: 'timeline',
    title: 'Timeline : T ajoute un texte, Ctrl+Z le retire, S ajoute un arrêt',
    async run({ page }) {
      await blur(page)
      // into the flyover, away from the opening shot
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.down('Shift')
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.up('Shift')

      const texts = await laneCount(page, 'Textes')
      await page.keyboard.press('t')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n + 1, [texts])
      await page.keyboard.press('Escape')
      await blur(page)
      await page.keyboard.down('Control')
      await page.keyboard.press('z')
      await page.keyboard.up('Control')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n, [texts])

      const stops = await laneCount(page, 'Arrêts')
      await blur(page)
      await page.keyboard.press('s')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Arrêts"] .film-tl__block').length === n + 1, [stops])
      await page.keyboard.press('Escape')
      await blur(page)
      // one text kept for the project round trip
      await page.keyboard.press('t')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n + 1, [texts])
      await page.keyboard.press('Escape')
    },
  },
  {
    id: 'reperes',
    title: 'Repères et points d’intérêt (onglet Carte) : un point au marqueur, son arrêt coché puis décoché, vu sur la timeline',
    async run({ page }) {
      if (await page.evaluate(() => document.getElementById('tab-carte')?.getAttribute('aria-selected') !== 'true')) await page.click('#tab-carte')
      const stops = await laneCount(page, 'Arrêts')
      await clickButton(page, "Point d'intérêt au marqueur")
      const box = '#tab-panel-carte .place input[aria-label^="Arrêt dans le film à « Point d"]'
      await page.waitForSelector(box, { timeout: STEP_MS })
      await page.click(box)
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Arrêts"] .film-tl__block').length === n + 1, [stops])
      await page.click(box)
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Arrêts"] .film-tl__block').length === n, [stops])
      await page.click('#tab-panel-carte button[aria-label^="Supprimer le point d\'intérêt"]')
      await blur(page)
    },
  },
  {
    id: 'region',
    title: 'Plan de situation : la région cherchée dès « Mettre en avant la région », « Réessayer » après un échec',
    async run({ page }) {
      await exposeStores(page)
      // Overpass stubbed in the page: the first is_in query fails, then two areas (no geometry: no highlight drawn)
      await page.evaluate(() => {
        const film = window.__e2e.appStore.getState().settings.film
        const stub = { film, fetch: window.fetch, isIn: 0, fail: true }
        window.__e2e.overpass = stub
        window.fetch = async (input, init) => {
          if (!String(input).includes('/interpreter')) return stub.fetch.call(window, input, init)
          const query = new URLSearchParams(String(init?.body ?? '')).get('data') ?? ''
          const json = (elements) => new Response(JSON.stringify({ elements }), { headers: { 'Content-Type': 'application/json' } })
          if (!query.includes('is_in')) return json([])
          stub.isIn++
          if (stub.fail) return new Response('', { status: 400 })
          const area = (id, name, level, [w, s, e, n]) => ({
            type: 'relation',
            id,
            tags: { boundary: 'administrative', admin_level: level, name },
            bounds: { minlon: w, minlat: s, maxlon: e, maxlat: n },
          })
          return json([area(1, 'Haute-Savoie', '6', [5.8, 45.6, 7.1, 46.4]), area(2, 'Auvergne-Rhône-Alpes', '4', [2, 44.1, 7.2, 46.8])])
        }
      })
      try {
        await page.click('[role="group"][aria-label="Plans"] .film-tl__block')
        await until(page, () => [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.value === 'situation')))
        await page.evaluate(() => {
          const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'situation'))
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'situation')
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await page.click('label::-p-text(Mettre en avant la région)')
        // asked at once, without touching « Lieu »; the failure says so and offers to retry
        const retry = await page.waitForSelector('.dock button::-p-text(Réessayer)', { visible: true, timeout: STEP_MS })
        assert((await page.evaluate(() => window.__e2e.overpass.isIn)) === 1, 'la région n’a pas été cherchée une seule fois')
        await page.evaluate(() => (window.__e2e.overpass.fail = false))
        await retry.click()
        await until(page, () =>
          [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.textContent.startsWith('Haute-Savoie'))),
        )
        assert((await page.evaluate(() => window.__e2e.overpass.isIn)) === 2, 'la région a été cherchée plus de deux fois')
      } finally {
        // the film and the network as they were (the export does not fly over a region view)
        await page.evaluate(() => {
          const { film, fetch } = window.__e2e.overpass
          window.fetch = fetch
          window.__e2e.appStore.getState().setSetting('film', film)
          window.__e2e.appStore.getState().setFilmSelection(null)
        })
      }
    },
  },
  {
    id: 'projet',
    title: 'Projet gardé tout seul et rouvert au rechargement, puis enregistré et ouvert depuis son fichier',
    async run({ page }) {
      const before = { texts: await laneCount(page, 'Textes'), stops: await laneCount(page, 'Arrêts') }
      const since = Date.now() - 1000
      await clickButton(page, 'Enregistrer')
      await page.waitForSelector('.toast::-p-text(Projet enregistré)', { visible: true, timeout: STEP_MS })
      const file = await waitForDownload('.json', since)
      const project = JSON.parse(readFileSync(file.path, 'utf8'))
      assert(Array.isArray(project.tracks) && project.tracks.length === 1, 'le projet enregistré ne contient pas la trace')

      /** the value shown by the « Exposition » row (« Lumière » tab, mounted even when hidden) */
      const exposure = () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('#tab-panel-lumiere .setting-row__head')]
              .find((b) => b.textContent.startsWith('Exposition'))
              ?.querySelector('.setting-row__value').textContent ?? '',
        )
      // the sample is kept in « Mes projets » by itself: a change is written by the autosave (« Enregistré » again)
      if (await page.evaluate(() => document.getElementById('tab-lumiere')?.getAttribute('aria-selected') !== 'true')) {
        await page.click('#tab-lumiere')
      }
      // centred first: scrolled to the top edge, the row would sit under the sticky section title and the click hit it
      await page.$eval('#tab-panel-lumiere .setting-row__head::-p-text(Exposition)', (el) => el.scrollIntoView({ block: 'center' }))
      await page.click('#tab-panel-lumiere .setting-row__head::-p-text(Exposition)')
      await until(page, () => document.activeElement?.matches('#tab-panel-lumiere .setting-row__body input[type="range"]'))
      await page.keyboard.press('ArrowRight')
      await until(page, () => document.querySelector('.topbar__state--dirty'))
      await until(page, () => document.querySelector('.topbar__state')?.textContent === 'Enregistré')
      const changed = await exposure()
      assert(changed.startsWith('+0,5'), `exposition après le changement : ${changed}`)
      await blur(page)

      // the page reloaded (a phone discarding the tab in the background): the project comes back with the change
      await page.reload({ waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('.toast::-p-text(rouvert)', { visible: true, timeout: STEP_MS })
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      const reopened = { exposure: await exposure(), texts: await laneCount(page, 'Textes'), stops: await laneCount(page, 'Arrêts') }
      assert(
        reopened.exposure === changed && reopened.texts === before.texts && reopened.stops === before.stops,
        `projet rouvert différent : avant ${JSON.stringify({ exposure: changed, ...before })}, après ${JSON.stringify(reopened)}`,
      )

      // « Ouvrir » of the top bar: the file saved before the change
      const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: STEP_MS }), page.click('.topbar button::-p-text(Ouvrir)')])
      await chooser.accept([file.path])
      await page.waitForSelector('.toast::-p-text(» ouvert)', { visible: true, timeout: STEP_MS })
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      const after = { exposure: await exposure(), texts: await laneCount(page, 'Textes'), stops: await laneCount(page, 'Arrêts') }
      assert(
        !after.exposure.startsWith('+') && after.texts === before.texts && after.stops === before.stops,
        `projet du fichier différent : avant ${JSON.stringify(before)}, après ${JSON.stringify(after)}`,
      )
    },
  },
  {
    id: 'export',
    title: 'Export : petite vidéo (320 × 180, 2 s, 10 i/s) et image fixe',
    skip: SKIP_EXPORT && 'OPENFLYOVER_E2E_SKIP_EXPORT=1',
    retries: 1,
    async run({ page }) {
      await until(page, () => !!document.querySelector('[role="group"][aria-label="Plans"]'))
      await waitForScene(page)
      await exposeStores(page)
      // after a failed attempt: the previous export stopped first
      await until(
        page,
        () => {
          const { exportStore, isExportBusy } = window.__e2e
          const { phase, cancel } = exportStore.getState()
          if (isExportBusy(phase)) cancel()
          return !isExportBusy(phase)
        },
        undefined,
        EXPORT_MS,
      )
      // no volumetric clouds: far too slow on a software GPU (minutes per frame)
      await page.evaluate(() => {
        const { settings, setSetting } = window.__e2e.appStore.getState()
        setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
      })
      // the export drawer, loaded on its first opening, downloads the finished films: open it first
      await page.click('button.topbar__export')
      await page.waitForSelector('#export-dock:not([hidden]) button::-p-text(Exporter la vidéo)', { visible: true, timeout: STEP_MS })
      // the film: straight into the export store (the panel's sizes start at 720p)
      let since = Date.now() - 1000
      await page.evaluate(() => {
        const { exportStore } = window.__e2e
        exportStore.getState().reset()
        exportStore.getState().start({
          width: 320,
          height: 180,
          fps: 10,
          quality: 'standard',
          durationS: 2,
          holdStartS: 0,
          holdEndS: 0,
          baseName: 'e2e-film',
        })
      })
      const film = await waitForExport(page, 'vidéo')
      assert(film.result.sizeBytes > 0, 'vidéo vide')
      assert(/^video\//.test(film.result.mimeType), `type inattendu ${film.result.mimeType}`)
      assert((await blobSize(page, film.result.url)) === film.result.sizeBytes, 'taille du fichier vidéo incohérente')
      const video = await waitForDownload(film.result.fileName.slice(film.result.fileName.lastIndexOf('.')), since)
      const head = readFileSync(video.path).subarray(0, 12)
      assert(head.includes('ftyp') || head.readUInt32BE(0) === 0x1a45dfa3, 'le fichier vidéo n\'est ni un MP4 ni un WebM')
      log(`    vidéo : ${film.result.fileName}, ${film.result.codec}, ${video.size} octets, ${film.result.incompleteFrames} image(s) incomplète(s)`)
      // the render history recorded it, with its real duration
      const recorded = await page.evaluate(async () => (await import('/src/export/historyStore.ts')).useExportHistory.getState().entries[0])
      assert(recorded?.name === 'e2e-film' && recorded.outcome === 'done', `historique : ${JSON.stringify(recorded)}`)
      assert(recorded.wallMs > 0 && recorded.frames === 20 && recorded.width === 320, `historique : durée ou images : ${JSON.stringify(recorded)}`)

      // the still image: from the export drawer (still open), at its smallest size
      await page.evaluate(() => {
        const select = [...document.querySelectorAll('#export-dock select')].find((s) => [...s.options].some((o) => o.value === '720p'))
        if (!select) throw new Error('sélecteur de résolution introuvable')
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setValue.call(select, '720p')
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      // « Image fixe » is in the « Affiche » mode of the drawer; back to « Vidéo » afterwards (the history is there)
      const exportMode = (label) =>
        page.evaluate((text) => {
          const option = [...document.querySelectorAll('#export-dock label.segmented__option')].find((l) => l.textContent.trim() === text && l.offsetParent)
          if (!option) throw new Error(`mode d'export « ${text} » introuvable`)
          option.querySelector('input').click()
        }, label)
      await exportMode('Affiche')
      since = Date.now() - 1000
      await clickButton(page, 'Image fixe')
      const still = await waitForExport(page, 'image fixe')
      await exportMode('Vidéo')
      assert(still.result.mimeType === 'image/png' && still.result.sizeBytes > 0, `image fixe : ${still.result.mimeType}, ${still.result.sizeBytes} octets`)
      const png = await waitForDownload('.png', since)
      assert(readFileSync(png.path).subarray(1, 4).toString() === 'PNG', "le fichier image n'est pas un PNG")
      log(`    image : ${still.result.fileName}, ${png.size} octets, ${still.result.incompleteFrames} image(s) incomplète(s)`)
    },
  },
  {
    id: 'historique',
    title: 'Historique des rendus : liste, détail, réutilisation annulable, suppression, vidage',
    async run({ page }) {
      await until(page, () => !!document.querySelector('[role="group"][aria-label="Plans"]'))
      await exposeStores(page)
      if (!(await page.$('#export-dock:not([hidden])'))) await page.click('button.topbar__export')
      // « Vidéo » mode: the history is the last child of the panel shown (the batch panel has its own, hidden)
      const H = '#export-dock section:not([hidden]) .export-history'
      await page.waitForSelector(H, { timeout: STEP_MS })
      // two renders as the recorder writes them: an old one with other settings, a failed one
      const before = await page.evaluate(async () => {
        const { history, historyStore: store } = window.__e2e
        const { settings } = window.__e2e.appStore.getState()
        const timings = { rendered: 300, renderMs: 50_000, waitMs: 30_000, encodeMs: 10_000, timeouts: 0 }
        const request = { width: 1920, height: 1080, fps: 60, quality: 'max' }
        const other = { ...settings, shadows: !settings.shadows, camera: { ...settings.camera, style: 'top' }, lens: { ...settings.lens, shutter: 0.5 } }
        store.useExportHistory.getState().clear()
        const base = { timings, encoder: 'webcodecs', frames: 450, encoded: 450, wallMs: 92_400, result: { codec: 'mp4/avc', sizeBytes: 12_000_000 } }
        store.useExportHistory.getState().add(history.entryOf({ ...base, request: { ...request, baseName: 'Film A' }, outcome: 'done', settings: other, at: Date.now() - 60_000 }))
        store.useExportHistory.getState().add(
          history.entryOf({ ...base, request: { ...request, baseName: 'Film B' }, outcome: 'error', error: 'WebGL perdu', result: null, encoded: 12, settings, at: Date.now() }),
        )
        return { fps: settings.video.fps, quality: settings.video.quality, style: settings.camera.style }
      })
      if (!(await page.$eval(H, (d) => d.open))) await page.click(`${H} > summary`)
      await page.waitForSelector(`${H} .history__item`, { visible: true })
      const names = await page.$$eval(`${H} .history__name`, (els) => els.map((e) => e.textContent))
      assert(names.join() === 'Film B,Film A', `ordre de l’historique : ${names.join()}`)
      const meta = await page.$eval(`${H} .history__item:last-child .history__meta`, (e) => e.textContent)
      assert(meta.includes('réussi') && meta.includes('1:32') && meta.includes('0,3\u00a0s\u00a0/\u00a0image'), `ligne de l’historique : ${meta}`)
      assert((await page.$eval(`${H} .history__item:first-child .history__meta`, (e) => e.textContent)).includes('échoué : WebGL perdu'), 'erreur absente de la ligne')
      // detail of the old render, then its settings put back as one step
      await page.click(`${H} .history__item:last-child .history__head`)
      await page.waitForSelector(`${H} .history__item:last-child .history__rows`, { visible: true })
      assert((await page.$eval(`${H} .history__item:last-child .setting-row__body`, (e) => e.textContent)).includes('Vue du dessus'), 'détail : style de caméra absent')
      await page.click(`${H} .history__item:last-child .setting-row__body button.btn`)
      const reused = await page.evaluate(() => {
        const { settings } = window.__e2e.appStore.getState()
        return { fps: settings.video.fps, quality: settings.video.quality, style: settings.camera.style, shutter: settings.lens.shutter }
      })
      assert(reused.fps === 60 && reused.quality === 'max' && reused.style === 'top' && reused.shutter === 0.5, `réglages réutilisés : ${JSON.stringify(reused)}`)
      await clickButton(page, 'Annuler')
      const undone = await page.evaluate(() => {
        const { settings } = window.__e2e.appStore.getState()
        return { fps: settings.video.fps, quality: settings.video.quality, style: settings.camera.style }
      })
      assert(JSON.stringify(undone) === JSON.stringify(before), `annulation d’un coup : ${JSON.stringify(undone)} au lieu de ${JSON.stringify(before)}`)
      // delete one, then clear (confirmed)
      await page.click(`${H} .history__item:first-child .history__head`)
      await page.click(`${H} .history__item:first-child .setting-row__body .project__row .btn:last-child`)
      await until(page, () => document.querySelectorAll('#export-dock section:not([hidden]) .history__item').length === 1)
      // inside the section: a toast has its own « Annuler »
      const inHistory = async (text) => (await page.waitForSelector(`${H} button::-p-text(${text})`, { visible: true })).click()
      await inHistory('Vider l’historique')
      await inHistory('Annuler')
      assert((await page.$$(`${H} .history__item`)).length === 1, 'l’historique est vidé sans confirmation')
      await inHistory('Vider l’historique')
      await inHistory('Vider définitivement')
      await until(page, () => document.querySelectorAll('#export-dock section:not([hidden]) .history__item').length === 0 && !!document.querySelector('#export-dock section:not([hidden]) .export-history .field__hint'))
      assert(await page.evaluate(() => localStorage.getItem('openflyover.exportHistory.v1') === null), 'le stockage n’est pas vidé')
    },
  },
  {
    id: 'mobile',
    title: 'Téléphone (390 × 844, tactile) : aperçu toujours visible, timeline centrée, onglets en demi-feuille, barre contextuelle, export',
    async run({ url, newPage }) {
      // its own page: switching an open page to touch emulation reloads it
      const page = await newPage()
      try {
        // the home screen, not the project left open by the other scenarios
        await page.evaluateOnNewDocument(() => {
          // about:blank, the page's first document, has no storage
          if (location.protocol.startsWith('http')) localStorage.removeItem('openflyover.lastProject.v1')
        })
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
        const tap = async (selector) => (await page.waitForSelector(selector, { visible: true, timeout: STEP_MS })).tap()
        await tap("button::-p-text(Essayer avec l'exemple)")
        // the timeline is open under the preview, its playhead in the middle
        await page.waitForSelector('.film-tl--centred [role="group"][aria-label="Plans"] .film-tl__block', { visible: true, timeout: STEP_MS })
        /** the preview is whole on screen, at least a third of its height */
        const previewShown = () =>
          page.evaluate(() => {
            const r = document.querySelector('.view__viewport').getBoundingClientRect()
            return r.top >= 0 && r.height > innerHeight / 3 && r.width === innerWidth
          })
        assert(await previewShown(), 'l’aperçu n’occupe pas le haut de l’écran')
        /** the open panel or drawer is a half sheet under the preview, as wide as the screen, down to the status bar */
        const isHalfSheet = (selector) =>
          until(
            page,
            (sel) => {
              const sheet = document.querySelector(sel)
              const preview = document.querySelector('.view__viewport')?.getBoundingClientRect()
              const status = document.querySelector('.status')?.getBoundingClientRect()
              if (!sheet || sheet.hidden || !preview || !status) return false
              const r = sheet.getBoundingClientRect()
              return r.width === innerWidth && r.top >= preview.bottom && Math.abs(r.bottom - status.top) < 2 && r.height > 150
            },
            selector,
          )
        /** film time of the playhead, read from the transport row (m:ss,d) */
        const playhead = () =>
          page.evaluate(() => {
            const [m, s] = document.querySelector('.film-tl__time strong').textContent.split(':')
            return Number(m) * 60 + Number(s.replace(',', '.'))
          })
        // previous / add / next keyframe leading the tool row, on screen
        const keyNav = await page.$$eval('.film-tl__tools [aria-label="Images clés"] button', (buttons) =>
          buttons.map((b) => {
            const r = b.getBoundingClientRect()
            return r.width >= 44 && r.left >= 0 && r.right <= innerWidth
          }),
        )
        assert(keyNav.length === 3 && keyNav.every(Boolean), `boutons image clé précédente / ◆ / suivante : ${JSON.stringify(keyNav)}`)
        // a slide on the lanes scrolls them under the playhead: the film time follows
        const before = await playhead()
        const lanes = await page.$eval('.film-tl__scroller', (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.6 }
        })
        await page.touchscreen.touchStart(lanes.x, lanes.y)
        for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(lanes.x - i * 15, lanes.y)
        await page.touchscreen.touchEnd()
        await until(page, (t) => {
          const [m, s] = document.querySelector('.film-tl__time strong').textContent.split(':')
          return Number(m) * 60 + Number(s.replace(',', '.')) > t + 1
        }, before)
        // the eight tabs do not fit: the bar scrolls, and the open tab is brought into sight
        assert(await page.evaluate(() => {
          const bar = document.querySelector('.rail__tabs')
          return bar.scrollWidth > bar.clientWidth
        }), 'la barre d’onglets ne défile pas')
        for (const tab of ['carte', 'projet', 'survol']) {
          await tap(`#tab-${tab}`)
          await until(page, (t) => !document.getElementById(`tab-panel-${t}`)?.hidden, tab)
          await isHalfSheet('#side-panel')
          assert(await previewShown(), `l’onglet ${tab} couvre l’aperçu`)
          if (tab === 'survol') break
          // « Terminé » gives the timeline and the tab bar back
          await tap('#side-panel .sheet-handle__done')
          await until(page, () => document.getElementById('side-panel').hidden)
          await until(
            page,
            (t) => {
              const r = document.getElementById(`tab-${t}`).getBoundingClientRect()
              return r.left >= 0 && r.right <= innerWidth && r.height >= 44
            },
            tab,
          )
        }
        await tap('#tab-panel-survol label:has(input[value="Oiseau"])')
        await until(page, () => document.querySelector('#tab-panel-survol input[value="Oiseau"]')?.checked === true)
        await tap('#side-panel .sheet-handle__done')
        await until(page, () => document.getElementById('side-panel').hidden)
        // the sample has no stop of its own: one at the marker
        await tap('button[aria-label="Ajouter un arrêt à la position du marqueur"]')
        await page.waitForSelector('.film-tl__block--stop', { timeout: STEP_MS })
        // a tap on a stop selects it: its actions take the place of the tab bar; « Modifier » opens its inspector
        await page.$eval('.film-tl__block--stop', (el) => el.scrollIntoView({ block: 'nearest', inline: 'center' }))
        await tap('.film-tl__block--stop')
        await page.waitForSelector('.block-tools button::-p-text(Modifier)', { visible: true, timeout: STEP_MS })
        assert(await page.evaluate(() => document.querySelector('nav.rail').hidden), 'la barre d’onglets est restée sous la barre contextuelle')
        await tap('.block-tools button::-p-text(Modifier)')
        await isHalfSheet('.dock[aria-label="Inspecteur"]')
        assert(await previewShown(), 'l’inspecteur couvre l’aperçu')
        await tap('.dock[aria-label="Inspecteur"] .sheet-handle__done')
        await until(page, () => document.querySelector('.dock[aria-label="Inspecteur"]').hidden && document.querySelector('.block-tools'))
        await tap('.block-tools button::-p-text(Terminé)')
        await until(page, () => !document.querySelector('.block-tools') && !document.querySelector('nav.rail').hidden)
        await tap('button.topbar__export')
        await page.waitForSelector('#export-dock:not([hidden]) button::-p-text(Exporter la vidéo)', { timeout: STEP_MS })
        await isHalfSheet('#export-dock')
        assert(await page.evaluate(() => document.getElementById('side-panel')?.hidden), 'le panneau est resté ouvert sous la feuille d’export')
        const width = await page.evaluate(() => document.documentElement.scrollWidth)
        assert(width === 390, `la page défile horizontalement (${width} px)`)
      } finally {
        await page.close()
      }
    },
  },
]

// ----------------------------------------------------------------------------------------------------- runner

async function startServer() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    // its own dependency cache: a dev server of another session may be running
    cacheDir: join(ROOT, 'node_modules/.vite-e2e'),
    server: { host: '127.0.0.1', port: 5280, strictPort: false, hmr: false, watch: null },
  })
  await server.listen()
  return server
}

async function main() {
  if (!CHROME) throw new Error('Chromium introuvable : indiquez son chemin dans OPENFLYOVER_CHROME')
  const started = Date.now()
  const server = await startServer()
  const url = server.resolvedUrls.local[0]
  log(`Serveur ${url} · navigateur ${CHROME}`)

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: EXPORT_MS,
  })
  const results = []
  try {
    const cdp = await browser.target().createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
    let errors = []
    const record = (text) => {
      if (!ALLOWED_ERRORS.some((re) => re.test(text))) errors.push(text)
    }
    /** a page of the run: its console errors fail the scenario */
    const newPage = async () => {
      const page = await browser.newPage()
      page.setDefaultTimeout(STEP_MS)
      page.on('console', (msg) => {
        // export timings (rendering, waiting for tiles, encoding)
        if (msg.text().startsWith('[export]')) log(`    ${msg.text()}`)
        if (msg.type() !== 'error') return
        const where = msg.location()?.url
        record(`${msg.text()}${where ? ` (${where})` : ''}`)
      })
      page.on('pageerror', (error) => record(`page : ${error.message}`))
      return page
    }
    const page = await newPage()

    for (const scenario of SCENARIOS) {
      if (ONLY.length > 0 && !ONLY.includes(scenario.id)) continue
      if (scenario.skip) {
        log(`- ${scenario.title} : ignoré (${scenario.skip})`)
        results.push({ scenario, status: 'ignoré', ms: 0 })
        continue
      }
      let attempt = 0
      for (;;) {
        errors = []
        const t0 = Date.now()
        try {
          await scenario.run({ page, url, newPage })
          if (errors.length > 0) throw new Error(`erreurs dans la console :\n      ${errors.join('\n      ')}`)
          const ms = Date.now() - t0
          log(`✓ ${scenario.title} (${seconds(ms)}${attempt > 0 ? `, réussi à l'essai ${attempt + 1}` : ''})`)
          results.push({ scenario, status: attempt > 0 ? 'réussi (réessai)' : 'réussi', ms })
          break
        } catch (error) {
          const ms = Date.now() - t0
          const shot = join(OUT, `${scenario.id}-${attempt + 1}.png`)
          await page.screenshot({ path: shot }).catch(() => undefined)
          if (attempt < (scenario.retries ?? 0)) {
            attempt++
            log(`  ${scenario.title} : échec (${error.message}), nouvel essai`)
            continue
          }
          log(`✗ ${scenario.title} (${seconds(ms)})\n    ${error.message}\n    capture : ${shot}`)
          results.push({ scenario, status: 'échec', ms })
          break
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }

  const failed = results.filter((r) => r.status === 'échec').length
  log(`\n${results.length - failed}/${results.length} scénarios sans échec en ${seconds(Date.now() - started)} · fichiers : ${OUT}`)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
