/** Whether the « Film automatique » dialog is open: one dialog (`AutoFilmSection`), opened from the « Survol » tab or from the message after an import. */
import { create } from 'zustand'

export const useAutoFilmOpen = create<{ open: boolean }>(() => ({ open: false }))

export function setAutoFilmOpen(open: boolean): void {
  useAutoFilmOpen.setState({ open })
}
