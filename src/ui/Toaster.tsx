import { useMemo } from 'react'
import { useT } from '../i18n'
import { dismissToast, MAX_TOASTS, toastDuration, useToastStore } from './toast'
import { Toast } from './primitives'

/** Messages at the bottom of the view: success and info close on their own, errors stay until closed. */
export function Toaster() {
  const t = useT()
  const toasts = useToastStore((s) => s.toasts)
  const messages = useMemo(
    () => toasts.map((toast) => ({ ...toast, duration: toast.kind === 'error' ? undefined : toastDuration(toast.text) })),
    [toasts],
  )
  return (
    <Toast
      toasts={messages}
      onClose={dismissToast}
      max={MAX_TOASTS}
      label={t('common.messages')}
      closeLabel={t('common.closeMessage')}
      closeTip={t('common.close')}
    />
  )
}
