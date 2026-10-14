import { Switch as HeroSwitch } from '@heroui/react/switch'
import type { CheckboxProps } from './Checkbox'
import { Titled } from './Titled'

/** The same props as a checkbox: it turns a whole feature on or off (the label in bold). */
export type SwitchProps = CheckboxProps

export function Switch({ checked, onChange, disabled, title, children, ...rest }: SwitchProps) {
  return (
    <Titled title={title}>
      <HeroSwitch {...rest} isSelected={checked} onChange={onChange} isDisabled={disabled}>
        <HeroSwitch.Content>
          <HeroSwitch.Control>
            <HeroSwitch.Thumb />
          </HeroSwitch.Control>
          {children !== undefined && <span>{children}</span>}
        </HeroSwitch.Content>
      </HeroSwitch>
    </Titled>
  )
}
