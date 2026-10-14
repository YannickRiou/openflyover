import { useId } from 'react'
import type { KeyboardEvent } from 'react'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { Radio, RadioGroup } from './primitives'
import { nextGridIndex } from './shell'

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
      <span id={`${id}-label`} className="field__label">
        {label}
      </span>
      <div className="anchor-picker" onKeyDownCapture={onKeyDownCapture}>
        <RadioGroup
          look="plain"
          className="anchor-picker__grid"
          aria-labelledby={`${id}-label`}
          value={value}
          onChange={(anchor) => {
            if (isAllowed(anchor as OverlayAnchor)) onChange(anchor as A)
          }}
        >
          {OVERLAY_ANCHORS.map((anchor) => (
            <Radio key={anchor} value={anchor} className="anchor-picker__cell" aria-label={OVERLAY_ANCHOR_LABELS[anchor]} disabled={!isAllowed(anchor)} />
          ))}
        </RadioGroup>
        <span className="anchor-picker__value" aria-hidden="true">
          {OVERLAY_ANCHOR_LABELS[value]}
        </span>
      </div>
    </div>
  )
}
