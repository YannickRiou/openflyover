import { TimeField as HeroTimeField } from '@heroui/react/time-field'
import { parseTime } from '@internationalized/date'
import type { Time } from '@internationalized/date'
import { I18nProvider } from 'react-aria-components/I18nProvider'
import { currentLocale, useLanguage } from '../../i18n'
import type { TimeFieldProps } from './TimeField'

const parse = (value: string) => {
  try {
    return value ? parseTime(value) : null
  } catch {
    return null
  }
}
const two = (n: number) => String(n).padStart(2, '0')
const text = (time: Time | null) => (time ? `${two(time.hour)}:${two(time.minute)}` : '')

/** The segments of `TimeField`, in a file of their own that it loads when first shown (React Aria's date code stays out of the first screen). */
export default function TimeFieldSegments({ value, onChange, required, disabled, className, 'data-testid': testId, ...rest }: TimeFieldProps) {
  const language = useLanguage()
  return (
    <I18nProvider locale={currentLocale()} key={language}>
      <HeroTimeField
        {...rest}
        className={className}
        data-testid={testId}
        value={parse(value)}
        onChange={(time) => onChange(text(time))}
        granularity="minute"
        shouldForceLeadingZeros
        isRequired={required}
        validationBehavior="native"
        isDisabled={disabled}
        fullWidth
      >
        <HeroTimeField.Group fullWidth>
          <HeroTimeField.Input>{(segment) => <HeroTimeField.Segment segment={segment} />}</HeroTimeField.Input>
        </HeroTimeField.Group>
      </HeroTimeField>
    </I18nProvider>
  )
}
