import { useState } from 'react'
import type { CSSProperties } from 'react'
import { AUTO_FILM_IDS, AUTO_FILM_LABELS, AUTO_FILM_TEMPLATES, autoFilmFacts } from '../film/autoFilm'
import type { AutoFilmFact, AutoFilmId } from '../film/autoFilm'
import { CAMERA_PRESETS } from '../flyover/cameraSettings'
import { useT } from '../i18n'
import { useFilmTrack } from '../scene/usePacing'
import { applyAutoFilm } from './autoFilm'
import { Icon } from './icons'
import type { IconName } from './icons'
import { PanelSection } from './PanelSection'
import { Button, Modal } from './primitives'

/**
 * « Film automatique »: the section at the top of the « Survol » tab and its dialog with the three gabarits
 * (`film/autoFilm.ts`), each a card to choose: its format, its length as a big figure and a few facts with an icon. The
 * card chosen carries « Appliquer » (`applyAutoFilm`: one undo step, « Annuler » in the message).
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
      <Modal open={open} onClose={() => setOpen(false)} title={t('film.auto.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={960}>
        <GabaritCards onApplied={() => setOpen(false)} />
      </Modal>
    </PanelSection>
  )
}

/** The accent of each gabarit: a colour of the palette that follows the theme. */
const ACCENTS: Record<AutoFilmId, string> = { reel: 'var(--accent)', resume: 'var(--text-info)', souvenir: 'var(--status-ok)' }

const FACT_ICONS: Record<AutoFilmFact, IconName> = {
  titleEnd: 'type',
  stops: 'map-pin',
  stopsSlow: 'map-pin',
  slow: 'gauge',
  noStops: 'route',
  cards: 'layers',
  counters: 'gauge',
  countersCards: 'layers',
}

/** The three cards; the one chosen (the one-minute summary at first) shows the button that applies it. */
function GabaritCards({ onApplied }: { onApplied(): void }) {
  const t = useT()
  const [chosen, setChosen] = useState<AutoFilmId>('resume')
  return (
    <>
      <p className="type-hint mb-3">{t('film.auto.intro')}</p>
      <div className="grid grid-cols-3 gap-3 max-[759px]:grid-cols-1" data-testid="auto-film-templates" role="radiogroup" aria-label={t('film.auto.title')}>
        {AUTO_FILM_IDS.map((id) => {
          const tpl = AUTO_FILM_TEMPLATES[id]
          const vertical = tpl.platform === 'vertical'
          const minutes = tpl.totalS >= 60
          const camera = CAMERA_PRESETS.find((p) => p.id === tpl.camera)?.name ?? ''
          const facts: { key: string; icon: IconName; text: string }[] = [
            { key: 'camera', icon: 'video', text: t('film.auto.fact.camera', { camera }) },
            ...autoFilmFacts(tpl).map(({ key, values }) => ({ key, icon: FACT_ICONS[key], text: t(`film.auto.fact.${key}`, values) })),
          ]
          return (
            <div key={id} className="flex min-w-0">
              <div
                className="flex w-full min-w-0 flex-col gap-3 rounded-md border border-edge bg-surface-card p-4 transition-ui hover:border-edge-strong has-checked:border-(--card-accent) has-checked:bg-surface-control has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--card-accent)"
                style={{ '--card-accent': ACCENTS[id] } as CSSProperties}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer flex-col gap-3">
                  <input
                    type="radio"
                    name="auto-film"
                    className="sr-only"
                    checked={chosen === id}
                    onChange={() => setChosen(id)}
                    aria-label={AUTO_FILM_LABELS[id]}
                    aria-describedby={`auto-film-${id}-length auto-film-${id}-facts`}
                  />
                  {/* the format as a small outline of its proportions */}
                  <span className="flex items-center gap-2 text-hint font-medium text-text-2">
                    <span className="flex size-6 items-center justify-center" aria-hidden="true">
                      <span className="block rounded-[3px] border-2 border-(--card-accent)" style={vertical ? { width: 12, height: 21 } : { width: 22, height: 13 }} />
                    </span>
                    {vertical ? t('film.auto.card.formatVertical') : t('film.auto.card.formatWide')}
                  </span>
                  <p className="font-heading text-title font-semibold text-text-1">{AUTO_FILM_LABELS[id]}</p>
                  <div id={`auto-film-${id}-length`} className="flex items-baseline gap-1.5 border-b border-edge pb-3">
                    <span className="font-heading text-[40px] leading-none font-semibold text-(--card-accent)">{minutes ? tpl.totalS / 60 : tpl.totalS}</span>
                    <span className="text-title font-medium text-(--card-accent)">{minutes ? t('film.auto.card.unitMin') : t('film.auto.card.unitSec')}</span>
                    <span className="ml-1 text-hint text-text-2">{t('film.auto.card.total')}</span>
                  </div>
                  <ul id={`auto-film-${id}-facts`} className="flex flex-1 flex-col gap-2 text-body text-text-1">
                    {facts.map((fact) => (
                      <li key={fact.key} className="flex gap-2">
                        <span className="mt-0.5 text-(--card-accent)">
                          <Icon name={fact.icon} size={16} />
                        </span>
                        <span>{fact.text}</span>
                      </li>
                    ))}
                  </ul>
                </label>
                {chosen === id && (
                  <Button
                    variant="primary"
                    block
                    aria-label={t('film.auto.applyNamed', { name: AUTO_FILM_LABELS[id] })}
                    onClick={() => {
                      if (applyAutoFilm(id)) onApplied()
                    }}
                  >
                    {t('film.auto.apply')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
