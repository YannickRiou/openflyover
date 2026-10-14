import { useId } from 'react'
import type { KeyboardEvent } from 'react'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { Radio, RadioGroup } from './primitives'
import { nextGridIndex } from './shell'

/** The 3 × 3 grid, drawn as a small frame (44 px cells on a touch screen). */
const GRID = 'grid flex-none grid-cols-[repeat(3,28px)] auto-rows-[18px] gap-1 rounded-sm border border-edge bg-surface-control p-1 touch:grid-cols-[repeat(3,44px)] touch:auto-rows-[44px]'
/** A cell is a Radio: a dot in the middle, the accent when chosen, only the dot (faint) when it cannot be chosen. */
const CELL =
  'relative block cursor-pointer rounded-[2px] bg-surface-panel p-0 before:absolute before:top-1/2 before:left-1/2 before:size-1.5 before:-translate-1/2 before:rounded-full before:bg-line ' +
  'not-data-[disabled=true]:hover:before:bg-text-2 data-[selected=true]:bg-brand data-[selected=true]:before:bg-surface-control ' +
  'data-[disabled=true]:cursor-default data-[disabled=true]:bg-transparent data-[disabled=true]:opacity-100 data-[disabled=true]:before:opacity-40'
/** Its label is stretched over it; the native radio inside is hidden. */
const CELL_LABEL =
  'absolute inset-0 block rounded-[inherit] data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-1 data-[focus-visible=true]:outline-brand'

/** Cell reached from `current` by `key`, skipping the cells not in `allowed`; null for another key, `current` at an edge. */
function nextAllowedIndex(current: number, key: string, allowed: readonly OverlayAnchor[]): number | null {
  let index = current
  for (;;) {
    const next = nextGridIndex(index, key, 3, OVERLAY_ANCHORS.length)
    if (next === null) return null
    if (next === index) return current
    if (allowed.includes(OVERLAY_ANCHORS[next])) return next
    index = next
  }
}

/**
 * Position in the frame as a 3 × 3 grid of radio buttons (the arrows move and choose, by row and column). `allowed`
 * limits the choice (e.g. the four corners of the source credits): the other cells are shown but disabled and skipped.
 */
export function AnchorPicker<A extends OverlayAnchor>({
  label,
  value,
  allowed,
  onChange,
}: {
  label: string
  value: A
  /** the cells that can be chosen; default: all nine */
  allowed?: readonly A[]
  onChange(anchor: A): void
}) {
  const id = useId()
  const choices: readonly OverlayAnchor[] = allowed ?? OVERLAY_ANCHORS
  const isAllowed = (anchor: OverlayAnchor): anchor is A => choices.includes(anchor)
  // a radio group moves along its list: the grid takes the arrows first, to move by row and column
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    const cells = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    const from = cells.indexOf(e.target as HTMLInputElement)
    const next = from < 0 ? null : nextAllowedIndex(from, e.key, choices)
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    const target = OVERLAY_ANCHORS[next]
    if (isAllowed(target)) onChange(target)
    cells[next].focus()
  }
  return (
    <div className="field">
      <span id={`${id}-label`} className="type-label">
        {label}
      </span>
      <div className="flex items-center gap-3" onKeyDownCapture={onKeyDownCapture}>
        <RadioGroup
          look="plain"
          className={GRID}
          aria-labelledby={`${id}-label`}
          value={value}
          onChange={(anchor) => {
            if (isAllowed(anchor as OverlayAnchor)) onChange(anchor as A)
          }}
        >
          {OVERLAY_ANCHORS.map((anchor) => (
            <Radio key={anchor} value={anchor} className={CELL} labelClassName={CELL_LABEL} aria-label={OVERLAY_ANCHOR_LABELS[anchor]} disabled={!isAllowed(anchor)} />
          ))}
        </RadioGroup>
        <span className="type-hint" aria-hidden="true">
          {OVERLAY_ANCHOR_LABELS[value]}
        </span>
      </div>
    </div>
  )
}
