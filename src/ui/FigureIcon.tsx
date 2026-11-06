import { FIGURE_GRID, MARKER_FIGURE_PATHS } from '../scene/markerFigures'
import type { MarkerFigure } from '../scene/markerSettings'

/** Pictogram of a figure, drawn from the same paths as the marker badge. */
export function FigureIcon({ figure }: { figure: MarkerFigure }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox={`0 0 ${FIGURE_GRID} ${FIGURE_GRID}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKER_FIGURE_PATHS[figure].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
