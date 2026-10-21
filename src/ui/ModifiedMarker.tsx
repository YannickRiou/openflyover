import { t, useT } from '../i18n'
import { modifiedSettings } from '../project/apply'
import { resetSettings } from '../project/history'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { Icon } from './icons'
import { dismissToast, showToast } from './toast'

interface Props {
  /** the settings keys of the group */
  keys: readonly (keyof Settings)[]
  /** name of the group, for the button's accessible label */
  label: string
  disabled?: boolean
  /** a lighter badge on a dark panel (the film options) */
  onDark?: boolean
  /** Where it sits in the head around it. */
  className?: string
}

/**
 * One round ↺ button: it shows that the group is modified and puts it back to its defaults; the marker takes its
 * place in the head it is put in (`className`: grid cell, padding).
 */
const RESET =
  'inline-flex size-6 cursor-pointer items-center justify-center rounded-full transition-ui hover:enabled:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 touch:size-9'

/**
 * Reset `keys` and say so, with « Annuler »; the message goes away at the next change of the settings (or an undo),
 * so that its « Annuler » never undoes a later step.
 */
function resetWithUndo(keys: readonly (keyof Settings)[]): void {
  const undo = resetSettings(keys)
  const settings = useAppStore.getState().settings
  const id = showToast({ kind: 'success', text: t('common.modified.toast'), action: { label: t('common.undo'), run: undo } })
  const stop = useAppStore.subscribe((state) => {
    if (state.settings === settings) return
    stop()
    dismissToast(id)
  })
}

/**
 * « modifié » marker of a settings group (in the head of its section): a ↺ button that puts `keys` back to their
 * defaults in one undo step. Renders nothing while every key has its default value.
 */
export function ModifiedMarker({ keys, label, disabled = false, onDark = false, className }: Props) {
  const tr = useT()
  const modified = useAppStore((s) => modifiedSettings(s.settings, keys).length > 0)
  if (!modified) return null
  return (
    <div className={className ? `flex items-center ${className}` : 'flex items-center'}>
      <button
        type="button"
        className={`${RESET} ${onDark ? 'border border-glacier text-glacier' : 'bg-accent-tint text-brand'}`}
        aria-label={tr('common.modified.resetAria', { label })}
        title={tr('common.modified.resetTip')}
        disabled={disabled}
        onClick={() => resetWithUndo(keys)}
      >
        <Icon name="rotate-ccw" size={14} />
      </button>
    </div>
  )
}
