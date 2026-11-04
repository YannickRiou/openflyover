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
 *   OPENFLYOVER_E2E_GPU=1         use the real GPU instead of SwiftShader (quicker on a workstation, not what CI runs)
 *   OPENFLYOVER_E2E_ONLY=a,b      run only the scenarios whose id is listed (ids: see SCENARIOS)
 *
 * Fails on any console error or page error that is not network noise (ALLOWED_ERRORS). Screenshots of failed
 * scenarios and the downloaded files are kept in the output directory printed at the end.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
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
// opt-in, for a quicker local run on a real GPU (WSL: also set MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib)
const GPU = process.env.OPENFLYOVER_E2E_GPU === '1'
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
/** The rail shows five groups of tabs (`TAB_GROUPS`): the tab of a group, then its switch in the panel. */
const GROUP_IDS = ['trace', 'decor', 'camera', 'habillage', 'projet']
const GROUPS = { trace: 'trace', carte: 'decor', meteo: 'decor', lumiere: 'decor', survol: 'camera', objectif: 'camera', habillage: 'habillage', projet: 'projet', reglages: 'projet' }
const TAB_NAMES = { carte: 'Carte', meteo: 'Météo', lumiere: 'Lumière', survol: 'Survol', objectif: 'Objectif', projet: 'Projet', reglages: 'Réglages' }
/**
 * Shows the tab `tab` with its panel unfolded: its group in the rail (a click on the open group would fold the panel), then
 * the button of its switch. A computer opens the first section of a tab and folds the others (their rows are then hidden):
 * the scenarios work on rows, so every section of the tab is opened.
 */
async function showTab(page, tab) {
  const shown = () => page.evaluate((t) => document.querySelector(`[data-testid="tab-panel-${t}"]`)?.getAttribute('role') === 'tabpanel' && !document.querySelector('[data-testid="side-panel"]')?.hidden, tab)
  const openSections = () =>
    page.evaluate((t) => document.querySelectorAll(`[data-testid="tab-panel-${t}"] details[data-panel-section]`).forEach((d) => (d.open = true)), tab)
  if (await shown()) return openSections()
  const group = GROUPS[tab]
  const folded = await page.evaluate((g) => document.querySelector(`[data-testid="tab-${g}"]`)?.getAttribute('aria-selected') === 'true', group)
  if (!folded || (await page.$eval('[data-testid="side-panel"]', (el) => el.hidden))) await page.click(`[data-testid="tab-${group}"]`)
  if (!(await shown())) await page.click(`[data-testid="tab-group-switch"] button::-p-text(${TAB_NAMES[tab]})`)
  await until(page, (t) => document.querySelector(`[data-testid="tab-panel-${t}"]`)?.getAttribute('role') === 'tabpanel', tab)
  await openSections()
}

/** Waits until `fn` (run in the page) returns a truthy value. */
const until = (page, fn, arg, timeout = STEP_MS) => page.waitForFunction(fn, { timeout, polling: 250 }, arg)

/** A modal dialog (shortcuts, sources, Strava, diagnostic report): the page behind it is inert while it is open. */
const MODAL = '[role="dialog"][data-modal]'
const modalClosed = (page) => until(page, (selector) => !document.querySelector(selector), MODAL)

/** Clicks the first visible button whose text contains `text`. */
async function clickButton(page, text, timeout = STEP_MS) {
  const button = await page.waitForSelector(`button::-p-text(${text})`, { visible: true, timeout })
  await button.click()
}

/** The input of the switch labelled `text` in the tab panel `data-testid="tab-panel-<tab>"`. */
async function switchOf(page, tab, text) {
  const handle = await page.evaluateHandle(
    (t, label) => [...document.querySelectorAll(`[data-testid="tab-panel-${t}"] input[role="switch"]`)].find((i) => i.labels?.[0]?.textContent.trim() === label) ?? null,
    tab,
    text,
  )
  const element = handle.asElement()
  assert(element, `interrupteur « ${text} » introuvable dans l'onglet ${tab}`)
  return element
}

/**
 * Picks the option `text` of the select named `label` (its `<label>`, or its `aria-label`) inside `scope`. Desktop Chromium
 * gets the list renderer of the Select primitive: a button that opens a list over the page (the phone's native select is
 * covered by the unit tests).
 */
async function selectOption(page, scope, label, text) {
  const handle = await page.evaluateHandle(
    (s, name) =>
      [...document.querySelectorAll(`${s} button[aria-haspopup="listbox"]`)].find(
        (b) =>
          b.getAttribute('aria-label') === name ||
          (b.getAttribute('aria-labelledby') ?? '').split(' ').some((id) => document.getElementById(id)?.textContent.trim() === name),
      ) ?? null,
    scope,
    label,
  )
  const trigger = handle.asElement()
  assert(trigger, `liste « ${label} » introuvable dans ${scope}`)
  await trigger.click()
  const option = await page.waitForSelector(`[role="listbox"] [role="option"]::-p-text(${text})`, { visible: true, timeout: STEP_MS })
  await option.click()
  await page.waitForSelector('[role="listbox"]', { hidden: true, timeout: STEP_MS })
}

/** Number of stops of the film: the blocks of « Plans » that are neither the opening nor the closing shot. */
const stopCount = (page) =>
  page.evaluate(
    () => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length,
  )

/** Number of blocks in a timeline lane (« Textes », « Médias »…). */
const laneCount = (page, lane) =>
  page.evaluate(
    (name) => document.querySelectorAll(`[role="group"][aria-label="${name}"] [data-testid="timeline-block"]`).length,
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

/** Distance (m), height (m, along y) and angle (°) between two poses. */
function poseGap(a, b) {
  const metres = Math.hypot(...a.position.map((v, i) => v - b.position[i]))
  const dot = Math.min(1, Math.abs(a.quaternion.reduce((sum, v, i) => sum + v * b.quaternion[i], 0)))
  return {
    metres,
    across: Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]),
    height: Math.abs(a.position[1] - b.position[1]),
    degrees: (2 * Math.acos(dot) * 180) / Math.PI,
    fov: Math.abs(a.fov - b.fov),
  }
}

/**
 * Waits until the camera shows `pose` again, the film time at `timeS`: within 5 cm across, 2 m in height and 0.25°.
 * A key is kept above the ground under its aim, and that ground follows the terrain tiles drawn now (`sampleHeight`):
 * back from another part of the film, they can be of another detail, so the same key sits a metre or two higher or
 * lower (seen: 1.5 m and 0.1°, on a camera hundreds of metres from the ground). Across the view, nothing moves.
 */
