import { Calendar } from '@heroui/react/calendar'
import { DateField as HeroDateField } from '@heroui/react/date-field'
import { DatePicker } from '@heroui/react/date-picker'
import { parseDate } from '@internationalized/date'
import { useState } from 'react'
import { I18nProvider } from 'react-aria-components/I18nProvider'
import { currentLocale, useLanguage } from '../../i18n'
import type { DateFieldProps } from './DateField'
import { openDialog, panelClass } from './overlay'

const parse = (value: string) => {
  try {
    return value ? parseDate(value) : null
  } catch {
    return null
  }
}

/**
 * The segments and the calendar of `DateField`, in a file of their own that `DateField` loads when first shown: React Aria's date
 * and calendar code and `@internationalized/date` stay out of the first screen. The calendar opens over the page, portalled into
 * the open `Modal` if there is one, and Escape closes it before the app's own (`data-local-escape`).
 */
export default function DateFieldPicker({ value, onChange, required, disabled, className, 'data-testid': testId, ...rest }: DateFieldProps) {
  const language = useLanguage()
  const [container, setContainer] = useState<Element | undefined>()
  return (
    <I18nProvider locale={currentLocale()} key={language}>
      <DatePicker
        {...rest}
        className={className}
        data-testid={testId}
        value={parse(value)}
        onChange={(day) => onChange(day ? day.toString() : '')}
        isRequired={required}
        shouldForceLeadingZeros
        validationBehavior="native"
        isDisabled={disabled}
        onOpenChange={(open) => open && setContainer(openDialog())}
      >
        <HeroDateField.Group fullWidth>
          <HeroDateField.Input>{(segment) => <HeroDateField.Segment segment={segment} />}</HeroDateField.Input>
          <HeroDateField.Suffix>
            <DatePicker.Trigger>
              <DatePicker.TriggerIndicator />
            </DatePicker.Trigger>
          </HeroDateField.Suffix>
        </HeroDateField.Group>
        <DatePicker.Popover className={panelClass('date-panel')} offset={4} containerPadding={8} data-local-escape="" UNSTABLE_portalContainer={container}>
          <Calendar>
            <Calendar.Header>
              <Calendar.NavButton slot="previous" />
              <Calendar.Heading />
              <Calendar.NavButton slot="next" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
              <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
            </Calendar.Grid>
          </Calendar>
        </DatePicker.Popover>
      </DatePicker>
    </I18nProvider>
  )
}
