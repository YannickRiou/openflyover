// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHELL_TABS } from './shell'
import { foldText, revealSection, searchSections } from './settingsSearch'

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

  it('skips the tabs that are not shown', () => {
    expect(searchSections('nuages', ['projet'])).toEqual([])
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
