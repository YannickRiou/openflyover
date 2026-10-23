/**
 * The questions asked when GPX / FIT files are opened while the project holds tracks: « Que faire de ce fichier ? »
 * (`askOpenChoice`), then « Fermer sans enregistrer ? » when starting a new project would lose changes
 * (`askUnsavedChanges`). `OpenChoiceDialog` shows them.
 */
import { create } from 'zustand'
import type { CloseAnswer } from './projectActions'

/** Add the tracks to the open project, start a new project with them, or leave everything as it is. */
export type OpenChoice = 'add' | 'new' | 'cancel'

export interface OpenQuestion {
  names: readonly string[]
  answer(choice: OpenChoice): void
}

export interface UnsavedQuestion {
  text: string
  answer(answer: CloseAnswer): void
}

export const useOpenChoiceStore = create<{ choice: OpenQuestion | null; unsaved: UnsavedQuestion | null }>(() => ({
  choice: null,
  unsaved: null,
}))

/** Cancel the question being shown, if any: new files arrived, or the project it was about changed. */
export function dismissOpenQuestions(): void {
  const { choice, unsaved } = useOpenChoiceStore.getState()
  choice?.answer('cancel')
  unsaved?.answer('cancel')
}

/** Ask what to do with the files named `names`; a question still open is cancelled. */
export function askOpenChoice(names: readonly string[]): Promise<OpenChoice> {
  dismissOpenQuestions()
  return new Promise((resolve) =>
    useOpenChoiceStore.setState({
      choice: {
        names,
        answer(choice) {
          useOpenChoiceStore.setState({ choice: null })
          resolve(choice)
        },
      },
    }),
  )
}

/** The question of closing the open project with changes saved nowhere (`text`: what would be lost). */
export function askUnsavedChanges(text: string): Promise<CloseAnswer> {
  useOpenChoiceStore.getState().unsaved?.answer('cancel')
  return new Promise((resolve) =>
    useOpenChoiceStore.setState({
      unsaved: {
        text,
        answer(answer) {
          useOpenChoiceStore.setState({ unsaved: null })
          resolve(answer)
        },
      },
    }),
  )
}
