import type { RefObject } from 'react'
import { useT } from '../i18n'
import { Icon } from './icons'
import { SHORTCUTS, SHORTCUT_GROUPS, keyLabel } from './shortcuts'

/** « Raccourcis clavier » (native modal dialog, Escape closes it), opened by « ? » or the button of the top bar. */
export function HelpDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const t = useT()
  return (
    <dialog ref={dialogRef} className="sources help" aria-labelledby="help-title">
      <div className="sources__head">
        <h2 id="help-title" className="sources__title">
          {t('shortcuts.title')}
        </h2>
        <button type="button" className="icon-btn" aria-label={t('common.close')} data-tip={t('common.closeEsc')} data-tip-side="left" onClick={() => dialogRef.current?.close()}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <p className="field__hint help__drop">{t('shortcuts.drop')}</p>
      <div className="help__groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} className="help__group" aria-labelledby={`help-${group}`}>
            <h3 id={`help-${group}`} className="help__group-title">
              {t(`shortcuts.group.${group}`)}
            </h3>
            <dl className="help__list">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="help__row">
                  <dt className="help__keys">
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="help__or">{t('shortcuts.or')}</span>}
                        <kbd>{keyLabel(k)}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className="help__label">{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  )
}
