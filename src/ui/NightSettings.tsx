/**
 * « Jours et nuits » (Lumière tab): the nights of a multi-day track shown as pauses of the flight (a switch; dusk, night
 * and dawn seconds, `film.nights`), and the « Jour n » cards suggested at the start of each day (film/days.ts). « À la
 * suite »: the stages are the days, so only the switch stays here; the seconds are set on a « Nuit » junction of the
 * timeline (the inspector of the junction) and the stage cards replace the day cards.
 */
import { useId, useMemo, useState } from 'react'
import { isDayCard, trackDays, withDayCards } from '../film/days'
import { useT } from '../i18n'
import { NIGHT_PARTS, NIGHT_PART_RANGE } from '../film/model'
import type { FilmNights } from '../film/model'
import { nightPauseS } from '../flyover/nights'
import { trackPathOf } from '../flyover/path'
import { editFilm, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { formatSecondsShort } from './format'
import { PanelSection, RangeField, SettingRow } from './PanelSection'
import { Button } from './primitives'

export function NightSettings() {
  const tr = useT()
  const id = useId()
  const { track, film } = useFilmSource()
  const clock = useFilmClock()
  const sequence = useFilmSequence() !== null
  const nights = film.nights
  const days = useMemo(() => (track ? trackDays(trackPathOf(track), track.utcOffsetMin) : []), [track])
  const [content, setContent] = useState({ day: true, total: false })
  const hasCards = film.texts.some(isDayCard)
  const setNights = (patch: Partial<FilmNights>, step = true) => editFilm((f) => ({ film: { ...f, nights: { ...f.nights, ...patch } } }), { step })
  const shown = clock.nights.length
  const nightsHint =
    shown === 0
      ? tr('light.nights.none')
      : tr('light.nights.hint', { count: shown, pause: formatSecondsShort(nightPauseS(nights)) })

  return (
    <PanelSection title={tr('light.nights.title')}>
      <label className="checkbox checkbox--switch" htmlFor={`${id}-nights`}>
        <input
          id={`${id}-nights`}
          type="checkbox"
          checked={nights.enabled}
          aria-describedby={`${id}-nights-hint`}
          onChange={(e) => setNights({ enabled: e.currentTarget.checked })}
        />
        {tr('light.nights.show')}
      </label>
      <p id={`${id}-nights-hint`} className="field__hint">
        {nights.enabled ? nightsHint : tr('light.nights.instant')}
      </p>
      {nights.enabled && sequence && (
        <p className="field__hint">{tr('light.nights.sequenceHint')}</p>
      )}
      {nights.enabled &&
        !sequence &&
        NIGHT_PARTS.map(({ key, label, tip }) => (
          <SettingRow key={key} label={label} value={formatSecondsShort(nights[key])} paths={['film.nights']}>
            <RangeField label={label} tip={tip} {...NIGHT_PART_RANGE} value={nights[key]} format={formatSecondsShort} onChange={(v) => setNights({ [key]: v }, false)} />
          </SettingRow>
        ))}

      {!sequence && (
        <fieldset className="field fieldset" disabled={days.length < 2}>
          <legend className="field__label">{tr('light.days.legend')}</legend>
          <label className="checkbox">
            <input type="checkbox" checked={content.day} onChange={(e) => setContent({ ...content, day: e.currentTarget.checked })} />
            {tr('light.days.dayDistance')}
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={content.total} onChange={(e) => setContent({ ...content, total: e.currentTarget.checked })} />
            {tr('light.days.totalDistance')}
          </label>
          <Button
            block
            aria-describedby={`${id}-cards-hint`}
            onClick={() => {
              const lengthM = track?.stats.distanceM ?? 0
              editFilm((f) => ({ film: withDayCards(f, { days, lengthM, utcOffsetMin: track?.utcOffsetMin }, clock, content) }))
            }}
          >
            {hasCards ? tr('light.days.replace') : tr('light.days.add')}
          </Button>
          <p id={`${id}-cards-hint`} className="field__hint">
            {days.length < 2
              ? tr('light.days.single')
              : tr('light.days.hint', { count: days.length })}
          </p>
        </fieldset>
      )}
    </PanelSection>
  )
}
