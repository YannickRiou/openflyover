import { Suspense, lazy } from 'react'
import { useCoarsePointer } from './coarse'

export interface DateFieldProps {
  /** A day as 'YYYY-MM-DD', or '' for none. */
  value: string
  /** Called with the day as 'YYYY-MM-DD', or '' once every segment is cleared; never with a day left incomplete. */
  onChange(value: string): void
  /** The form it is in does not go on without a day. */
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

const DateFieldPicker = lazy(() => import('./DateFieldPicker'))

/** The browser's own date input, in the look of the app's fields. */
function NativeDate({ value, onChange, className, 'data-testid': testId, required, disabled, ...rest }: DateFieldProps) {
  return (
    <input
      {...rest}
      className={['input', className].filter(Boolean).join(' ')}
      data-testid={testId}
      type="date"
      required={required}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  )
}

/**
 * A day. On a touch screen (`pointer: coarse`) it is the browser's own `<input type="date">`, whose wheel or calendar is made for
 * a finger; elsewhere the day, month and year are typed in their own segments (arrows change one, Backspace takes a character off
 * it) and a button opens a calendar over the page (`DateFieldPicker`, loaded when first shown: the browser's input stands in until
 * then). It follows the language of the application.
 */
export function DateField(props: DateFieldProps) {
  const coarse = useCoarsePointer()
  if (coarse) return <NativeDate {...props} />
  return (
    <Suspense fallback={<NativeDate {...props} />}>
      <DateFieldPicker {...props} />
    </Suspense>
  )
}
