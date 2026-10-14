import { Checkbox as HeroCheckbox } from '@heroui/react/checkbox'
import type { CheckboxProps } from './Checkbox'
import { Titled } from './Titled'

/**
 * One of several choices, as a pill that is ticked when chosen (landmark kinds, counters). Put them in a
 * `<div className="chips">`; a single choice among pills is a `RadioGroup` with `look="chips"`.
 */
export type ChipProps = CheckboxProps

export function Chip({ checked, onChange, disabled, title, className, children, ...rest }: ChipProps) {
  return (
    <Titled title={title}>
      <HeroCheckbox {...rest} className={['chip', className].filter(Boolean).join(' ')} isSelected={checked} onChange={onChange} isDisabled={disabled}>
        <HeroCheckbox.Content>{children}</HeroCheckbox.Content>
      </HeroCheckbox>
    </Titled>
  )
}
