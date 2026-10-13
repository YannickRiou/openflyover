/**
 * « Jours et nuits » (Lumière tab): the nights of a multi-day track shown as pauses of the flight (a switch; dusk, night
 * and dawn seconds, `film.nights`), and the « Jour n » cards suggested at the start of each day (film/days.ts). « À la
 * suite »: the stages are the days, so only the switch stays here; the seconds are set on a « Nuit » junction of the
 * timeline (the inspector of the junction) and the stage cards replace the day cards.
 */
import { useId, useMemo, useState } from 'react'
import { isDayCard, trackDays, withDayCards } from '../film/days'
import { NIGHT_PARTS, NIGHT_PART_RANGE } from '../film/model'
import type { FilmNights } from '../film/model'
import { nightPauseS } from '../flyover/nights'
import { trackPathOf } from '../flyover/path'
import { editFilm, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { formatSecondsShort } from './format'
import { PanelSection, RangeField, SettingRow } from './PanelSection'

export function NightSettings() {
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
      ? 'Aucune nuit de repos sur cette trace.'
      : `${shown} nuit${shown > 1 ? 's' : ''} : le film s’arrête ${formatSecondsShort(nightPauseS(nights))} à chaque fois.`

  return (
    <PanelSection title="Jours et nuits">
      <label className="checkbox checkbox--switch" htmlFor={`${id}-nights`}>
        <input
          id={`${id}-nights`}
          type="checkbox"
          checked={nights.enabled}
          aria-describedby={`${id}-nights-hint`}
          onChange={(e) => setNights({ enabled: e.currentTarget.checked })}
        />
        Montrer les nuits
      </label>
      <p id={`${id}-nights-hint`} className="field__hint">
        {nights.enabled ? nightsHint : 'La nuit passe en un instant entre deux jours.'}
      </p>
      {nights.enabled && sequence && (
        <p className="field__hint">Dans « À la suite », la durée du crépuscule, de la nuit et de l’aube se règle sur la jonction « Nuit » de la frise.</p>
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
          <legend className="field__label">Cartes de jour</legend>
          <label className="checkbox">
            <input type="checkbox" checked={content.day} onChange={(e) => setContent({ ...content, day: e.currentTarget.checked })} />
            Distance du jour
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={content.total} onChange={(e) => setContent({ ...content, total: e.currentTarget.checked })} />
            Distance cumulée
          </label>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            aria-describedby={`${id}-cards-hint`}
            onClick={() => {
              const lengthM = track?.stats.distanceM ?? 0
              editFilm((f) => ({ film: withDayCards(f, { days, lengthM, utcOffsetMin: track?.utcOffsetMin }, clock, content) }))
            }}
          >
            {hasCards ? 'Remplacer les cartes de jour' : 'Ajouter les cartes de jour'}
          </button>
          <p id={`${id}-cards-hint`} className="field__hint">
            {days.length < 2
              ? 'Pour une trace enregistrée sur plusieurs jours.'
              : `Une carte « Jour 1 », « Jour 2 »… au début de chacun des ${days.length} jours, à retoucher sur la frise.`}
          </p>
        </fieldset>
      )}
    </PanelSection>
  )
}
