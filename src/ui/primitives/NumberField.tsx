import { Label as HeroLabel } from '@heroui/react/label'
import { NumberField as HeroNumberField } from '@heroui/react/number-field'
import type { ReactNode } from 'react'

export interface NumberFieldProps {
  value: number
  /**
   * Called with the new number when the entry is settled: Enter, leaving the field, the arrows, the wheel. The number is
   * kept within `min` and `max` and on the notches of `step`; an empty or invalid entry puts `value` back and calls nothing.
   */
  onChange(value: number): void
  min: number
  max: number
  step: number
  /** Also call `onChange` with each number typed that is within `min` and `max` (the arrows and the settled entry still apply). */
  live?: boolean
  /** The label above the field; without it, `aria-label` names the field. */
  label?: ReactNode
  disabled?: boolean
  id?: string
  /** Layout of the screen around it (margin, width): never colours or sizes of the field itself. */
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  onFocus?(): void
  onBlur?(): void
}

/** The number typed in the field's own text, or NaN (« - », « 12, », empty). */
function typed(text: string): number {
  return /^\s*[-−+]?\d+([.,]\d*)?\s*$/.test(text) ? Number(text.replace('−', '-').replace(',', '.')) : Number.NaN
}

/** A number typed in a field of the app's look, without the stepper buttons: the arrows still add and remove one `step`. */
export function NumberField({ value, onChange, min, max, step, live, label, disabled, className, ...rest }: NumberFieldProps) {
  return (
    <HeroNumberField
      {...rest}
      className={['field', className].filter(Boolean).join(' ')}
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      formatOptions={{ useGrouping: false }}
      isDisabled={disabled}
      // an empty entry reads as NaN: the value stays
      onChange={(n) => Number.isFinite(n) && n !== value && onChange(n)}
    >
      {label !== undefined && <HeroLabel className="field__label">{label}</HeroLabel>}
      <HeroNumberField.Input
        className="input"
        onKeyDown={(e) => {
          // Escape puts the stored value back in the text, as an edit of the field done by hand
          if (e.key !== 'Escape') return
          const input = e.currentTarget
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(value))
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }}
        onChange={
          live
            ? (e) => {
                const n = typed(e.currentTarget.value)
                if (n >= min && n <= max && n !== value) onChange(n)
              }
            : undefined
        }
      />
    </HeroNumberField>
  )
}
