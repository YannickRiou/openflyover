import { Checkbox as HeroCheckbox } from '@heroui/react/checkbox'
import type { ReactNode } from 'react'
import { Titled } from './Titled'

export interface CheckboxProps {
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
  /** Native tooltip over the whole control (typically why it is disabled). */
  title?: string
  id?: string
  /** Layout of the screen around it (margin, flex share): never colours or sizes of the control itself. */
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** The label; without it, `aria-label` names the box. */
  children?: ReactNode
}

/** A tick box and its label (the whole row is the target). */
export function Checkbox({ checked, onChange, disabled, title, children, ...rest }: CheckboxProps) {
  return (
    <Titled title={title}>
      <HeroCheckbox {...rest} isSelected={checked} onChange={onChange} isDisabled={disabled}>
        <HeroCheckbox.Content>
          <HeroCheckbox.Control>
            <HeroCheckbox.Indicator />
          </HeroCheckbox.Control>
          {children !== undefined && <span>{children}</span>}
        </HeroCheckbox.Content>
      </HeroCheckbox>
    </Titled>
  )
}
