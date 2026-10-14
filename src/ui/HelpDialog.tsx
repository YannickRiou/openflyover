import { useT } from '../i18n'
import { SHORTCUTS, SHORTCUT_GROUPS, keyLabel } from './shortcuts'
import { Modal } from './primitives'

/** A key: a small cap with a thicker foot. */
const KEY =
  'inline-block min-w-[22px] rounded-sm border border-b-2 border-edge bg-surface-control px-1.5 text-center font-body text-hint leading-normal font-semibold whitespace-nowrap text-text-1'

/** « Raccourcis clavier » (modal dialog, Escape closes it), opened by « ? » or the button of the top bar. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={680}>
      <p className="type-hint mb-4">{t('shortcuts.drop')}</p>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 max-[599px]:grid-cols-1">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} aria-labelledby={`help-${group}`}>
            <h3 id={`help-${group}`} className="mb-2 text-body">
              {t(`shortcuts.group.${group}`)}
            </h3>
            <dl className="flex flex-col gap-1.5">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-2">
                  <dt>
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="text-hint text-text-2">{t('shortcuts.or')}</span>}
                        <kbd className={KEY}>{keyLabel(k)}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
