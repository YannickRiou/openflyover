import { Modal as HeroModal } from '@heroui/react/modal'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../icons'
import { Button } from './Button'
import { Tip } from './Tip'

export interface ModalProps {
  /** Shown while true; the screen owns the state. */
  open: boolean
  /** Escape, a click on the backdrop or the close button asks for it: set `open` to false. */
  onClose(): void
  /** The heading, which is also the name of the dialog for a screen reader (already translated). */
  title: string
  /** The close button: its accessible name and its tooltip (already translated). */
  closeLabel: string
  closeTip: string
  /** Width (px) of the dialog on a wide screen; it never exceeds the window. */
  width?: number
  children: ReactNode
}

/**
 * A modal dialog over the page: the page behind it is inert, Tab stays inside, Escape or a click on the backdrop closes it and
 * gives the focus back to what opened it. Menus, popovers and tooltips opened from inside it are portalled into it
 * (`data-modal`, see `openDialog()` in overlay.ts), and keep Escape for themselves while they are open. It scrolls when its
 * content is taller than the window; on a phone it fills the screen (modal.css).
 */
export function Modal({ open, onClose, title, closeLabel, closeTip, width = 560, children }: ModalProps) {
  return (
    <HeroModal.Backdrop className="modal__backdrop" isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <HeroModal.Container className="modal__container">
        <HeroModal.Dialog className="modal" data-modal="" style={{ '--modal-w': `${width}px` } as CSSProperties}>
          <div className="modal__head">
            <HeroModal.Heading className="modal__title">{title}</HeroModal.Heading>
            <Tip text={closeTip} side="left">
              <Button variant="icon" aria-label={closeLabel} onClick={onClose}>
                <Icon name="x" size={18} />
              </Button>
            </Tip>
          </div>
          {children}
        </HeroModal.Dialog>
      </HeroModal.Container>
    </HeroModal.Backdrop>
  )
}
