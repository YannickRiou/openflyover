// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHELL_TABS } from './shell'
import { foldText, isSectionShown, revealSection, searchSections } from './searchSections'

describe('foldText', () => {
  it('drops the accents and the case', () => {
    expect(foldText('Météo Lumière')).toBe('meteo lumiere')
  })
})

describe('searchSections', () => {
  it('lists every section of the tabs given for an empty query, in the order of the panels', () => {
    const all = searchSections('', SHELL_TABS)
    expect(all[0].tab).toBe('trace')
    expect(all.at(-1)?.tab).toBe('reglages')
    expect(searchSections('  ', ['projet']).map((m) => m.title)).toEqual(['Hors ligne'])
  })

  it('finds a section without the accents or the case, best match first', () => {
    const found = searchSections('NUAGES', SHELL_TABS)
    expect(found[0]).toMatchObject({ tab: 'meteo', title: 'Nuages' })
    expect(searchSections('meteo', SHELL_TABS)[0].title).toBe('Météo de la sortie')
  })

  it('needs every word, in the title or in the name of the tab', () => {
    expect(searchSections('pluie brume', SHELL_TABS).map((m) => m.title)).toEqual(['Pluie et brume'])
    expect(searchSections('soleil lumiere', SHELL_TABS).map((m) => m.title)).toContain('Soleil')
    expect(searchSections('nuages zzz', SHELL_TABS)).toEqual([])
  })

  it('finds a section by the settings it holds', () => {
    expect(searchSections('vives', SHELL_TABS)[0]).toMatchObject({ tab: 'carte', title: 'Fond de carte' })
  })

  it('finds « Caméra » by « mouvement » and « hauteur », and by the older words', () => {
    for (const word of ['mouvement', 'hauteur', 'préréglage', 'style', 'distance', 'inclinaison']) {
      expect(searchSections(word, SHELL_TABS)[0], word).toMatchObject({ tab: 'survol', title: 'Caméra' })
    }
  })

  it('skips the tabs that are not shown', () => {
    expect(searchSections('nuages', ['projet'])).toEqual([])
  })

  it('finds the sections a mode hides, and tells the mode that has them', () => {
    expect(searchSections('pluie', SHELL_TABS, 'debutant')[0]).toMatchObject({ title: 'Pluie et brume', needs: 'expert' })
    expect(searchSections('nuages', SHELL_TABS, 'debutant')[0]).toMatchObject({ title: 'Nuages', needs: 'confirme' })
    expect(searchSections('nuages', SHELL_TABS, 'confirme')[0].needs).toBeUndefined()
    expect(searchSections('pluie', SHELL_TABS, 'confirme')[0].needs).toBe('expert')
    expect(searchSections('pluie', SHELL_TABS)[0].needs).toBeUndefined()
    // a section every mode shows needs nothing
    expect(searchSections('Fond de carte', SHELL_TABS, 'debutant')[0].needs).toBeUndefined()
  })
})

describe('revealSection', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('opens the section, outlines it for a moment, and reports a missing one', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<details data-panel-section="Nuages"><summary>Nuages</summary></details>'
    const section = document.querySelector('details') as HTMLDetailsElement
    expect(revealSection('Nuages')).toBe(true)
    expect(section.open).toBe(true)
    expect(section.classList.contains('section-found')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(section.classList.contains('section-found')).toBe(false)
    expect(revealSection('Absente')).toBe(false)
  })
})

describe('isSectionShown', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is true for a section drawn, false for one that a mode leaves out', () => {
    document.body.innerHTML = '<details data-panel-section="Nuages"><summary>Nuages</summary></details>'
    expect(isSectionShown('Nuages')).toBe(true)
    expect(isSectionShown('Pluie et brume')).toBe(false)
  })
})
