import { Toast as HeroToast, ToastQueue } from '@heroui/react/toast'
import { useEffect, useRef, useState } from 'react'
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider'
import { Icon } from '../icons'
import type { IconName } from '../icons'
import { Button } from './Button'
import { Tip } from './Tip'

/** `error` stays until it is closed and is announced at once; the two others are polite. */
export type ToastKind = 'success' | 'info' | 'error'

export interface ToastMessage {
  id: number
  kind: ToastKind
  /** The message (already translated). */
  text: string
  /** Closes itself after this many ms (paused while the pointer or the focus is on a message); absent: stays until closed. */
  duration?: number
  /** A button of its own; it closes the message too. */
  action?: { label: string; run(): void }
}

export interface ToastProps {
  /** The messages to show, oldest first: the list is the source of truth, a message that leaves it is closed. */
  toasts: readonly ToastMessage[]
  /** A message was closed by its button, by its action or by its timer (also called for one that left `toasts`). */
  onClose: (id: number) => void
  /** Most messages shown at once. */
  max: number
  /** Name of the region, for screen readers. */
  label: string
  /** The close button: its accessible name and its tooltip. */
  closeLabel: string
  closeTip: string
}

const ICONS: Record<ToastKind, IconName> = { success: 'circle-check', info: 'info', error: 'circle-alert' }
const VARIANTS = { success: 'success', info: 'accent', error: 'danger' } as const

interface Payload {
  message: ToastMessage
}

/**
 * The messages over the view, newest at the bottom, in one live region that is always in the page (`.toaster`, placed
 * by the screen's own CSS) and holds HeroUI's region. The stack stays open (no collapsing under the newest message).
 */
export function Toast({ toasts, onClose, max, label, closeLabel, closeTip }: ToastProps) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [queue] = useState(() => new ToastQueue<Payload>({ maxVisibleToasts: max }))
  // id of a message -> its key in the queue
  const keys = useRef(new Map<number, string>())

  useEffect(() => {
    const ids = new Set(toasts.map((m) => m.id))
    for (const [id, key] of keys.current) {
      if (ids.has(id)) continue
      keys.current.delete(id)
      queue.close(key)
    }
    for (const message of toasts) {
      if (keys.current.has(message.id)) continue
      const key = queue.add(
        { message },
        {
          timeout: message.duration ?? 0,
          onClose: () => {
            keys.current.delete(message.id)
            onClose(message.id)
          },
        },
      )
      keys.current.set(message.id, key)
    }
  }, [toasts, queue, onClose])

  return (
    <div className="toaster" aria-live="polite" ref={setHost}>
      {host && (
        <UNSAFE_PortalProvider getContainer={() => host}>
          <HeroToast.Provider<Payload> queue={queue} aria-label={label} placement="bottom" gap={8} isExpanded hotkey={[]} maxVisibleToasts={max}>
            {({ toast }) => {
              const { message } = toast.content
              return (
                <HeroToast toast={toast} variant={VARIANTS[message.kind]} data-testid="toast" data-kind={message.kind}>
                  {/* the tooltip of the close button goes to the page, not into the region */}
                  <UNSAFE_PortalProvider getContainer={null}>
                    <HeroToast.Indicator>
                      <Icon name={ICONS[message.kind]} size={18} />
                    </HeroToast.Indicator>
                    <HeroToast.Content role={message.kind === 'error' ? 'alert' : 'status'}>
                      <HeroToast.Title>{message.text}</HeroToast.Title>
                    </HeroToast.Content>
                    {message.action && (
                      <Button
                        variant="icon"
                        className="toast__act"
                        onClick={() => {
                          message.action?.run()
                          queue.close(toast.key)
                        }}
                      >
                        {message.action.label}
                      </Button>
                    )}
                    <Tip text={closeTip} side="top">
                      <Button variant="icon" className="toast__dismiss" aria-label={closeLabel} onClick={() => queue.close(toast.key)}>
                        <Icon name="x" size={16} />
                      </Button>
                    </Tip>
                  </UNSAFE_PortalProvider>
                </HeroToast>
              )
            }}
          </HeroToast.Provider>
        </UNSAFE_PortalProvider>
      )}
    </div>
  )
}
