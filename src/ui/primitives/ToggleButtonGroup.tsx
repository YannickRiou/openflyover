import { ToggleButton as HeroToggleButton } from '@heroui/react/toggle-button'
import { ToggleButtonGroup as HeroToggleButtonGroup } from '@heroui/react/toggle-button-group'
import type { ReactNode } from 'react'

export interface ToggleButtonGroupProps<V extends string> {
  /** The chosen button's `value`: one is always chosen. */
  value: V
  onChange(value: V): void
  /** Layout of the screen around it (margin): never colours or sizes of the buttons. */
  className?: string
  'aria-label'?: string
  /** The `ToggleButton`s. */
  children: ReactNode
}

/** Buttons side by side in one frame (the look of `RadioGroup`), for a choice that switches what the screen shows; the arrows move between them. */
export function ToggleButtonGroup<V extends string>({ value, onChange, className, children, ...rest }: ToggleButtonGroupProps<V>) {
  return (
    <HeroToggleButtonGroup
      {...rest}
      className={['segmented', className].filter(Boolean).join(' ')}
      fullWidth
      isDetached
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = keys
        if (typeof next === 'string') onChange(next as V)
      }}
    >
      {children}
    </HeroToggleButtonGroup>
  )
}

export interface ToggleButtonProps {
  value: string
  children: ReactNode
}

export function ToggleButton({ value, children }: ToggleButtonProps) {
  return (
    <HeroToggleButton id={value} variant="ghost">
      {children}
    </HeroToggleButton>
  )
}
