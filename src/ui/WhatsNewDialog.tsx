import { useT } from '../i18n'
import { Icon } from './icons'
import { Modal } from './primitives'
import { WHATS_NEW } from './whatsNew'

/** « Nouveautés »: the versions newest first, each item an icon, a title and a sentence (`whatsNew.ts`). */
export function WhatsNewDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('news.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
      <p className="type-hint mb-3">{t('news.hint')}</p>
      <div className="flex flex-col gap-5" data-testid="whats-new">
        {WHATS_NEW.map((entry) => (
          <section key={entry.version}>
            <h3 className="mb-2 font-heading text-title font-semibold text-text-1">{t('news.version', { version: entry.version })}</h3>
            <ul className="flex flex-col gap-3">
              {entry.items.map((item) => (
                <li key={item.icon + entry.version} className="flex gap-3">
                  <span className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-full bg-accent-tint text-brand">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-1">{item.title}</p>
                    <p className="text-body text-text-2">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}
