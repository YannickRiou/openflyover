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

/** The backdrop: a veil over the window (the visual viewport, so the on-screen keyboard does not hide the dialog); no margin on a phone. */
const BACKDROP =
  'fixed inset-0 z-1000 flex h-[var(--visual-viewport-height,100dvh)] items-center justify-center bg-(--backdrop) p-4 data-entering:fade-in phone-any:p-0'
/** Around the dialog the pointer falls through to the backdrop (a click there is outside the modal: it closes). */
const CONTAINER = 'pointer-events-none flex max-h-full max-w-full phone-any:h-full phone-any:w-full'
/** The dialog: a framed panel that scrolls, full screen on a phone. */
const DIALOG =
  'pointer-events-auto relative max-h-full w-[min(var(--modal-w,560px),calc(100vw_-_32px))] overflow-y-auto overscroll-contain rounded-md border border-edge bg-surface-panel px-5 pt-4 pb-5 text-body whitespace-normal text-text-1 shadow-pop outline-none ' +
  'phone-any:h-full phone-any:w-full phone-any:rounded-none phone-any:border-0 ' +
  'phone-any:pt-[calc(12px_+_var(--safe-top))] phone-any:pr-[calc(16px_+_env(safe-area-inset-right))] ' +
  'phone-any:pb-[calc(20px_+_env(safe-area-inset-bottom))] phone-any:pl-[calc(16px_+_env(safe-area-inset-left))]'

/**
 * A modal dialog over the page: the page behind it is inert, Tab stays inside, Escape or a click on the backdrop closes it and
 * gives the focus back to what opened it. Menus, popovers and tooltips opened from inside it are portalled into it
 * (`data-modal`, see `openDialog()` in overlay.ts), and keep Escape for themselves while they are open. It scrolls when its
 * content is taller than the window; on a phone it fills the screen.
 */
export function Modal({ open, onClose, title, closeLabel, closeTip, width = 560, children }: ModalProps) {
  return (
    <HeroModal.Backdrop className={BACKDROP} data-testid="modal-backdrop" isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <HeroModal.Container className={CONTAINER}>
        <HeroModal.Dialog className={DIALOG} data-modal="" style={{ '--modal-w': `${width}px` } as CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <HeroModal.Heading className="panel-title">{title}</HeroModal.Heading>
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
