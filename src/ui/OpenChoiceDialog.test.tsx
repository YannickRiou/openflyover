// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setLanguage } from '../i18n'
import { OpenChoiceDialog } from './OpenChoiceDialog'
import { askOpenChoice, askUnsavedChanges, dismissOpenQuestions, useOpenChoiceStore } from './openChoice'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLanguage('fr')
})

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))

const roots: Root[] = []

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<OpenChoiceDialog />))
  roots.push(root)
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const buttons = () => [...dialog()!.querySelectorAll('button')].map((b) => b.textContent)
const press = (label: string) => act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === label)!.click())

describe('OpenChoiceDialog', () => {
  afterEach(async () => {
    useOpenChoiceStore.setState({ choice: null, unsaved: null })
    await settle()
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    document.body.innerHTML = ''
  })

  it('asks « Que faire de ce fichier ? » with the three answers, focus on « Ajouter la trace à ce projet »', async () => {
    await mount()
    expect(dialog()).toBeNull()
    const answer = askOpenChoice(['a.gpx'])
    await settle()
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Que faire de ce fichier ?')
    expect(dialog()!.textContent).toContain('« a.gpx »')
    expect(buttons().filter((label) => !!label)).toEqual(['Ajouter la trace à ce projet', 'Commencer un nouveau projet', 'Annuler'])
    expect(document.activeElement?.textContent).toBe('Ajouter la trace à ce projet')
    await press('Commencer un nouveau projet')
    expect(await answer).toBe('new')
    await settle()
    expect(dialog()).toBeNull()
  })

  it('says it once for several files, and every button gives its answer', async () => {
    await mount()
    let answer = askOpenChoice(['a.gpx', 'b.fit'])
    await settle()
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Que faire de ces fichiers ?')
    expect(buttons()).toContain('Ajouter les traces à ce projet')
    await press('Ajouter les traces à ce projet')
    expect(await answer).toBe('add')
    await settle()
    answer = askOpenChoice(['a.gpx'])
    await settle()
    await press('Annuler')
    expect(await answer).toBe('cancel')
  })

  it('Escape cancels', async () => {
    await mount()
    const answer = askOpenChoice(['a.gpx'])
    await settle()
    await act(async () => void dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(await answer).toBe('cancel')
  })

  it('Escape on « Fermer sans enregistrer ? » keeps the project', async () => {
    await mount()
    const answer = askUnsavedChanges('Les changements de « Rando » ne sont pas enregistrés.')
    await settle()
    await act(async () => void dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(await answer).toBe('cancel')
  })

  it('a new question cancels the one still open, whichever it is', async () => {
    const first = askOpenChoice(['a.gpx'])
    const second = askOpenChoice(['b.gpx'])
    expect(await first).toBe('cancel')
    const unsaved = askUnsavedChanges('x')
    dismissOpenQuestions()
    expect(await unsaved).toBe('cancel')
    // the dismissal took the second question too
    expect(await second).toBe('cancel')
  })

  it('asks « Fermer sans enregistrer ? » for a new project that would lose changes', async () => {
    await mount()
    const answer = askUnsavedChanges('Les changements de « Rando » ne sont pas enregistrés.')
    await settle()
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Fermer sans enregistrer ?')
    expect(dialog()!.textContent).toContain('Les changements de « Rando » ne sont pas enregistrés.')
    await press('Fermer sans enregistrer')
    expect(await answer).toBe('close')
  })
})
