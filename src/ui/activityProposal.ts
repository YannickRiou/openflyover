/** The activity proposed after the first import of a project (`ActivityDialog`): the figure read from the file, null when nothing is proposed. */
import { create } from 'zustand'
import type { MarkerFigure } from '../scene/markerSettings'

export const useActivityProposal = create<{ figure: MarkerFigure | null }>(() => ({ figure: null }))

export function proposeActivity(figure: MarkerFigure | null): void {
  useActivityProposal.setState({ figure })
}