async function expectPose(page, pose, timeS, label) {
  let gap = null
  for (const end = Date.now() + STEP_MS; Date.now() < end; ) {
    const state = await page.evaluate(() => window.__e2e.appStore.getState().playback)
    gap = poseGap(await cameraPose(page), pose)
    if (Math.abs((state.timeS ?? -1) - timeS) < 1e-3 && gap.across < 0.05 && gap.height < 2 && gap.degrees < 0.25 && gap.fov === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label} : la vue n’est pas celle de l’image clé (${gap.across.toFixed(3)} m à côté, ${gap.height.toFixed(3)} m en hauteur, ${gap.degrees.toFixed(3)}°)`)
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
      await page.waitForSelector('[data-testid="empty-state"]::-p-text(Votre sortie)', { visible: true, timeout: STEP_MS })
      // the home screen: « Projet » alone in the rail, no export
      const homeTabs = await page.$$eval('[role="tablist"] [role="tab"]', (tabs) => tabs.map((t) => t.dataset.testid.replace('tab-', '')))
      assert(homeTabs.join() === 'projet', `onglets de l'accueil : ${homeTabs.join(', ')}`)
      assert(!(await page.$('[data-testid="topbar-export"]')), '« Exporter » est affiché sans trace')
      await clickButton(page, "Essayer avec l'exemple")
      await until(page, () => {
        const lane = document.querySelector('[role="group"][aria-label="Plans"]')
        const text = lane?.textContent ?? ''
        return text.includes('Ouverture') && text.includes('Survol') && text.includes('Clôture')
      })
      assert(!(await page.$('[data-testid="empty-state"]')), "l'accueil est resté affiché après le chargement de l'exemple")
      // the tabs come back, on « Trace »
      await until(page, (all) => [...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((t) => t.dataset.testid.replace('tab-', '')).join() === all, GROUP_IDS.join())
      assert(await page.$eval('[data-testid="tab-trace"]', (t) => t.getAttribute('aria-selected') === 'true'), "l'onglet Trace n'est pas ouvert après l'exemple")
      assert(await page.$('[data-testid="topbar-export"]'), "« Exporter » manque après l'exemple")
      // the project name is a text field named by its label: typing renames the project
      const name = await page.waitForSelector('::-p-aria([name="Nom du projet"])', { visible: true })
      await name.click({ count: 3 })
      await page.keyboard.type('Sortie de test')
      await until(page, () => document.querySelector('header input')?.value === 'Sortie de test')
      await blur(page)
      await waitForScene(page)
    },
  },
  {
    id: 'onglets',
    title: 'Onglets du rail et aide des raccourcis',
    async run({ page }) {
      const shown = await page.$$eval('[role="tablist"] [role="tab"]', (tabs) => tabs.map((t) => t.dataset.testid.replace('tab-', '')))
      assert(shown.join() === GROUP_IDS.join(), `groupes du rail : ${shown.join(', ')}`)
      for (const tab of TABS) {
        await showTab(page, tab)
        await until(
          page,
          (t) => {
            const panel = document.querySelector(`[data-testid="tab-panel-${t}"]`)
            return panel?.getAttribute('role') === 'tabpanel' && !document.querySelector('[data-testid="side-panel"]')?.hidden && panel.getBoundingClientRect().width > 100
          },
          tab,
        )
        // a choice with many options wraps onto rows, it never scrolls sideways (the overlay styles, #61): shown by turning
        // the overlay on for the check
        const overlaySwitch = tab === 'habillage' ? await switchOf(page, 'habillage', "Afficher l'habillage") : null
        if (overlaySwitch && !(await overlaySwitch.evaluate((el) => el.checked))) await overlaySwitch.evaluate((el) => el.click())
        else if (overlaySwitch) await overlaySwitch.dispose()
        // a group of choices: its radio group
        const overflowing = await page.$$eval(
          `[data-testid="tab-panel-${tab}"] [role="radiogroup"]`,
          (groups) => groups.filter((g) => g.scrollWidth > g.clientWidth + 1).length,
        )
        if (overlaySwitch) await overlaySwitch.evaluate((el) => el.checked && el.click())
        assert(overflowing === 0, `onglet ${tab} : ${overflowing} choix qui débordent sur le côté`)
      }
      // the rail is one tab stop: the arrows (vertical), Home and End move the focus and show the tab, wrapping at the ends
      const press = async (key, expected) => {
        await page.keyboard.press(key)
        await until(page, (t) => document.activeElement?.dataset.testid === t && document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.testid === t, expected)
      }
      await page.focus('[data-testid="tab-projet"]')
      assert(await page.$eval('[data-testid="side-panel"]', (el) => !el.hidden), 'le focus clavier sur l’onglet ouvert replie le panneau')
      await press('Home', 'tab-trace')
      await press('ArrowDown', 'tab-decor')
      await press('End', 'tab-projet')
      await press('ArrowDown', 'tab-trace')
      await press('ArrowUp', 'tab-projet')
      const tabStops = await page.$$eval('[role="tablist"] [role="tab"]', (all) => all.filter((t) => t.tabIndex === 0).map((t) => t.dataset.testid))
      assert(tabStops.join() === 'tab-projet', `un seul onglet dans l'ordre de tabulation : ${tabStops.join(', ')}`)
      // the open tab pressed again folds the panel (with the mouse, with Enter), pressed once more shows it
      await page.click('[data-testid="tab-projet"]')
      await until(page, () => document.querySelector('[data-testid="side-panel"]')?.hidden)
      await page.click('[data-testid="tab-projet"]')
      await until(page, () => !document.querySelector('[data-testid="side-panel"]')?.hidden)
      await page.keyboard.press('Enter')
      await until(page, () => document.querySelector('[data-testid="side-panel"]')?.hidden)
      await page.keyboard.press('Enter')
      await until(page, () => !document.querySelector('[data-testid="side-panel"]')?.hidden)
      // « Raccourcis clavier » of the OpenFlyover menu (the logo), then the « ? » key; Escape closes the dialog both times
      await page.click('[data-testid="logo-menu"]')
      await (await page.waitForSelector('[role="menuitem"]::-p-text(Raccourcis clavier)', { visible: true, timeout: STEP_MS })).click()
      await page.waitForSelector(MODAL, { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await modalClosed(page)
      await blur(page)
      await page.keyboard.press('?')
      await page.waitForSelector(MODAL, { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await modalClosed(page)
    },
  },
  {
    id: 'langue',
    title: 'Langue : sélecteur de la barre du haut, anglais, mémorisé, retour au français',
    async run({ page, url, newPage }) {
      const pick = async (name) => {
        await page.click('[data-testid="language-button"]')
        await page.waitForSelector('[role="menuitemradio"]', { visible: true, timeout: STEP_MS })
        await page.evaluate((n) => [...document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent.includes(n))?.click(), name)
      }
      assert(await page.$eval('html', (el) => el.lang === 'fr'), "la page n'est pas en français au départ")
      await pick('English')
      await until(page, () => document.documentElement.lang === 'en' && document.querySelector('[role="group"][aria-label="Shots"]'))
      const tabs = await page.$$eval('[role="tablist"] [role="tab"]', (all) => all.map((t) => t.textContent.trim()))
      assert(tabs.join() === 'Track,Scene,Camera,Overlay,Project', `onglets en anglais : ${tabs.join(', ')}`)
      assert(await page.$('button[data-testid="topbar-export"]::-p-text(Export)'), '« Export » manque dans la barre du haut')
      // remembered on the device: another page of the same browser starts in English
      const second = await newPage()
      try {
        await second.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
        await second.waitForSelector('html[lang="en"]', { timeout: STEP_MS })
      } finally {
        await second.close()
      }
      await pick('Français')
      await until(page, () => document.documentElement.lang === 'fr' && document.querySelector('[role="group"][aria-label="Plans"]'))
    },
  },
  {
    id: 'diagnostic',
    title: 'Rapport de diagnostic (onglet Réglages) : appareil et réglages, sans nom de trace',
    async run({ page }) {
      await showTab(page, 'reglages')
      await page.click('[data-testid="tab-panel-reglages"] [data-testid="setting-row-head"]::-p-text(Diagnostic)')
      await clickButton(page, 'Afficher le rapport')
      await page.waitForSelector(MODAL, { visible: true, timeout: STEP_MS })
      const text = await page.$eval(`${MODAL} pre`, (pre) => pre.textContent)
      for (const part of ['[Appareil]', '[Export]', '[Réglages]', 'Traces : 1,', 'budget.kind : desktop']) {
        assert(text.includes(part), `le rapport ne contient pas « ${part} »`)
      }
      assert(!/Mont-Blanc|Chamonix/i.test(text), 'le rapport contient le nom de la trace')
      await page.keyboard.press('Escape')
      await modalClosed(page)
    },
  },
  {
    id: 'couleur',
    title: 'Couleur (onglet Réglages) : préréglage en un geste, panneau pour une couleur libre, Échap rend le focus',
    async run({ page }) {
      await showTab(page, 'reglages')
      // a preset: one tap, the choice announced as selected
      const indigo = await page.waitForSelector('[role="option"][aria-label="Couleur d\'accentuation : Indigo"]', { visible: true, timeout: STEP_MS })
      await indigo.click()
      await until(page, () => document.documentElement.style.getPropertyValue('--color-accent') === '#4a55b8')
      assert(await indigo.evaluate((el) => el.getAttribute('aria-selected') === 'true'), 'le préréglage choisi n’est pas annoncé comme sélectionné')
      // any other colour: the button opens a panel, a hex colour typed there is applied
      const button = await page.waitForSelector('button[aria-label="Couleur d\'accentuation"]', { visible: true, timeout: STEP_MS })
      await button.click()
      const panel = '[role="dialog"][aria-label="Couleur d\'accentuation"]'
      await page.waitForSelector(panel, { visible: true, timeout: STEP_MS })
      const field = await page.waitForSelector(`${panel} input[aria-label="Code couleur (hexadécimal)"]`, { visible: true, timeout: STEP_MS })
      await field.click()
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('Control')
      await page.keyboard.type('#2f4f6f')
      await page.keyboard.press('Enter')
      await until(page, () => document.documentElement.style.getPropertyValue('--color-accent') === '#2f4f6f')
      // Escape closes the panel first (not the side panel), and the focus goes back to the button
      await page.keyboard.press('Escape')
      await until(page, (selector) => !document.querySelector(selector), panel)
      await until(page, () => document.activeElement?.getAttribute('aria-label') === "Couleur d'accentuation")
      assert(!(await page.$eval('[data-testid="side-panel"]', (el) => el.hidden)), 'Échap sur le panneau de couleur a replié le panneau latéral')
      // back to the default
      await clickButton(page, "Rétablir l'apparence par défaut")
      await until(page, () => document.documentElement.style.getPropertyValue('--color-accent') === '')
    },
  },
  {
    id: 'reglage-repli',
    title: 'Réglage replié (onglet Lumière) : nom et valeur, curseur au clavier, retour par défaut (↺)',
    async run({ page }) {
      await showTab(page, 'lumiere')
      const head = '[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]::-p-text(Exposition)'
      const rowState = () =>
        page.evaluate(() => {
          const button = [...document.querySelectorAll('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]')].find((b) => b.textContent.startsWith('Exposition'))
          const body = button && document.getElementById(button.getAttribute('aria-controls'))
          return button && { expanded: button.getAttribute('aria-expanded'), value: button.querySelector('[data-testid="setting-row-value"]').textContent, hidden: body.hidden }
        })
      const before = await rowState()
      assert(before && before.expanded === 'false' && before.hidden && before.value.startsWith('0'), `ligne Exposition au départ : ${JSON.stringify(before)}`)
      // pressed: the slider shows under the row and takes the focus; the arrows move it, the row says the new value
      await page.click(head)
      await until(page, () => document.activeElement?.matches('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-body"] input[type="range"]'))
      // the slider is named by its label (role + name, not a class), and the arrows move it by one step
      assert(await page.$('::-p-aria([name="Exposition"][role="slider"])'), 'curseur « Exposition » introuvable par son rôle et son nom')
      await page.keyboard.press('ArrowRight')
      await until(page, () => document.querySelector('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-value"][data-modified]')?.textContent.startsWith('+0,5'))
      // End and Home go to the ends of the range
      await page.keyboard.press('End')
      await until(page, () => document.querySelector('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-value"][data-modified]')?.textContent.startsWith('+2,0'))
      await page.keyboard.press('Home')
      await until(page, () => document.querySelector('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-value"][data-modified]')?.textContent.startsWith('−2,0'))
      // the section's ↺ button puts it back
      await page.click('[data-testid="tab-panel-lumiere"] button[aria-label="Rétablir les réglages par défaut : Couleurs"]')
      await until(page, () => !document.querySelector('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-value"][data-modified]'))
      // Enter on the row folds it again
      await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]')].find((b) => b.textContent.startsWith('Exposition')).focus(),
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
      const dot = (tab) => page.evaluate((t) => !!document.querySelector(`[data-testid="tab-${t}"] [data-testid="tab-weight"]`), GROUPS[tab])
      try {
        // clouds « Fine »: three bars, « lourd », and the dot on « Météo »
        await set('clouds', { mode: 'meteo', quality: 'high' })
        await showTab(page, 'meteo')
        await page.waitForSelector('[data-testid="tab-panel-meteo"] [data-testid="setting-row-label"] [data-testid="render-weight"][data-tier="3"]', { timeout: STEP_MS })
        const name = await page.$eval('[data-testid="tab-panel-meteo"] [data-testid="setting-row-label"] [data-testid="render-weight"]', (el) => el.textContent)
        assert(name === 'Poids de rendu : lourd', `nom accessible du pictogramme : ${name}`)
        await until(page, () => !!document.querySelector('[data-testid="tab-decor"] [data-testid="tab-weight"]'))
        // « Aucun »: no pictogram, no dot
        await set('clouds', { mode: 'aucun' })
        await until(page, () => !document.querySelector('[data-testid="tab-panel-meteo"] [data-testid="render-weight"]') && !document.querySelector('[data-testid="tab-decor"] [data-testid="tab-weight"]'))
        // « Moyenne » with the motion blur: the dot moves to « Objectif »
        await set('clouds', { mode: 'meteo', quality: 'medium' })
        assert(!(await dot('meteo')) && !(await dot('objectif')), 'point sur un onglet avec les réglages par défaut')
        await set('lens', { shutter: 0.5 })
        await until(page, () => !!document.querySelector('[data-testid="tab-camera"] [data-testid="tab-weight"]'))
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
        const shown = await page.evaluate((t) => document.querySelector(`[data-testid="tab-panel-${t}"]`)?.offsetParent !== null, tab)
        if (!shown) await showTab(page, tab)
      }
      const badge = (tab, knob) => page.evaluate((t, k) => document.querySelector(`[data-testid="tab-panel-${t}"] [data-testid="preset-badge-${k}"]`)?.textContent ?? null, tab, knob)
      try {
        await set('clouds', { mode: 'meteo', quality: 'auto' })
        await set('video', { quality: 'standard' })
        await openTab('meteo')
        await until(page, () => document.querySelector('[data-testid="tab-panel-meteo"] [data-testid="preset-badge-clouds"]')?.textContent === 'Imposé par Standard')
        // the pictogram weighs the export that will really run: « Rapide » = one bar
        // (the tooltip of the pictogram opens after a short pause under the pointer)
        await (await page.$('[data-testid="tab-panel-meteo"] [data-testid="setting-row-label"] [data-testid="render-weight"]')).hover()
        const tip = await (await page.waitForSelector('[role="tooltip"]', { visible: true, timeout: 10_000 })).evaluate((el) => el.textContent)
        await page.mouse.move(0, 0)
        await page.waitForSelector('[role="tooltip"]', { hidden: true, timeout: 10_000 })
        assert(tip.includes('×16') && tip.includes('imposé par la qualité Standard'), `info-bulle du pictogramme : ${tip}`)
        // another quality in the export settings: the badge follows
        await set('video', { quality: 'max' })
        await until(page, () => document.querySelector('[data-testid="tab-panel-meteo"] [data-testid="preset-badge-clouds"]')?.textContent === 'Imposé par Maximale')
        assert(await page.$('[data-testid="tab-panel-meteo"] [data-testid="render-weight"][data-tier="3"]'), 'pictogramme « lourd » avec des nuages « Fine » imposés')
        // chosen by hand: « Personnalisé », and the project keeps the choice
        await set('clouds', { quality: 'low' })
        await until(page, () => document.querySelector('[data-testid="tab-panel-meteo"] [data-testid="preset-badge-clouds"]')?.textContent === 'Personnalisé')
        // the way back: the row's button
        await page.click('[data-testid="tab-panel-meteo"] [data-testid="setting-row-head"]:has([data-testid="preset-badge-clouds"])')
        await clickButton(page, 'Revenir à « Selon la qualité de l’export »')
        await until(page, () => window.__e2e.appStore.getState().settings.clouds.quality === 'auto')
        assert((await badge('meteo', 'clouds')) === 'Imposé par Maximale', `pastille après le retour : ${await badge('meteo', 'clouds')}`)
        // motion blur: only a quality that lowers the 8 sub-frames is badged
        await set('lens', { shutter: 0.5 })
        await openTab('objectif')
        assert((await badge('objectif', 'shutter')) === null, 'pastille sur le flou de bougé en qualité Maximale')
        await set('video', { quality: 'standard' })
        await until(page, () => document.querySelector('[data-testid="tab-panel-objectif"] [data-testid="preset-badge-shutter"]')?.textContent === 'Imposé par Standard')
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
      // the key is kept above the ground under its aim, read on the tiles drawn: those of this view, all loaded
      await until(page, () => window.__e2e.appStore.getState().terrainStats.pendingVisibleTiles === 0)
      const orbited = await cameraPose(page)
      assert(poseGap(orbited, film).metres > 100, 'la vue n’a pas tourné sous la souris')

      try {
        await page.click('button[aria-label="Ajouter une image clé"]')
        await until(page, () => window.__e2e.appStore.getState().settings.film.cameraKeys.length === 1)
        await page.waitForSelector('[data-testid="timeline-key"][aria-label^="Image clé"]', { visible: true, timeout: STEP_MS })
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
        await page.click('[data-testid="timeline-key"]')
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
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-testid="timeline-block"]').length === n + 1, [texts])
      await page.keyboard.press('Escape')
      await blur(page)
      await page.keyboard.down('Control')
      await page.keyboard.press('z')
      await page.keyboard.up('Control')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-testid="timeline-block"]').length === n, [texts])

      const stops = await stopCount(page)
      await blur(page)
      await page.keyboard.press('s')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length === n + 1, [stops])
      await page.keyboard.press('Escape')
      await blur(page)
      // one text kept for the project round trip
      await page.keyboard.press('t')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-testid="timeline-block"]').length === n + 1, [texts])
      await page.keyboard.press('Escape')
    },
  },
  {
    id: 'inspecteur',
    title: 'Un bloc de la timeline choisi : son inspecteur prend la place du tiroir d’export',
    async run({ page }) {
      await clickButton(page, 'Exporter')
      await page.waitForSelector('[data-testid="export-dock"]:not([hidden])', { timeout: STEP_MS })
      await page.click('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]')
      await page.waitForSelector('aside[aria-label="Inspecteur"]:not([hidden])', { visible: true, timeout: STEP_MS })
      assert(await page.$eval('[data-testid="export-dock"]', (el) => el.hidden), 'le tiroir d’export reste affiché sur l’inspecteur')
      await page.keyboard.press('Escape')
      await until(page, () => document.querySelector('aside[aria-label="Inspecteur"]')?.hidden === true)
      await blur(page)
    },
  },
  {
    id: 'menus',
    title: 'Menus et panneau (« + Ajouter », options du film, clic droit sur la trace) : flèches, Échap avant celui de l’application, clic à côté, actions',
    async run({ page }) {
      await exposeStores(page)
      await waitForScene(page)
      const traceOpen = () =>
        page.evaluate(() => document.querySelector('[data-testid="tab-trace"]')?.getAttribute('aria-selected') === 'true' && !document.querySelector('[data-testid="side-panel"]')?.hidden)
      if (!(await traceOpen())) await showTab(page, 'trace')
      await until(page, () => !document.querySelector('[data-testid="tab-panel-trace"]')?.hidden)
      const inspectorShown = () => page.evaluate(() => document.querySelector('aside[aria-label="Inspecteur"]')?.hidden === false)
      const focusedText = () => page.evaluate(() => document.activeElement?.textContent.trim())
      const gone = (selector) => until(page, (s) => !document.querySelector(s), selector)
      const selectBlock = async () => {
        await page.click('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]')
        await page.waitForSelector('aside[aria-label="Inspecteur"]:not([hidden])', { visible: true, timeout: STEP_MS })
      }

      // « + Ajouter »: a menu of three rows under the button, the arrows move in it
      const add = '[data-testid="tab-panel-trace"] button[aria-haspopup]::-p-text(Ajouter)'
      const addMenu = '[role="menu"][aria-label="Ajouter des traces"]'
      await page.click(add)
      await page.waitForSelector(addMenu, { visible: true, timeout: STEP_MS })
      assert((await page.$$eval(`${addMenu} [role="menuitem"]`, (rows) => rows.map((r) => r.textContent.trim()))).join() === 'Fichiers GPX, FIT, IGC ou KML…,Activités Strava…,Tracer sur la carte…', 'lignes du menu « Ajouter »')
      assert(await page.$eval(add, (b) => b.getAttribute('aria-expanded') === 'true'), '« Ajouter » ne dit pas que son menu est ouvert')
      await page.keyboard.press('ArrowDown')
      assert((await focusedText()) === 'Fichiers GPX, FIT, IGC ou KML…', `flèche bas : ${await focusedText()}`)
      await page.keyboard.press('ArrowDown')
      assert((await focusedText()) === 'Activités Strava…', `flèche bas : ${await focusedText()}`)
      await page.keyboard.press('ArrowUp')
      assert((await focusedText()) === 'Fichiers GPX, FIT, IGC ou KML…', `flèche haut : ${await focusedText()}`)
      // Escape closes the menu first, then the block selected on the timeline (the application's own Escape)
      await page.keyboard.press('Escape')
      await gone(addMenu)
      await selectBlock()
      await page.click(add)
      await page.waitForSelector(addMenu, { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await gone(addMenu)
      assert(await inspectorShown(), 'Échap sur le menu « Ajouter » a aussi désélectionné le bloc')
      await page.keyboard.press('Escape')
      await until(page, () => document.querySelector('aside[aria-label="Inspecteur"]')?.hidden === true)
      // a click beside it closes it; « Activités Strava… » opens its dialog
      await page.click(add)
      await page.waitForSelector(addMenu, { visible: true, timeout: STEP_MS })
      await page.mouse.click(700, 890)
      await gone(addMenu)
      await page.click(add)
      await page.waitForSelector(addMenu, { visible: true, timeout: STEP_MS })
      await page.click(`${addMenu} [role="menuitem"]::-p-text(Strava)`)
      await page.waitForSelector(MODAL, { visible: true, timeout: STEP_MS })
      await gone(addMenu)
      await page.keyboard.press('Escape')
      await modalClosed(page)

      // « Options du film »: a panel above the bar with its own controls, Escape closes it before the selection
      const options = 'button[aria-label="Options du film"]'
      const panel = '[role="dialog"][aria-label="Options du film"]'
      await selectBlock()
      await page.click(options)
      await page.waitForSelector(panel, { visible: true, timeout: STEP_MS })
      assert(await page.$eval(options, (b) => b.getAttribute('aria-expanded') === 'true'), '« Options du film » ne dit pas que son panneau est ouvert')
      assert(await page.$(`${panel} button::-p-text(Ajouter une musique)`), 'bouton « Ajouter une musique… » du panneau')
      assert(
        await page.$$eval(`${panel} input[type="checkbox"]`, (all) => all.some((i) => i.labels?.[0]?.textContent.trim() === 'Arrêts automatiques')),
        'case « Arrêts automatiques » du panneau',
      )
      await page.keyboard.press('Escape')
      await gone(panel)
      assert(await inspectorShown(), 'Échap sur les options du film a aussi désélectionné le bloc')
      await page.keyboard.press('Escape')
      await until(page, () => document.querySelector('aside[aria-label="Inspecteur"]')?.hidden === true)
      await page.click(options)
      await page.waitForSelector(panel, { visible: true, timeout: STEP_MS })
      await page.mouse.click(700, 890)
      await gone(panel)
      await blur(page)

      // right click on the track: a menu at the pointer (the first row focused), a stop added from it, one undo step
      // (the view moves with the playhead: the spot is looked for again each time)
      const rightClickTrack = async () => {
        const spot = await page.evaluate(() => {
          const canvas = document.querySelector('canvas[data-engine^="three.js"]')
          const r = canvas.getBoundingClientRect()
          for (let y = r.top + 4; y < r.bottom; y += 6) {
            for (let x = r.left + 4; x < r.right; x += 6) {
              canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, buttons: 0, pointerType: 'mouse' }))
              if (canvas.style.cursor === 'pointer') return { x, y }
            }
          }
          return null
        })
        assert(spot, 'aucun point de la trace sous le pointeur dans la vue 3D')
        await page.mouse.click(spot.x, spot.y, { button: 'right' })
      }
      const trackMenu = '[role="menu"][aria-label="Ajouter ici"]'
      // the view keeps moving while the spot is scanned: when the click misses the track, look for a spot again
      const openTrackMenu = async () => {
        for (let attempt = 1; ; attempt++) {
          await rightClickTrack()
          try {
            await page.waitForSelector(trackMenu, { visible: true, timeout: 5000 })
            return
          } catch (error) {
            if (attempt === 4) throw error
          }
        }
      }
      await openTrackMenu()
      const rows = await page.$$eval(`${trackMenu} [role="menuitem"]`, (all) => all.map((r) => r.textContent.trim()))
      assert(rows.slice(0, 3).join() === 'Ajouter un arrêt ici,Ajouter un texte ici,Accélérer / ralentir ici', `lignes du menu du clic droit : ${rows.join(', ')}`)
      assert((await focusedText()) === 'Ajouter un arrêt ici', `première ligne du menu du clic droit : ${await focusedText()}`)
      await page.keyboard.press('ArrowDown')
      assert((await focusedText()) === 'Ajouter un texte ici', 'flèche bas dans le menu du clic droit')
      await page.keyboard.press('Escape')
      await gone(trackMenu)
      const stops = await stopCount(page)
      await openTrackMenu()
      await page.click(`${trackMenu} [role="menuitem"]::-p-text(Ajouter un arrêt ici)`)
      await gone(trackMenu)
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length === n + 1, [stops])
      await blur(page)
      await page.keyboard.down('Control')
      await page.keyboard.press('z')
      await page.keyboard.up('Control')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length === n, [stops])
      // « Point d'intérêt ici » turns the menu into the form that names it, its field focused; Escape closes it
      await rightClickTrack()
      await page.waitForSelector(trackMenu, { visible: true, timeout: STEP_MS })
      await page.click(`${trackMenu} [role="menuitem"]::-p-text(Point d'intérêt ici)`)
      await page.waitForSelector('[role="dialog"][aria-label="Point d\'intérêt"] input', { visible: true, timeout: STEP_MS })
      assert(await page.evaluate(() => document.activeElement?.matches('[role="dialog"] input[name="name"]')), 'le champ du nom du point d’intérêt n’a pas le focus')
      await page.keyboard.press('Escape')
      await gone('[role="dialog"][aria-label="Point d\'intérêt"]')
      // a click beside the menu closes it
      await rightClickTrack()
      await page.waitForSelector(trackMenu, { visible: true, timeout: STEP_MS })
      await page.mouse.click(700, 890)
      await gone(trackMenu)
      await blur(page)
    },
  },
  {
    id: 'heure',
    title: 'Réglages › Timeline : « Afficher l’heure enregistrée » montre l’heure de la trace dans la barre de la timeline',
    async run({ page }) {
      await showTab(page, 'reglages')
      const toggle = await switchOf(page, 'reglages', "Afficher l'heure enregistrée")
      assert(!(await page.$('[data-testid="timeline-clock"]')), 'l’heure est affichée avant d’avoir été demandée')
      await toggle.evaluate((el) => el.click())
      await page.waitForSelector('[data-testid="timeline-clock"]', { visible: true, timeout: STEP_MS })
      await toggle.evaluate((el) => el.click())
      await until(page, () => !document.querySelector('[data-testid="timeline-clock"]'))
      await blur(page)
    },
  },
  {
    id: 'cartes',
    title: 'Titre d’ouverture et carte de clôture : blocs de la piste Textes, inspecteur, Suppr les désactive',
    async run({ page }) {
      await showTab(page, 'habillage')
      // each card has its own switch (Habillage › Titres), the overlay switch leaves them alone
      const title = await switchOf(page, 'habillage', "Titre d'ouverture")
      const end = await switchOf(page, 'habillage', 'Carte de clôture')
      const cards = () => page.$$eval('[role="group"][aria-label="Textes"] [data-item^="card-"]', (blocks) => blocks.map((b) => b.getAttribute('title')))
      assert((await cards()).length === 0, 'des cartes sont affichées avec leurs interrupteurs éteints')
      await title.evaluate((el) => el.click())
      await end.evaluate((el) => el.click())
      await until(page, () => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-item^="card-"]').length === 2)
      assert((await cards()).join() === "Titre d'ouverture,Carte de clôture", `blocs de cartes : ${(await cards()).join()}`)
      // the title block opens the panel of the start of the film, the title in its first group
      await page.click('[role="group"][aria-label="Textes"] [data-item="card-title"]')
      await page.waitForSelector('[data-testid="film-inspector"]', { visible: true, timeout: STEP_MS })
      assert((await page.$eval('[data-testid="film-inspector"]', (s) => s.textContent)).includes("Titre d'ouverture"), 'l’inspecteur n’est pas celui du titre')
      await page.keyboard.press('Delete')
      await until(page, () => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-item^="card-"]').length === 1)
      assert(!(await title.evaluate((el) => el.checked)), 'Suppr n’a pas éteint l’interrupteur du titre')
      // back as it was: the closing card off
      await page.keyboard.press('Escape')
      await end.evaluate((el) => el.click())
      await until(page, () => document.querySelectorAll('[role="group"][aria-label="Textes"] [data-item^="card-"]').length === 0)
      await blur(page)
    },
  },
  {
    id: 'cles-etiquettes',
    title: 'Habillage › Étiquettes 3D : une clé crée la piste « Étiquettes », Suppr la retire',
    async run({ page }) {
      await showTab(page, 'habillage')
      const lane = '[role="group"][aria-label="Étiquettes"]'
      assert(!(await page.$(lane)), 'la piste Étiquettes existe sans clé')
      await page.click('button[aria-label="Étiquettes : ajouter une clé"]')
      await page.waitForSelector(`${lane} [data-testid="timeline-key"]`, { visible: true, timeout: STEP_MS })
      await page.click(`${lane} [data-testid="timeline-key"]`)
      await page.keyboard.press('Delete')
      await until(page, () => !document.querySelector('[role="group"][aria-label="Étiquettes"]'))
      await blur(page)
    },
  },
  {
    id: 'reperes',
    title: 'Repères et points d’intérêt (onglet Carte) : un point au marqueur, son arrêt coché puis décoché, vu sur la timeline',
    async run({ page }) {
      await showTab(page, 'carte')
      const stops = await stopCount(page)
      await clickButton(page, "Point d'intérêt au marqueur")
      const box = '[data-testid="tab-panel-carte"] [data-testid="place"] input[aria-label^="Arrêt dans le film à « Point d"]'
      await page.waitForSelector(box, { timeout: STEP_MS })
      await page.click(box)
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length === n + 1, [stops])
      await page.click(box)
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]:not([data-item="opening"]):not([data-item="closing"])').length === n, [stops])
      await page.click('[data-testid="tab-panel-carte"] button[aria-label^="Supprimer le point d\'intérêt"]')
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
          return json([area(1, 'Ariège', '6', [0.8, 42.5, 2.2, 43.4]), area(2, 'Occitanie', '4', [-0.4, 42.3, 4.9, 45.1])])
        }
      })
      try {
        await page.click('[role="group"][aria-label="Plans"] [data-testid="timeline-block"]')
        await page.waitForSelector('aside[aria-label="Inspecteur"] button[aria-haspopup="listbox"]', { visible: true, timeout: STEP_MS })
        await selectOption(page, 'aside[aria-label="Inspecteur"]', 'Style', 'Depuis la région')
        await page.click('label::-p-text(Mettre en avant la région)')
        // asked at once, without touching « Lieu »; the failure says so and offers to retry
        const retry = await page.waitForSelector('aside[aria-label="Inspecteur"] button::-p-text(Réessayer)', { visible: true, timeout: STEP_MS })
        assert((await page.evaluate(() => window.__e2e.overpass.isIn)) === 1, 'la région n’a pas été cherchée une seule fois')
        await page.evaluate(() => (window.__e2e.overpass.fail = false))
        await retry.click()
        await until(page, () =>
          [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.textContent.startsWith('Ariège'))),
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
      const before = { texts: await laneCount(page, 'Textes'), stops: await stopCount(page) }
      const since = Date.now() - 1000
      // headless Chromium cannot answer the File System Access pickers: without them the project is downloaded, and opened
      // through a file input
      await page.evaluate(() => {
        delete window.showSaveFilePicker
        delete window.showOpenFilePicker
      })
      await page.click('[data-testid="topbar-save"]')
      // no toast since the top bar shows the saved state on its icon: the file itself is the proof
      const file = await waitForDownload('.opnflvr', since)
      // 8 bytes: the signature « OPNFLVR » and the version byte, then the gzip of the JSON text
      const project = JSON.parse(gunzipSync(readFileSync(file.path).subarray(8)).toString('utf8'))
      assert(Array.isArray(project.tracks) && project.tracks.length === 1, 'le projet enregistré ne contient pas la trace')

      /** the value shown by the « Exposition » row (« Lumière » tab, mounted even when hidden) */
      const exposure = () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]')]
              .find((b) => b.textContent.startsWith('Exposition'))
              ?.querySelector('[data-testid="setting-row-value"]').textContent ?? '',
        )
      // the sample is kept in « Mes projets » by itself: a change is written by the autosave (« Enregistré » again)
      await showTab(page, 'lumiere')
      // centred first: scrolled to the top edge, the row would sit under the sticky section title and the click hit it
      await page.$eval('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]::-p-text(Exposition)', (el) => el.scrollIntoView({ block: 'center' }))
      await page.click('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-head"]::-p-text(Exposition)')
      await until(page, () => document.activeElement?.matches('[data-testid="tab-panel-lumiere"] [data-testid="setting-row-body"] input[type="range"]'))
      await page.keyboard.press('ArrowRight')
      // the save icon: a dot while the change is not saved, then the accent colour once the autosave wrote it
      await until(page, () => document.querySelector('[data-testid="topbar-save"][data-save-state="unsaved"]'))
      await until(page, () => !document.querySelector('[data-testid="topbar-save"][data-save-state="unsaved"]') && document.querySelector('[data-testid="topbar-save"][data-save-state="saved"]'))
      const changed = await exposure()
      assert(changed.startsWith('+0,5'), `exposition après le changement : ${changed}`)
      await blur(page)

      // the page reloaded (a phone discarding the tab in the background): the project comes back with the change
      await page.reload({ waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('[data-testid="toast"]::-p-text(rouvert)', { visible: true, timeout: STEP_MS })
      // the message closes on its button, inside the one live region
      assert(await page.$('[aria-live] [data-testid="toast"]'), 'message hors de la région live')
      await page.click('[data-testid="toast"] button[aria-label="Fermer le message"]')
      await until(page, () => ![...document.querySelectorAll('[data-testid="toast"]')].some((el) => el.textContent.includes('rouvert') && el.dataset.exiting !== 'true'))
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      const reopened = { exposure: await exposure(), texts: await laneCount(page, 'Textes'), stops: await stopCount(page) }
      assert(
        reopened.exposure === changed && reopened.texts === before.texts && reopened.stops === before.stops,
        `projet rouvert différent : avant ${JSON.stringify({ exposure: changed, ...before })}, après ${JSON.stringify(reopened)}`,
      )

      // « Ouvrir » of the top bar: the file saved before the change (the reload brought the picker back)
      await page.evaluate(() => delete window.showOpenFilePicker)
      const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: STEP_MS }), page.click('header button[aria-label="Ouvrir"]')])
      await chooser.accept([file.path])
      await page.waitForSelector('[data-testid="toast"]::-p-text(» ouvert)', { visible: true, timeout: STEP_MS })
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      const after = { exposure: await exposure(), texts: await laneCount(page, 'Textes'), stops: await stopCount(page) }
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
      await page.click('button[data-testid="topbar-export"]')
      await page.waitForSelector('[data-testid="export-dock"]:not([hidden]) button::-p-text(Exporter la vidéo)', { visible: true, timeout: STEP_MS })
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
      await selectOption(page, '[data-testid="export-dock"]', 'Résolution', '720p')
      // « Image fixe » is in the « Affiche » mode of the drawer; back to « Vidéo » afterwards (the history is there)
      const exportMode = (label) =>
        page.evaluate((text) => {
          const option = [...document.querySelectorAll('[data-testid="export-dock"] label:has(input[type="radio"])')].find((l) => l.textContent.trim() === text && l.offsetParent)
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
      if (!(await page.$('[data-testid="export-dock"]:not([hidden])'))) await page.click('button[data-testid="topbar-export"]')
      // « Vidéo » mode: the history is the last child of the panel shown (the batch panel has its own, hidden). It draws
      // nothing before the first film, so it is waited for once the renders below are written.
      const H = '[data-testid="export-dock"] section:not([hidden]) [data-testid="export-history"]'
      await page.waitForSelector('[data-testid="export-dock"] section:not([hidden])', { timeout: STEP_MS })
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
      await page.waitForSelector(H, { timeout: STEP_MS })
      if (!(await page.$eval(H, (d) => d.open))) await page.click(`${H} > summary`)
      await page.waitForSelector(`${H} [data-testid="history-item"]`, { visible: true })
      const names = await page.$$eval(`${H} [data-testid="history-name"]`, (els) => els.map((e) => e.textContent))
      assert(names.join() === 'Film B,Film A', `ordre de l’historique : ${names.join()}`)
      const meta = await page.$eval(`${H} [data-testid="history-item"]:last-child [data-testid="history-meta"]`, (e) => e.textContent)
      assert(meta.includes('réussi') && meta.includes('1:32') && meta.includes('0,3\u00a0s\u00a0/\u00a0image'), `ligne de l’historique : ${meta}`)
      assert((await page.$eval(`${H} [data-testid="history-item"]:first-child [data-testid="history-meta"]`, (e) => e.textContent)).includes('échoué : WebGL perdu'), 'erreur absente de la ligne')
      // detail of the old render, then its settings put back as one step
      await page.click(`${H} [data-testid="history-item"]:last-child [data-testid="history-head"]`)
      await page.waitForSelector(`${H} [data-testid="history-item"]:last-child [data-testid="history-rows"]`, { visible: true })
      assert((await page.$eval(`${H} [data-testid="history-item"]:last-child [data-testid="history-body"]`, (e) => e.textContent)).includes('Du dessus'), 'détail : style de caméra absent')
      await page.click(`${H} [data-testid="history-item"]:last-child [data-testid="history-body"] button::-p-text(Réutiliser ces réglages)`)
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
      // centred first: scrolled to the top edge, the row would sit under the dock's sticky title and the click hit it
      await page.$eval(`${H} [data-testid="history-item"]:first-child [data-testid="history-head"]`, (el) => el.scrollIntoView({ block: 'center' }))
      await page.click(`${H} [data-testid="history-item"]:first-child [data-testid="history-head"]`)
      await (await page.waitForSelector(`${H} [data-testid="history-item"]:first-child [data-testid="history-body"] button::-p-text(Supprimer)`, { visible: true })).click()
      await until(page, () => document.querySelectorAll('[data-testid="export-dock"] section:not([hidden]) [data-testid="history-item"]').length === 1)
      // inside the section: a toast has its own « Annuler »
      const inHistory = async (text) => (await page.waitForSelector(`${H} button::-p-text(${text})`, { visible: true })).click()
      await inHistory('Vider l’historique')
      await inHistory('Annuler')
      assert((await page.$$(`${H} [data-testid="history-item"]`)).length === 1, 'l’historique est vidé sans confirmation')
      await inHistory('Vider l’historique')
      await inHistory('Vider définitivement')
      // an empty history draws nothing: the whole section goes
      await until(page, () => !document.querySelector('[data-testid="export-dock"] [data-testid="export-history"]'))
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
        // a button that React draws again between the lookup and the touch gives « Node is detached from document »: the touch
        // may have landed on the old one, so a second look is short and, if the button is gone, the step after it tells
        const tap = async (selector) => {
          for (let attempt = 1; ; attempt++) {
            try {
              const button = await page.waitForSelector(selector, { visible: true, timeout: attempt === 1 ? STEP_MS : 3000 })
              return await button.tap()
            } catch (error) {
              if (attempt === 1 && /detached/.test(error.message)) continue
              if (attempt > 1 && error.name === 'TimeoutError') return
              throw error
            }
          }
        }
        await tap("button::-p-text(Essayer avec l'exemple)")
        // the timeline is open under the preview, its playhead in the middle
        await page.waitForSelector('[data-testid="timeline"][data-centred] [role="group"][aria-label="Plans"] [data-testid="timeline-block"]', { visible: true, timeout: STEP_MS })
        /**
         * the preview is whole on screen: the frame of the format at the full width, never under 30 % of the screen height
         * (PHONE_PREVIEW_MIN_SHARE, src/ui/shell.ts: a 16:9 frame on a 390 px phone is only 219 px)
         */
        const previewShown = () =>
          page.evaluate(() => {
            const r = document.querySelector('[role="region"][aria-label="Vue 3D"]').getBoundingClientRect()
            return r.top >= 0 && r.height >= innerHeight * 0.3 - 1 && r.width === innerWidth
          })
        assert(await previewShown(), 'l’aperçu n’occupe pas le haut de l’écran')
        /**
         * the open panel or drawer is a half sheet under the preview, as wide as the screen, down to the status bar; the
         * settings sheet stops above the tab bar since 5.4.0 (another tab is one touch away)
         */
        const isHalfSheet = (selector) =>
          until(
            page,
            (sel) => {
              const sheet = document.querySelector(sel)
              const preview = document.querySelector('[role="region"][aria-label="Vue 3D"]')?.getBoundingClientRect()
              const status = document.querySelector('footer')?.getBoundingClientRect()
              const tabs = document.querySelector('nav[aria-label="Panneaux"]')
              if (!sheet || sheet.hidden || !preview || !status) return false
              const r = sheet.getBoundingClientRect()
              const floors = [status.top, ...(tabs && !tabs.hidden ? [tabs.getBoundingClientRect().top] : [])]
              return r.width === innerWidth && r.top >= preview.bottom && floors.some((y) => Math.abs(r.bottom - y) < 2) && r.height > 150
            },
            selector,
          )
        /** film time of the playhead, read from the transport row (m:ss,d) */
        const playhead = () =>
          page.evaluate(() => {
            const [m, s] = document.querySelector('[data-testid="timeline-time"]').textContent.split(':')
            return Number(m) * 60 + Number(s.replace(',', '.'))
          })
        // the tool row holds three named buttons, all on screen and at least 36 px (the floor of a touch target since the proportional scale of 5.4.0): « Clés », « Ajouter » and the film options
        const tools = await page.$$eval('[data-testid="timeline-tools"] button', (buttons) =>
          buttons.map((b) => {
            const r = b.getBoundingClientRect()
            return { name: b.textContent.trim() || b.getAttribute('aria-label'), ok: r.height >= 36 && r.width >= 36 && r.left >= 0 && r.right <= innerWidth }
          }),
        )
        assert(tools.length === 3 && tools.every((t) => t.ok), `boutons de la barre de la timeline : ${JSON.stringify(tools)}`)
        assert(tools[0].name === 'Clés' && tools[1].name === 'Ajouter', `noms des boutons de la barre de la timeline : ${tools.map((t) => t.name).join()}`)
        // « Clés » opens a sheet with the previous / add / next buttons of the camera keys, on screen and at least 36 px wide
        await tap('[data-testid="timeline-tools"] button::-p-text(Clés)')
        // the group of the desktop row stays in the DOM with no width: only the one that shows counts
        await until(page, () => [...document.querySelectorAll('[role="group"][aria-label="Images clés"]')].some((g) => g.getBoundingClientRect().width > 0))
        const keyNav = await page.evaluate(() =>
          [...document.querySelectorAll('[role="group"][aria-label="Images clés"]')]
            .filter((g) => g.getBoundingClientRect().width > 0)
            .flatMap((g) =>
              [...g.querySelectorAll('button')].map((b) => {
                const r = b.getBoundingClientRect()
                return r.width >= 36 && r.left >= 0 && r.right <= innerWidth
              }),
            ),
        )
        assert(keyNav.length === 3 && keyNav.every(Boolean), `boutons image clé précédente / ◆ / suivante : ${JSON.stringify(keyNav)}`)
        await page.keyboard.press('Escape')
        await until(page, () => ![...document.querySelectorAll('[role="group"][aria-label="Images clés"]')].some((g) => g.getBoundingClientRect().width > 0))
        // a slide on the lanes scrolls them under the playhead: the film time follows
        const before = await playhead()
        const lanes = await page.$eval('[data-testid="timeline-scroller"]', (el) => {
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width * 0.75, y: r.top + r.height * 0.6 }
        })
        await page.touchscreen.touchStart(lanes.x, lanes.y)
        for (let i = 1; i <= 10; i++) await page.touchscreen.touchMove(lanes.x - i * 15, lanes.y)
        await page.touchscreen.touchEnd()
        await until(page, (t) => {
          const [m, s] = document.querySelector('[data-testid="timeline-time"]').textContent.split(':')
          return Number(m) * 60 + Number(s.replace(',', '.')) > t + 1
        }, before)
        // the groups of tabs fit the width of the phone
        assert(await page.evaluate(() => document.querySelector('[role="tablist"]').clientWidth <= innerWidth), 'la barre d’onglets dépasse la largeur de l’écran')
        // the nine tabs show as five groups on a phone: a group opens the tab of it last shown, the first one here
        const GROUP = { carte: 'decor', projet: 'projet', survol: 'camera' }
        for (const tab of ['carte', 'projet', 'survol']) {
          await tap(`[data-testid="tab-${GROUP[tab]}"]`)
          await until(page, (t) => !document.querySelector(`[data-testid="tab-panel-${t}"]`)?.hidden, tab)
          await isHalfSheet('[data-testid="side-panel"]')
          assert(await previewShown(), `l’onglet ${tab} couvre l’aperçu`)
          if (tab === 'survol') break
          // « Terminé » gives the timeline and the tab bar back
          await tap('[data-testid="side-panel"] button[aria-label="Terminé"]')
          await until(page, () => document.querySelector('[data-testid="side-panel"]').hidden)
          await until(
            page,
            (t) => {
              const r = document.querySelector(`[data-testid="tab-${t}"]`).getBoundingClientRect()
              return r.left >= 0 && r.right <= innerWidth && r.height >= 44
            },
            GROUP[tab],
          )
        }
        const motion = (text) => `[data-testid="tab-panel-survol"] [role="radiogroup"][aria-label="Mouvement"] button::-p-text(${text})`
        const motionChecked = (text) =>
          page.evaluate((t) => [...document.querySelectorAll('[data-testid="tab-panel-survol"] [aria-label="Mouvement"] [role="radio"]')].find((b) => b.textContent === t)?.getAttribute('aria-checked') === 'true', text)
        await tap(motion('Balancer'))
        await until(page, () => [...document.querySelectorAll('[aria-label="Mouvement"] [role="radio"]')].some((b) => b.textContent === 'Balancer' && b.getAttribute('aria-checked') === 'true'))
        assert(await motionChecked('Balancer'), 'le mouvement « Balancer » n’est pas choisi')
        await tap('[data-testid="side-panel"] button[aria-label="Terminé"]')
        await until(page, () => document.querySelector('[data-testid="side-panel"]').hidden)
        // the sample has no stop of its own: one at the marker
        await tap('[data-testid="timeline-tools"] button::-p-text(Ajouter)')
        await tap('[role^="menuitem"]::-p-text(Ajouter un arrêt à la position du marqueur)')
        await page.waitForSelector('[data-item^="stop-"]', { timeout: STEP_MS })
        // a tap on a stop selects it: its actions take the place of the tab bar; « Modifier » opens its inspector
        await page.$eval('[data-item^="stop-"]', (el) => el.scrollIntoView({ block: 'nearest', inline: 'center' }))
        await tap('[data-item^="stop-"]')
        await page.waitForSelector('[role="toolbar"][aria-label="Élément sélectionné"] button::-p-text(Modifier)', { visible: true, timeout: STEP_MS })
        assert(await page.evaluate(() => document.querySelector('nav[aria-label="Panneaux"]').hidden), 'la barre d’onglets est restée sous la barre contextuelle')
        await tap('[role="toolbar"][aria-label="Élément sélectionné"] button::-p-text(Modifier)')
        await isHalfSheet('aside[aria-label="Inspecteur"]')
        assert(await previewShown(), 'l’inspecteur couvre l’aperçu')
        await tap('aside[aria-label="Inspecteur"] button[aria-label="Terminé"]')
        await until(page, () => document.querySelector('aside[aria-label="Inspecteur"]').hidden && document.querySelector('[role="toolbar"][aria-label="Élément sélectionné"]'))
        await tap('[role="toolbar"][aria-label="Élément sélectionné"] button::-p-text(Terminé)')
        await until(page, () => !document.querySelector('[role="toolbar"][aria-label="Élément sélectionné"]') && !document.querySelector('nav[aria-label="Panneaux"]').hidden)
        await tap('button[data-testid="topbar-export"]')
        await page.waitForSelector('[data-testid="export-dock"]:not([hidden]) button::-p-text(Exporter la vidéo)', { timeout: STEP_MS })
        await isHalfSheet('[data-testid="export-dock"]')
        assert(await page.evaluate(() => document.querySelector('[data-testid="side-panel"]')?.hidden), 'le panneau est resté ouvert sous la feuille d’export')
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
    args: [...(GPU ? ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--no-sandbox', '--lang=fr', '--window-size=1440,900'],
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
      // a first run follows the browser's language: the scenarios read the French interface (the headless browser may ignore --lang)
      await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] }))
      // the dev server serves hundreds of modules: keep them all in the resource timing list (`exposeScene` reads the fiber module there)
      await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(5000))
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
