import { Input as HeroInput } from '@heroui/react/input'
import { Label as HeroLabel } from '@heroui/react/label'
import { TextField as HeroTextField } from '@heroui/react/textfield'
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react'
import { Titled } from './Titled'

export interface TextFieldProps {
  value: string
  /** Called with the new text on every keystroke. */
  onChange(value: string): void
  /** The label above the field; without it, `aria-label` names the field. */
  label?: ReactNode
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  autoFocus?: boolean
  autoComplete?: string
  /** Native tooltip over the whole field. */
  title?: string
  id?: string
  /** Layout of the screen around it (margin, flex share): never colours or sizes of the field itself. */
  className?: string
  /** Classes of the input itself, for a field that does not take the app's `.input` look (the project name on the top bar). */
  inputClassName?: string
  'aria-label'?: string
  'aria-describedby'?: string
  onFocus?(event: FocusEvent<HTMLInputElement>): void
  onBlur?(event: FocusEvent<HTMLInputElement>): void
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void
}

/** A line of text, with its label above it when it has one. HeroUI's `.input` is the project's `.input` (theme.css): the look is the app's. */
export function TextField({ value, onChange, label, placeholder, disabled, maxLength, title, className, inputClassName, ...rest }: TextFieldProps) {
  return (
    <Titled title={title}>
      <HeroTextField {...rest} className={['field', className].filter(Boolean).join(' ')} value={value} onChange={onChange} isDisabled={disabled}>
        {label !== undefined && <HeroLabel className="field__label">{label}</HeroLabel>}
        <HeroInput className={inputClassName} placeholder={placeholder} maxLength={maxLength} />
      </HeroTextField>
    </Titled>
  )
}
