import { t, useT } from '../i18n'
import { modifiedSettings } from '../project/apply'
import { resetSettings } from '../project/history'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { dismissToast, showToast } from './toast'

interface Props {
  /** the settings keys of the group */
  keys: readonly (keyof Settings)[]
  /** name of the group, for the button's accessible label */
  label: string
  disabled?: boolean
}

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
 * « modifié » marker of a settings group (top right of its `.settings` section), with a « Par défaut » button that
 * puts `keys` back to their defaults in one undo step. Renders nothing while every key has its default value.
 */
export function ModifiedMarker({ keys, label, disabled = false }: Props) {
  const tr = useT()
  const modified = useAppStore((s) => modifiedSettings(s.settings, keys).length > 0)
  if (!modified) return null
  return (
    <div className="modified">
      <span className="modified__badge">{tr('common.modified.badge')}</span>
      <button
        type="button"
        className="modified__reset"
        aria-label={tr('common.modified.resetAria', { label })}
        title={tr('common.modified.resetTip')}
        disabled={disabled}
        onClick={() => resetWithUndo(keys)}
      >
        {tr('common.modified.reset')}
      </button>
    </div>
  )
}
