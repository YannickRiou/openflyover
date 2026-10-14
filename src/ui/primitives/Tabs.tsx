import { Tabs as HeroTabs } from '@heroui/react/tabs'
import { useCallback } from 'react'
import type { ReactNode, Ref } from 'react'
import { Tip } from './Tip'
import type { TipSide } from './Tip'

export interface TabsProps {
  /** The key of the shown tab. */
  value: string
  /** The user moves to another tab (click, tap, arrows, Home / End: the arrows follow `orientation`). */
  onChange(value: string): void
  /** The shown tab is pressed again (pointer, Enter, Space). */
  onReselect?(value: string): void
  orientation?: 'horizontal' | 'vertical'
  /** The tab list and the panels, which may sit apart: the wrapper adds no box of its own. */
  children: ReactNode
}

/**
 * Tabs whose list and panels are placed by the screen (`TabList`, `TabPanel`); the roving tab stop, the arrows, Home /
 * End, the selected state and the roles come from the library.
 */
export function Tabs({ value, onChange, onReselect, orientation = 'horizontal', children }: TabsProps) {
  return (
    <HeroTabs
      className="tabs"
      selectedKey={value}
      // the library also reports a press on the shown tab (pointer, Enter, Space), with its own key
      onSelectionChange={(key) => (String(key) === value ? onReselect?.(value) : onChange(String(key)))}
      orientation={orientation}
    >
      {children}
    </HeroTabs>
  )
}

export interface TabListProps {
  /** Name of the list for screen readers (already translated). */
  label: string
  className?: string
  ref?: Ref<HTMLDivElement>
  /** The `Tab`s. */
  children: ReactNode
}

export function TabList({ label, className, ref, children }: TabListProps) {
  return (
    <HeroTabs.List aria-label={label} className={className} ref={ref}>
      {children}
    </HeroTabs.List>
  )
}

export interface TabProps {
  /** Key of the tab, the `value` of `Tabs` and the `id` of its panel. */
  id: string
  disabled?: boolean
  /** Tooltip (already translated), opened by the mouse, the keyboard focus and a long press. */
  tip?: string
  tipSide?: TipSide
  /** No tooltip now (a tab bar that shows the labels). */
  tipDisabled?: boolean
  className?: string
  'data-testid'?: string
  children: ReactNode
}

/** Stands for the tab around it, so that the tooltip listens on the focusable element and opens next to it. */
function TabAnchor({ ref }: { ref?: Ref<HTMLElement> }) {
  const anchor = useCallback(
    (marker: HTMLElement | null) => {
      const tab = marker?.closest<HTMLElement>('[role="tab"]') ?? null
      if (typeof ref === 'function') ref(tab)
      else if (ref) ref.current = tab
    },
    [ref],
  )
  return <span hidden ref={anchor} />
}

export function Tab({ id, disabled, tip, tipSide = 'right', tipDisabled, className, children, ...rest }: TabProps) {
  return (
    <HeroTabs.Tab id={id} isDisabled={disabled} className={className} {...rest}>
      {children}
      <Tip text={tip} side={tipSide} disabled={tipDisabled}>
        <TabAnchor />
      </Tip>
    </HeroTabs.Tab>
  )
}

export interface TabPanelProps {
  /** Key of its tab. */
  id: string
  className?: string
  'data-testid'?: string
  children: ReactNode
}

/** The panel of a tab; every panel stays mounted (the others are inert and hidden by the skin), since each has effects. */
export function TabPanel({ id, className, children, ...rest }: TabPanelProps) {
  return (
    <HeroTabs.Panel id={id} shouldForceMount className={className} {...rest}>
      {children}
    </HeroTabs.Panel>
  )
}
