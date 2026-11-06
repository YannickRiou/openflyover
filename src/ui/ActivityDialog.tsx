import { useState } from 'react'
import { activityFilmSettings } from '../film/activityFilms'
import { t as translate, useT } from '../i18n'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { MARKER_FIGURES, MARKER_FIGURE_LABELS } from '../scene/markerSettings'
import type { MarkerFigure } from '../scene/markerSettings'
import { followFlightTiming } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { proposeActivity, useActivityProposal } from './activityProposal'
import { Button, Modal, Radio, RadioGroup } from './primitives'
import { showToast } from './toast'
import { FigureIcon } from './FigureIcon'

const CHOICE =
  'flex w-full cursor-pointer flex-col items-center gap-1 rounded-md border border-edge p-2 text-center transition-ui hover:bg-surface-card ' +
  'data-[selected=true]:border-brand data-[selected=true]:bg-surface-card data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-brand'

/** Apply the film of `figure` to the open project as one undo step, « Annuler » in the message. */
function applyActivityFilm(figure: MarkerFigure): void {
  const before = useAppStore.getState().settings
  const history = getSettingsHistory()
  history.transaction(() => {
    applySettings(activityFilmSettings(before, figure))
    // the texts and media attached to a stop follow the new duration
    followFlightTiming(before)
  })
  const after = useAppStore.getState().settings
  showToast({
    kind: 'success',
    text: translate('film.activity.applied', { name: MARKER_FIGURE_LABELS[figure] }),
    // only while nothing else has changed since: it never undoes a later step
    action: { label: translate('common.undo'), run: () => { if (useAppStore.getState().settings === after) history.undo() } },
  })
}

/**
 * Asked once, after the first import of a project: the 17 activities of the markers, the one read from the file
 * selected. « Appliquer » sets its film (`activityFilmSettings`), « Passer » (or closing) changes nothing.
 */
export function ActivityDialog() {
  const t = useT()
  const guess = useActivityProposal((s) => s.figure)
  const [figure, setFigure] = useState<MarkerFigure | null>(guess)
  const close = () => proposeActivity(null)
  const chosen = figure ?? guess
  return (
    <Modal open={guess !== null} onClose={close} title={t('film.activity.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={560}>
      <p className="type-hint mb-3">{t('film.activity.hint')}</p>
      <RadioGroup look="plain" className="mb-4 grid grid-cols-3 gap-2 max-[559px]:grid-cols-2" aria-label={t('film.activity.title')} value={chosen ?? ''} onChange={(next: MarkerFigure) => setFigure(next)}>
        {MARKER_FIGURES.map((f) => (
          <Radio key={f} value={f} className="block" labelClassName={CHOICE}>
            <FigureIcon figure={f} />
            <span className="type-hint">{MARKER_FIGURE_LABELS[f]}</span>
          </Radio>
        ))}
      </RadioGroup>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={close}>
          {t('film.activity.skip')}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => {
            if (chosen) applyActivityFilm(chosen)
            close()
          }}
        >
          {t('film.activity.apply')}
        </Button>
      </div>
    </Modal>
  )
}
