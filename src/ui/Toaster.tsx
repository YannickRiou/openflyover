import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { Icon } from './icons'
import type { IconName } from './icons'
import { dismissToast, toastDuration, useToastStore } from './toast'
import type { Toast } from './toast'

const ICONS: Record<Toast['kind'], IconName> = { success: 'circle-check', info: 'info', error: 'circle-alert' }

/** One message; success and info close on their own, the timer restarts after hover or focus. */
function ToastItem({ toast }: { toast: Toast }) {
  const t = useT()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const sticky = toast.kind === 'error'
  const paused = hovered || focused

  useEffect(() => {
    if (sticky || paused) return
    const timer = setTimeout(() => dismissToast(toast.id), toastDuration(toast.text))
    return () => clearTimeout(timer)
  }, [sticky, paused, toast.id, toast.text])

  return (
    <div
      className={`toast toast--${toast.kind}`}
      data-testid="toast"
      role={sticky ? 'alert' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <Icon name={ICONS[toast.kind]} size={18} />
      <p className="toast__text">{toast.text}</p>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action?.run()
            dismissToast(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-btn toast__close"
        aria-label={t('common.closeMessage')}
        data-tip={t('common.close')}
        data-tip-side="top"
        onClick={() => dismissToast(toast.id)}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}

/** Messages at the bottom of the view, in one always-mounted live region (errors are announced at once). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
