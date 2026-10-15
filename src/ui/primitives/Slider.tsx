import { Slider as HeroSlider } from '@heroui/react/slider'
import { useLayoutEffect, useRef } from 'react'
import type { PointerEvent, ReactNode, SyntheticEvent } from 'react'

export interface SliderProps {
  value: number
  /** Called with the new value on every move of the thumb, by pointer or keys (the screens decide what one undo step is). */
  onChange(value: number): void
  min: number
  max: number
  step: number
  /** The value written out next to the track (an `<output>`); without it there is none. */
  format?(value: number): string
  /** The value read by screen readers, when it differs from the written one (defaults to `format`). */
  spoken?(value: number): string
  /** Room for a value with a unit (`format` only). */
  wide?: boolean
  disabled?: boolean
  /** Layout of the screen around it (width, margin) and the accent colour of the track through `--slider-accent`. */
  className?: string
  /** The name of the slider (the screen's visible label, as text: the library names the thumb through the group, which a label element would not reach). */
  'aria-label'?: string
  'aria-describedby'?: string
  /** Under the track, lined up with it (a day / night bar, say). */
  below?: ReactNode
}

/**
 * A finger on the rail (not on the thumb) does not move the value at once, as the library would: it may start a swipe
 * that scrolls the panel, and the native range input does not jump on it either. A tap still puts the thumb there (the
 * mouse event the browser sends after a tap); a drag takes the thumb.
 */
function keepScroll(e: SyntheticEvent) {
  const touch = e.type === 'touchstart' || (e as PointerEvent<Element>).pointerType === 'touch'
  if (touch && !(e.target as Element).closest('.slider__thumb')) e.stopPropagation()
}

/**
 * A slider with its value written out: the arrows, Page Up / Down, Home and End move the thumb (a range input is inside,
 * so the keyboard and screen readers behave as before); on a touch screen the thumb is dragged and a vertical swipe
 * from the rail still scrolls the panel.
 */
export function Slider({ value, onChange, min, max, step, format, spoken = format, wide = true, disabled, className, below, ...rest }: SliderProps) {
  const input = useRef<HTMLInputElement>(null)
  // the library may report the same value again (a pointer move inside one step): a native range input does not, and an
  // update with no change would cut the undo step of a drag in two
  const last = useRef(value)
  // React Aria words the value as a number of the locale: what a screen reader gets is the screen's own text
  useLayoutEffect(() => {
    last.current = value
    if (spoken) input.current?.setAttribute('aria-valuetext', spoken(value))
  })
  return (
    <HeroSlider
      {...rest}
      className={['slider--field', className].filter(Boolean).join(' ')}
      data-slider=""
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      isDisabled={disabled}
      onChange={(v) => {
        if (v === last.current) return
        last.current = v as number
        onChange(v as number)
      }}
    >
      <HeroSlider.Track style={{ touchAction: 'pan-y' }} onPointerDownCapture={keepScroll} onTouchStartCapture={keepScroll}>
        <HeroSlider.Fill />
        <HeroSlider.Thumb inputRef={input} />
      </HeroSlider.Track>
      {format && (
        <HeroSlider.Output className={wide ? 'range-value-wide' : 'range-value'}>{() => format(value)}</HeroSlider.Output>
      )}
      {below && <div className="slider__below">{below}</div>}
    </HeroSlider>
  )
}
