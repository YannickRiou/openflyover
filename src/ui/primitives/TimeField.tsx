import { Suspense, lazy } from 'react'
import { useCoarsePointer } from './coarse'

export interface TimeFieldProps {
  /** A time of day as 'HH:mm' (24 hours), or '' for none. */
  value: string
  /** Called with the time as 'HH:mm', or '' once both segments are cleared; never with a time left incomplete. */
  onChange(value: string): void
  /** The form it is in does not go on without a time. */
  required?: boolean
  disabled?: boolean
  /** Id of the control, for a `<label htmlFor>` (touch screens only: elsewhere name it with `aria-labelledby`). */
  id?: string
  /** Layout of the screen around it (margin, flex share): never colours or sizes. */
  className?: string
  /** The field has no label of its own: one of these names it. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'data-testid'?: string
}

const TimeFieldSegments = lazy(() => import('./TimeFieldSegments'))

/** The browser's own time input, in the look of the app's fields. */
function NativeTime({ value, onChange, className, 'data-testid': testId, required, disabled, ...rest }: TimeFieldProps) {
  return (
    <input
      {...rest}
      className={['input', className].filter(Boolean).join(' ')}
      data-testid={testId}
      type="time"
      required={required}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}

/**
 * A time of day, to the minute. On a touch screen (`pointer: coarse`) it is the browser's own `<input type="time">`, whose wheel
 * is made for a finger; elsewhere the hours and minutes are typed in their own segments (arrows change one, Backspace takes a
 * character off it), loaded when first shown (the browser's input stands in until then). It follows the language of the
 * application (12 or 24 hours); the value is always 'HH:mm'.
 */
export function TimeField(props: TimeFieldProps) {
  const coarse = useCoarsePointer()
  if (coarse) return <NativeTime {...props} />
  return (
    <Suspense fallback={<NativeTime {...props} />}>
      <TimeFieldSegments {...props} />
    </Suspense>
  )
}
