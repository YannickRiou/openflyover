import { useT } from '../i18n'
import { SHORTCUTS, SHORTCUT_GROUPS, keyLabel } from './shortcuts'
import { Modal } from './primitives'

/** « Raccourcis clavier » (modal dialog, Escape closes it), opened by « ? » or the button of the top bar. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={680}>
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
    </Modal>
  )
}
