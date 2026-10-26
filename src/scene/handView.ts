import { create } from 'zustand'

/**
 * Whether the preview shows the film's own camera, or a view the user moved with the mouse while the film was paused
 * (`away`, set by FlyoverRig); `returns` counts the requests of « Revenir à la vue du film », which FlyoverRig answers
 * by placing the camera again. Preview only: neither saved nor undoable.
 */
export const useHandViewStore = create<{ away: boolean; returns: number; setAway(away: boolean): void; returnToFilm(): void }>()((set) => ({
  away: false,
  returns: 0,
  setAway: (away) => set((s) => (s.away === away ? s : { away })),
  returnToFilm: () => set((s) => ({ returns: s.returns + 1 })),
}))
