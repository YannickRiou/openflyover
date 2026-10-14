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
  /** a lighter badge on a dark panel (the film options) */
  onDark?: boolean
  /** where it sits when it is not at the corner of a card (`static` in a panel's own flow) */
  className?: string
}

/** The badge and the « Par défaut » button; the marker itself (`.modified`, app.css) is placed by the card or the section around it. */
const BADGE = 'rounded-full border px-2 py-px text-caption font-semibold'
const RESET =
  'cursor-pointer rounded-sm border border-edge bg-surface-control px-2 py-px text-hint font-semibold text-text-1 transition-ui hover:enabled:border-text-1 disabled:cursor-not-allowed disabled:opacity-45'

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
export function ModifiedMarker({ keys, label, disabled = false, onDark = false, className }: Props) {
  const tr = useT()
  const modified = useAppStore((s) => modifiedSettings(s.settings, keys).length > 0)
  if (!modified) return null
  return (
    <div className={className ? `modified ${className}` : 'modified'}>
      <span className={`${BADGE} ${onDark ? 'border-glacier text-glacier' : 'border-text-2 text-text-2'}`}>{tr('common.modified.badge')}</span>
      <button
        type="button"
        className={RESET}
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
