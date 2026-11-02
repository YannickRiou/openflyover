/**
 * Search of the settings (Ctrl+K), pure logic: the sections of the panels that the search can open, and the matching of what the
 * person types against their titles (no accents, no case, every word must be found). The section titles are the ones of
 * `PanelSection`, which carries them in `data-panel-section` so that `revealSection` can find the section on the screen.
 */
import { t } from '../i18n'
import type { MessageKey } from '../i18n'
import type { ShellTab, UiMode } from './shell'
import { modeAtLeast } from './uiMode'

interface SectionEntry {
  tab: ShellTab
  title: MessageKey
  /** the lowest mode that shows the section (the `min` of its `PanelSection`); none: every mode */
  min?: UiMode
}

/** The sections, in the order of the tabs and of the panels (the order of an empty search). */
const SECTIONS: readonly SectionEntry[] = [
  { tab: 'trace', title: 'marker.track.title' },
  { tab: 'trace', title: 'marker.section.title' },
  { tab: 'carte', title: 'light.map.background' },
  { tab: 'carte', title: 'light.map.terrain' },
  { tab: 'carte', title: 'landmarks.title', min: 'confirme' },
  { tab: 'meteo', title: 'shell.section.weather', min: 'confirme' },
  { tab: 'meteo', title: 'light.weather.clouds', min: 'confirme' },
  { tab: 'meteo', title: 'light.weather.rainMist', min: 'expert' },
  { tab: 'meteo', title: 'light.weather.snow', min: 'confirme' },
  { tab: 'lumiere', title: 'light.atmosphere.title', min: 'expert' },
  { tab: 'lumiere', title: 'light.atmosphere.sun', min: 'confirme' },
  { tab: 'lumiere', title: 'light.nights.title', min: 'confirme' },
  { tab: 'lumiere', title: 'light.grading.title', min: 'confirme' },
  { tab: 'survol', title: 'camera.panel.camera' },
  { tab: 'survol', title: 'camera.panel.durationSection' },
  { tab: 'objectif', title: 'lens.title', min: 'expert' },
  { tab: 'habillage', title: 'overlay.panel.title' },
  { tab: 'habillage', title: 'overlay.panel.titles' },
  { tab: 'habillage', title: 'overlay.panel.labels3d', min: 'confirme' },
  { tab: 'habillage', title: 'overlay.panel.counters', min: 'confirme' },
  { tab: 'habillage', title: 'overlay.panel.profileMinimap', min: 'confirme' },
  { tab: 'habillage', title: 'overlay.panel.weatherLogoText', min: 'confirme' },
  { tab: 'habillage', title: 'overlay.panel.credits', min: 'expert' },
  { tab: 'projet', title: 'shell.section.offline' },
  { tab: 'reglages', title: 'settings.preferences.appearance.title' },
  { tab: 'reglages', title: 'settings.preferences.statusBar.title' },
  { tab: 'reglages', title: 'settings.preferences.timeline.title' },
  { tab: 'reglages', title: 'settings.preferences.preview.title' },
]

export interface SectionMatch {
  tab: ShellTab
  /** the title of the section, as shown by `PanelSection` */
  title: string
  /** the name of its tab */
  tabLabel: string
  /** the mode that shows it, when the current mode does not */
  needs?: UiMode
}

/** Lower case without accents: « Météo » and « meteo » are the same word. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** How well `word` matches `title`: 0 title starts with it, 1 a word of the title starts with it, 2 it is inside, null absent. */
function rank(title: string, word: string): number | null {
  if (title.startsWith(word)) return 0
  if (title.includes(` ${word}`)) return 1
  return title.includes(word) ? 2 : null
}

/**
 * The sections of the `tabs` that match `query`: every word of the query must be in the title or in the name of the tab; best
 * matches first, then the order of the panels. An empty query lists every section, the ones the `mode` hides too.
 */
export function searchSections(query: string, tabs: readonly ShellTab[], mode: UiMode = 'expert'): SectionMatch[] {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  const found: { match: SectionMatch; score: number; order: number }[] = []
  SECTIONS.forEach((entry, order) => {
    if (!tabs.includes(entry.tab)) return
    const title = t(entry.title)
    const tabLabel = t(`shell.tab.${entry.tab}`)
    const folded = foldText(title)
    const foldedTab = foldText(tabLabel)
    let score = 0
    for (const word of words) {
      const own = rank(folded, word)
      const inTab = rank(foldedTab, word)
      // the title weighs more than the name of the tab
      const best = own ?? (inTab === null ? null : inTab + 3)
      if (best === null) return
      score += best
    }
    found.push({ match: { tab: entry.tab, title, tabLabel, needs: entry.min && !modeAtLeast(mode, entry.min) ? entry.min : undefined }, score, order })
  })
  return found.sort((a, b) => a.score - b.score || a.order - b.order).map((f) => f.match)
}

/** The section titled `title` is on the screen: a section a mode hides is not drawn (unless one of its settings is modified). */
export function isSectionShown(title: string): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('details[data-panel-section]')).some((d) => d.dataset.panelSection === title)
}

/** How long the section found stays outlined (ms). */
const FOUND_MS = 1600

/**
 * Opens the section titled `title` on the screen, scrolls it into view and outlines it for a moment. False when it is not
 * there (a section that its panel shows only in some cases).
 */
export function revealSection(title: string): boolean {
  const section = Array.from(document.querySelectorAll<HTMLDetailsElement>('details[data-panel-section]')).find((d) => d.dataset.panelSection === title)
  if (!section) return false
  section.open = true
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  section.scrollIntoView?.({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  section.classList.add('section-found')
  window.setTimeout(() => section.classList.remove('section-found'), FOUND_MS)
  return true
}
