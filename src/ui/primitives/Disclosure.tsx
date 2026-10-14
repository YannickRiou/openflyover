import { Disclosure as HeroDisclosure } from '@heroui/react/disclosure'
import type { ReactNode, Ref } from 'react'

export interface DisclosureProps {
  /** What the button that folds and unfolds shows (a label, a value, a chevron). */
  head: ReactNode
  /** The body unfolds (`true`) or folds. */
  onOpenChange?(open: boolean): void
  /** Layout of the screen around it: never the colours or sizes of the primitive itself. */
  className?: string
  headClassName?: string
  bodyClassName?: string
  headTestId?: string
  bodyTestId?: string
  bodyRef?: Ref<HTMLDivElement>
  /** The body, mounted while folded (it keeps its state, and the controls in it stay in the page). */
  children: ReactNode
}

/**
 * A button and a body that it folds and unfolds, without a heading level (the head is a row of a list of settings, not a
 * section). The button carries `aria-expanded` and `aria-controls`, the body is `hidden` while folded.
 */
export function Disclosure({ head, onOpenChange, className, headClassName, bodyClassName, headTestId, bodyTestId, bodyRef, children }: DisclosureProps) {
  return (
    <HeroDisclosure onExpandedChange={onOpenChange} className={className}>
      <HeroDisclosure.Trigger className={headClassName} data-testid={headTestId}>
        {head}
      </HeroDisclosure.Trigger>
      <HeroDisclosure.Content className={bodyClassName} data-testid={bodyTestId} ref={bodyRef}>
        {children}
      </HeroDisclosure.Content>
    </HeroDisclosure>
  )
}
