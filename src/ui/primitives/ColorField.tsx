import { ColorArea } from '@heroui/react/color-area'
import { ColorField as HeroColorField } from '@heroui/react/color-field'
import { ColorSlider } from '@heroui/react/color-slider'
import { ColorSwatchPicker } from '@heroui/react/color-swatch-picker'
import { Input } from '@heroui/react/input'
import { useState } from 'react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { ColorPicker, parseColor } from 'react-aria-components/ColorPicker'
import type { Color } from 'react-aria-components/ColorPicker'
import { I18nProvider } from 'react-aria-components/I18nProvider'
import { Pressable } from 'react-aria-components/Pressable'
import { currentLocale, useT } from '../../i18n'
import { Popover } from './Popover'

/** A colour ready to pick in one tap. */
export interface ColorPreset {
  /** '#rrggbb' */
  color: string
  /** Its name (already translated): the tooltip. */
  label: string
  /** What a screen reader says of it, by default `label`. */
  aria?: string
}

export interface ColorFieldProps {
  /** The name of the colour (already translated): the name of its button and of the panel. */
  label: string
  /** On the button, for a `<label htmlFor>` of the screen. */
  id?: string
  /** '#rrggbb' */
  value: string
  /** Called with a '#rrggbb' on every change, a drag in the panel included. */
  onChange(color: string): void
  /** A row of colours to pick in one tap, beside the button. */
  presets?: readonly ColorPreset[]
  /** The button alone, a small dot instead of a field (a colour in a list). */
  dot?: boolean
  /** Layout of the screen around it (margin, position): never colours or sizes. */
  className?: string
  /** Beside the button and the presets: another way to set the colour (« same as the track »). */
  children?: ReactNode
  /** The button, for a `Tip` around it. */
  ref?: Ref<HTMLButtonElement>
}

const parse = (value: string): Color => {
  try {
    return parseColor(value)
  } catch {
    return parseColor('#000000')
  }
}
/** '#rrggbb', lowercase like the native input it replaces */
const hexOf = (color: Color) => color.toString('hex').toLowerCase()

/** The sliders and the hex field over one colour: the panel of the button. Kept in the colour space it was edited in, so a hue survives a grey. */
function ColorPanel({ value, onChange }: { value: string; onChange(color: string): void }) {
  const t = useT()
  const [color, setColor] = useState(() => parse(value))
  // set from outside (an undo): follow it
  if (hexOf(color) !== hexOf(parse(value))) setColor(parse(value))
  return (
    <I18nProvider locale={currentLocale()}>
      <ColorPicker
        value={color}
        onChange={(next) => {
          setColor(next)
          onChange(hexOf(next))
        }}
      >
        <div className="color-field__panel">
        <ColorArea className="color-field__area" colorSpace="hsb" xChannel="saturation" yChannel="brightness">
          <ColorArea.Thumb className="color-field__thumb" />
        </ColorArea>
        <ColorSlider className="color-field__hue" colorSpace="hsb" channel="hue">
          <ColorSlider.Track className="color-field__track">
            <ColorSlider.Thumb className="color-field__thumb" />
          </ColorSlider.Track>
        </ColorSlider>
        <HeroColorField aria-label={t('common.colorHex')}>
          <Input className="input color-field__hex" onFocus={(e) => e.currentTarget.select()} />
        </HeroColorField>
        </div>
      </ColorPicker>
    </I18nProvider>
  )
}

/**
 * A colour: a button showing it, which opens a panel (area, hue slider and hex field) for any colour, and optionally a row of
 * presets to pick in one tap. The value is a '#rrggbb' string, changed as the colour is dragged, like the native input it
 * replaces. The panel is a bottom sheet on a phone.
 */
export function ColorField({ label, id, value, onChange, presets, dot, className, children, ref }: ColorFieldProps) {
  const current = hexOf(parse(value))
  const button = (
    <Popover
      label={label}
      placement="bottom start"
      width={240}
      sheet
      trigger={
        <Pressable>
          <button
            ref={ref}
            id={id}
            type="button"
            className={['color-field__button', dot && 'color-field__button--dot', dot && className].filter(Boolean).join(' ')}
            style={{ '--color-field-current': current } as CSSProperties}
            aria-label={label}
          />
        </Pressable>
      }
    >
      <ColorPanel value={value} onChange={onChange} />
    </Popover>
  )
  if (dot) return button
  return (
    <div className={['color-row', className].filter(Boolean).join(' ')}>
      {button}
      {presets && (
        <ColorSwatchPicker aria-label={label} value={current} onChange={(next) => onChange(hexOf(next))} className="color-field__presets">
          {presets.map((preset) => (
            <ColorSwatchPicker.Item key={preset.color} color={preset.color} aria-label={preset.aria ?? preset.label} className="color-field__preset">
              <span className="color-field__chip" style={{ background: preset.color }} title={preset.label} />
            </ColorSwatchPicker.Item>
          ))}
        </ColorSwatchPicker>
      )}
      {children}
    </div>
  )
}
