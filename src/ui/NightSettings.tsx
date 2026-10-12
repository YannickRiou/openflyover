/**
 * « Jours et nuits » (Lumière tab): the nights of a multi-day track shown as pauses of the flight (dusk, night and
 * dawn seconds, `film.nights`), and the « Jour n » cards suggested at the start of each day (film/days.ts).
 */
import { useId, useMemo, useState } from 'react'
import { isDayCard, trackDays, withDayCards } from '../film/days'
import { NIGHT_PART_RANGE } from '../film/model'
import type { FilmNights } from '../film/model'
import { nightPauseS } from '../flyover/nights'
import { trackPathOf } from '../flyover/path'
import { editFilm, useFilmClock, useFilmSource } from '../scene/usePacing'
import { formatSecondsShort } from './format'
import { PanelSection, RangeField, SettingRow } from './PanelSection'

const PARTS: { key: 'duskS' | 'nightS' | 'dawnS'; label: string; tip: string }[] = [
  { key: 'duskS', label: 'Crépuscule', tip: 'Le soleil se couche : de l’arrivée du soir à la nuit noire.' },
  { key: 'nightS', label: 'Nuit', tip: 'La nuit passe, éclairée par la lune.' },
  { key: 'dawnS', label: 'Aube', tip: 'Le soleil se lève, jusqu’au départ du matin.' },
]

export function NightSettings() {
  const id = useId()
  const { track, film } = useFilmSource()
  const clock = useFilmClock()
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
      {nights.enabled &&
        PARTS.map(({ key, label, tip }) => (
          <SettingRow key={key} label={label} value={formatSecondsShort(nights[key])} paths={['film.nights']}>
            <RangeField label={label} tip={tip} {...NIGHT_PART_RANGE} value={nights[key]} format={formatSecondsShort} onChange={(v) => setNights({ [key]: v }, false)} />
          </SettingRow>
        ))}

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
    </PanelSection>
  )
}
