import { Header } from '@heroui/react/header'
import { ListBox } from '@heroui/react/list-box'
import { Select as HeroSelect } from '@heroui/react/select'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useCoarsePointer } from './coarse'
import { openDialog, panelClass } from './overlay'

export interface SelectOption<V extends string | number = string> {
  value: V
  /** The text (already translated): also what a typed letter jumps to. */
  label: string
  disabled?: boolean
}

/** Options under a heading (a native `<optgroup>`). */
export interface SelectGroup<V extends string | number = string> {
  label: string
  options: readonly SelectOption<V>[]
}

/** `field`: a form control of a panel (full width); `bar`: the small one of a dark toolbar (as wide as its text). */
export type SelectLook = 'field' | 'bar'

export interface SelectProps<V extends string | number> {
  /** The chosen option's `value` (a string, or a number when the options are numbers). */
  value: V
  onChange(value: V): void
  options: readonly (SelectOption<V> | SelectGroup<V>)[]
  disabled?: boolean
  look?: SelectLook
  /** Id of the control, for the `<label htmlFor>` that names it. */
  id?: string
  /** Layout of the screen around it (margin, width in a row): never colours or sizes. */
  className?: string
  /** The select has no `<label htmlFor={id}>`: one of these names it. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'data-testid'?: string
}

const isGroup = <V extends string | number>(choice: SelectOption<V> | SelectGroup<V>): choice is SelectGroup<V> => 'options' in choice
const flatten = <V extends string | number>(choices: SelectProps<V>['options']) => choices.flatMap((choice) => (isGroup(choice) ? choice.options : [choice]))

/** One walk over the options for both renderers, so they never differ: the groups wrap their options, the keys are the values as text. */
function renderChoices<V extends string | number>(
  choices: SelectProps<V>['options'],
  group: (group: SelectGroup<V>, key: string, children: ReactNode) => ReactNode,
  option: (option: SelectOption<V>, key: string) => ReactNode,
): ReactNode[] {
  return choices.map((choice, i) =>
    isGroup(choice) ? group(choice, `group-${i}`, choice.options.map((o) => option(o, String(o.value)))) : option(choice, String(choice.value)),
  )
}

/** The `<label htmlFor={id}>` of the field names the trigger too (React Aria's own `aria-labelledby` would otherwise hide it): it gets an id to point at. */
function useFieldLabel(id: string | undefined, named: boolean) {
  const labelId = id && !named ? `${id}-label` : undefined
  useEffect(() => {
    if (!id || !labelId) return
    const label = [...document.getElementsByTagName('label')].find((l) => l.htmlFor === id)
    if (label) label.id = labelId
  }, [id, labelId])
  return labelId
}

/**
 * A choice among a list of options. On a touch screen (`pointer: coarse`) it is the browser's own `<select>`, whose picker is made
 * for a finger; elsewhere a button that opens a list over the page: arrows, Home / End and typed letters move in it, Enter or Space
 * picks, Escape closes it first (`data-local-escape`: the app's own Escape comes after) and gives the focus back. The list is
 * portalled out of its container, into the open `<dialog>` if there is one.
 */
export function Select<V extends string | number>(props: SelectProps<V>) {
  const coarse = useCoarsePointer()
  return coarse ? <NativeSelect {...props} /> : <ListSelect {...props} />
}

const lookClass = (look: SelectLook) => (look === 'bar' ? 'select-bar' : 'select-field')

function NativeSelect<V extends string | number>({ value, onChange, options, disabled, look = 'field', className, ...rest }: SelectProps<V>) {
  return (
    <select
      {...rest}
      className={[lookClass(look), className].filter(Boolean).join(' ')}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const picked = flatten(options).find((o) => String(o.value) === e.currentTarget.value)
        if (picked) onChange(picked.value)
      }}
    >
      {renderChoices(
        options,
        (g, key, children) => (
          <optgroup key={key} label={g.label}>
            {children}
          </optgroup>
        ),
        (o, key) => (
          <option key={key} value={key} disabled={o.disabled}>
            {o.label}
          </option>
        ),
      )}
    </select>
  )
}

function ListSelect<V extends string | number>({ value, onChange, options, disabled, look = 'field', id, className, 'data-testid': testId, ...rest }: SelectProps<V>) {
  const [container, setContainer] = useState<Element | undefined>()
  const flat = flatten(options)
  const key = String(value)
  const labelledBy = useFieldLabel(id, Boolean(rest['aria-label'] || rest['aria-labelledby']))
  return (
    <HeroSelect
      {...rest}
      aria-labelledby={rest['aria-labelledby'] ?? labelledBy}
      id={id}
      className={className}
      // a value that is none of the options shows nothing (React Aria's own text for it is English only)
      placeholder={'\u00a0'}
      selectedKey={flat.some((o) => String(o.value) === key) ? key : null}
      onSelectionChange={(picked) => {
        const option = flat.find((o) => String(o.value) === String(picked))
        if (option) onChange(option.value)
      }}
      disabledKeys={flat.filter((o) => o.disabled).map((o) => String(o.value))}
      isDisabled={disabled}
      onOpenChange={(open) => open && setContainer(openDialog())}
    >
      <HeroSelect.Trigger className={`select-trigger ${lookClass(look)}`} data-testid={testId}>
        <HeroSelect.Value className="select-value" />
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover className={panelClass('select-panel')} placement="bottom start" offset={4} containerPadding={8} data-local-escape="" UNSTABLE_portalContainer={container}>
        <ListBox className="select-list">
          {renderChoices(
            options,
            (g, groupKey, children) => (
              <ListBox.Section key={groupKey}>
                <Header className="select-group">{g.label}</Header>
                {children}
              </ListBox.Section>
            ),
            (o, optionKey) => (
              <ListBox.Item key={optionKey} id={optionKey} textValue={o.label} className="select-option">
                {({ isSelected }) => (
                  <>
                    {o.label}
                    {isSelected && <ListBox.ItemIndicator className="select-check" />}
                  </>
                )}
              </ListBox.Item>
            ),
          )}
        </ListBox>
      </HeroSelect.Popover>
    </HeroSelect>
  )
}
