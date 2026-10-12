import { useId, useRef } from 'react'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
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
 * Position in the frame as a 3 × 3 grid of radio buttons (the arrows move and choose, like native radios). `allowed`
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
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  const choices: readonly OverlayAnchor[] = allowed ?? OVERLAY_ANCHORS
  const isAllowed = (anchor: OverlayAnchor): anchor is A => choices.includes(anchor)
  return (
    <div className="field">
      <span id={`${id}-label`} className="field__label">
        {label}
      </span>
      <div className="anchor-picker">
        <div className="anchor-picker__grid" role="radiogroup" aria-labelledby={`${id}-label`}>
          {OVERLAY_ANCHORS.map((anchor, i) => (
            <button
              key={anchor}
              ref={(el) => {
                cells.current[i] = el
              }}
              type="button"
              role="radio"
              className="anchor-picker__cell"
              aria-checked={anchor === value}
              aria-label={OVERLAY_ANCHOR_LABELS[anchor]}
              disabled={!isAllowed(anchor)}
              tabIndex={anchor === value ? 0 : -1}
              onClick={() => {
                if (isAllowed(anchor)) onChange(anchor)
              }}
              onKeyDown={(e) => {
                const next = nextAllowedIndex(i, e.key, choices)
                if (next === null) return
                e.preventDefault()
                const target = OVERLAY_ANCHORS[next]
                if (isAllowed(target)) onChange(target)
                cells.current[next]?.focus()
              }}
            />
          ))}
        </div>
        <span className="anchor-picker__value" aria-hidden="true">
          {OVERLAY_ANCHOR_LABELS[value]}
        </span>
      </div>
    </div>
  )
}
