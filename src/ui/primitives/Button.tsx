import { Button as HeroButton } from '@heroui/react/button'
import type { MouseEvent, ReactNode, Ref } from 'react'

/** `primary`: the one action of a screen; `secondary`: any other; `icon`: a bare icon (or icon and short label), no frame. */
export type ButtonVariant = 'primary' | 'secondary' | 'icon'

export interface ButtonProps {
  variant?: ButtonVariant
  /** compact, for a row of actions or a button next to a field */
  size?: 'sm'
  /** fills the width of its container */
  block?: boolean
  /** `submit` sends the form around it; any other button is `button` */
  type?: 'button' | 'submit'
  disabled?: boolean
  autoFocus?: boolean
  /** Layout of the screen around it (margin, position, the height of a bar) and the `@utility` of its context (`btn-chrome`): no other colours. */
  className?: string
  onClick?: (event: MouseEvent<Element>) => void
  title?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-controls'?: string
  'aria-expanded'?: boolean
  'aria-haspopup'?: boolean | 'menu' | 'dialog' | 'listbox'
  'aria-pressed'?: boolean
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * HeroUI variant behind each of ours, and the class the screens' own CSS keys on (`.btn`, `.icon-btn`: position in the
 * top bar, in a toast or in the timeline bar, size on a touch screen).
 */
const VARIANTS = {
  primary: { heroui: 'primary', hook: 'btn' },
  secondary: { heroui: 'outline', hook: 'btn' },
  icon: { heroui: 'ghost', hook: 'icon-btn' },
} as const

export function Button({ variant = 'secondary', size, block, type = 'button', disabled, className, children, ...rest }: ButtonProps) {
  const { heroui, hook } = VARIANTS[variant]
  const classes = [hook, size === 'sm' && 'btn--small', className].filter(Boolean).join(' ')
  return (
    <HeroButton {...rest} type={type} variant={heroui} size={size} fullWidth={block} isDisabled={disabled} className={classes}>
      {children}
    </HeroButton>
  )
}
