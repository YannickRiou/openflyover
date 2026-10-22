import { useState } from 'react'
import { AUTO_FILM_HINTS, AUTO_FILM_IDS, AUTO_FILM_LABELS } from '../film/autoFilm'
import { useT } from '../i18n'
import { useFilmTrack } from '../scene/usePacing'
import { applyAutoFilm } from './autoFilm'
import { Icon } from './icons'
import { PanelSection } from './PanelSection'
import { Button, Modal } from './primitives'

/**
 * « Film automatique »: the section at the top of the « Survol » tab and its dialog with the three gabarits
 * (`film/autoFilm.ts`). A gabarit is applied by `applyAutoFilm` (one undo step, « Annuler » in the message).
 */
export function AutoFilmSection() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const hasTrack = useFilmTrack() !== undefined
  return (
    <PanelSection title={t('film.auto.title')}>
      <p className="type-hint">{hasTrack ? t('film.auto.sectionHint') : t('film.auto.needTrack')}</p>
      <Button block disabled={!hasTrack} onClick={() => setOpen(true)}>
        <Icon name="clapperboard" size={16} />
        {t('film.auto.open')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('film.auto.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
        <p className="type-hint mb-3">{t('film.auto.intro')}</p>
        <ul className="flex flex-col gap-3" data-testid="auto-film-templates">
          {AUTO_FILM_IDS.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-text-1">{AUTO_FILM_LABELS[id]}</p>
                <p className="text-body text-text-2">{AUTO_FILM_HINTS[id]}</p>
              </div>
              <Button
                variant="primary"
                size="sm"
                aria-label={t('film.auto.applyNamed', { name: AUTO_FILM_LABELS[id] })}
                onClick={() => {
                  if (applyAutoFilm(id)) setOpen(false)
                }}
              >
                {t('film.auto.apply')}
              </Button>
            </li>
          ))}
        </ul>
        <p className="type-hint mt-3">{t('film.auto.editable')}</p>
        <p className="type-hint mt-2">{t('film.auto.length')}</p>
      </Modal>
    </PanelSection>
  )
}
