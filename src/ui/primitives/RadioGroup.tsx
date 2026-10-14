import { Radio as HeroRadio } from '@heroui/react/radio'
import { RadioGroup as HeroRadioGroup } from '@heroui/react/radio-group'
import { createContext, use } from 'react'
import type { ReactNode, Ref } from 'react'
import { Titled } from './Titled'

/** `segmented`: options side by side in one frame; `chips`: separate pills (one choice among them); `plain`: no frame, the screen draws the options. */
export type RadioLook = 'segmented' | 'chips' | 'plain'

export interface RadioGroupProps<V extends string | number> {
  /** The chosen option's `value` (a string, or a number when the options are numbers). */
  value: V
  onChange(value: V): void
  look?: RadioLook
  /** `segmented` with many options: they wrap onto several rows instead of overflowing sideways. */
  wrap?: boolean
  disabled?: boolean
  /** Layout of the screen around it (margin, grid): never colours or sizes of the options. */
  className?: string
  /** The group has no label of its own: one of these names it. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  children: ReactNode
}

const LookContext = createContext<RadioLook>('segmented')

/** The options are `Radio`s; the arrows move to the previous / next one and choose it, the disabled ones are skipped. */
export function RadioGroup<V extends string | number>({ value, onChange, look = 'segmented', wrap, disabled, className, children, ...rest }: RadioGroupProps<V>) {
  const classes = [look === 'segmented' && 'segmented', look === 'segmented' && wrap && 'segmented--wrap', look === 'chips' && 'chips', className]
    .filter(Boolean)
    .join(' ')
  return (
    <LookContext value={look}>
      <HeroRadioGroup
        {...rest}
        className={classes}
        orientation="horizontal"
        value={String(value)}
        onChange={(key) => onChange((typeof value === 'number' ? Number(key) : key) as V)}
        isDisabled={disabled}
      >
        {children}
      </HeroRadioGroup>
    </LookContext>
  )
}

export interface RadioProps {
  value: string | number
  disabled?: boolean
  /** Native tooltip over the whole option (typically why it is disabled). */
  title?: string
  /** Layout of the screen around it: never colours or sizes of the option. */
  className?: string
  /** Look of the clickable label of a `plain` option (the screen draws it; `data-selected`, `data-hovered`, `data-focus-visible` tell its state). */
  labelClassName?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** The label of the option; without it, `aria-label` names it. */
  children?: ReactNode
  /** The option's own element (its wrapper), for a `Tip` around it. */
  ref?: Ref<HTMLDivElement>
}

/** The classes the look of the group gives each option (`.option__label` is the clickable label, a hook for the screens' CSS). */
const OPTION_CLASS: Record<RadioLook, string> = { segmented: 'segmented__option', chips: 'chip', plain: '' }

export function Radio({ value, disabled, title, className, labelClassName, children, ref, ...rest }: RadioProps) {
  const look = use(LookContext)
  const classes = [OPTION_CLASS[look], className].filter(Boolean).join(' ')
  return (
    <Titled title={title}>
      <HeroRadio {...rest} ref={ref} className={classes} value={String(value)} isDisabled={disabled}>
        <HeroRadio.Content className={['option__label', labelClassName].filter(Boolean).join(' ')}>{children}</HeroRadio.Content>
      </HeroRadio>
    </Titled>
  )
}
