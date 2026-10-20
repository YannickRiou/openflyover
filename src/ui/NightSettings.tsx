/**
 * « Jours et nuits » (Lumière tab): the nights of a multi-day track shown as pauses of the flight (a switch; dusk, night
 * and dawn seconds, `film.nights`), and the cards of the days (`film.dayCards`: which figures, title, place, size, how
 * long, and a high view of the day during the night before it). « À la suite »: the stages are the days, so only the
 * switch stays here; the seconds are set on a « Nuit » junction of the timeline (the inspector of the junction) and
 * the stage cards replace the day cards.
 */
import { useId, useMemo } from 'react'
import { isDayCard, trackDays, withoutDayCards } from '../film/days'
import { useT } from '../i18n'
import { DAY_CARD_DURATION_RANGE, DAY_CARD_FIELDS, DEFAULT_DAY_CARDS, NIGHT_PARTS, NIGHT_PART_RANGE } from '../film/model'
import type { DayCardField, FilmDayCards, FilmNights } from '../film/model'
import { nightPauseS } from '../flyover/nights'
import { trackPathOf } from '../flyover/path'
import { editFilm, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { AnchorPicker } from './AnchorPicker'
import { formatSecondsShort } from './format'
import { SizeField } from './OverlayPanel'
import { PanelSection, RangeField, SettingRow } from './PanelSection'
import { Chip, Switch, TextField } from './primitives'

const FIELD_KEYS = {
  date: 'light.days.field.date',
  distance: 'light.days.field.distance',
  ascent: 'light.days.field.ascent',
  duration: 'light.days.field.duration',
  start: 'light.days.field.start',
  weather: 'light.days.field.weather',
} as const satisfies Record<DayCardField, string>

export function NightSettings() {
  const tr = useT()
  const id = useId()
  const { track, film } = useFilmSource()
  const clock = useFilmClock()
  const sequence = useFilmSequence() !== null
  const nights = film.nights
  const days = useMemo(() => (track ? trackDays(trackPathOf(track), track.utcOffsetMin) : []), [track])
  const cards = film.dayCards ?? DEFAULT_DAY_CARDS
  const hasLegacy = film.texts.some(isDayCard)
  const setNights = (patch: Partial<FilmNights>, step = true) => editFilm((f) => ({ film: { ...f, nights: { ...f.nights, ...patch } } }), { step })
  // turning the cards on retires the ones earlier versions baked into the texts
  const setCards = (patch: Partial<FilmDayCards>, step = true) =>
    editFilm((f) => ({ film: { ...(patch.enabled ? withoutDayCards(f) : f), dayCards: { ...(f.dayCards ?? DEFAULT_DAY_CARDS), ...patch } } }), { step })
  const shown = clock.nights.length
  const nightsHint =
    shown === 0
      ? tr('light.nights.none')
      : tr('light.nights.hint', { count: shown, pause: formatSecondsShort(nightPauseS(nights)) })

  return (
    <PanelSection title={tr('light.nights.title')}>
      <Switch
        id={`${id}-nights`}
        checked={nights.enabled}
        aria-describedby={`${id}-nights-hint`}
        onChange={(on) => setNights({ enabled: on })}
      >
        {tr('light.nights.show')}
      </Switch>
      <p id={`${id}-nights-hint`} className="type-hint">
        {nights.enabled ? nightsHint : tr('light.nights.instant')}
      </p>
      {nights.enabled && sequence && (
        <p className="type-hint">{tr('light.nights.sequenceHint')}</p>
      )}
      {nights.enabled &&
        !sequence &&
        NIGHT_PARTS.map(({ key, label, tip }) => (
          <SettingRow key={key} label={label} value={formatSecondsShort(nights[key])} paths={['film.nights']}>
            <RangeField label={label} tip={tip} {...NIGHT_PART_RANGE} value={nights[key]} format={formatSecondsShort} onChange={(v) => setNights({ [key]: v }, false)} />
          </SettingRow>
        ))}

      {!sequence && (
        <fieldset className="field min-w-0" disabled={days.length < 2}>
          <legend className="type-label mb-1">{tr('light.days.legend')}</legend>
          <Switch id={`${id}-cards`} checked={cards.enabled && days.length >= 2} aria-describedby={`${id}-cards-hint`} onChange={(enabled) => setCards({ enabled })}>
            {tr('light.days.enable')}
          </Switch>
          <p id={`${id}-cards-hint`} className="type-hint">
            {days.length < 2 ? tr('light.days.single') : tr('light.days.hint', { count: days.length })}
            {hasLegacy && !cards.enabled && ` ${tr('light.days.legacyHint')}`}
          </p>
          {cards.enabled && days.length >= 2 && (
            <>
              <fieldset className="field min-w-0">
                <legend className="type-label mb-1">{tr('light.days.fields')}</legend>
                <div className="chips">
                  {DAY_CARD_FIELDS.map((field) => (
                    <Chip key={field} checked={cards.fields[field]} onChange={(on) => setCards({ fields: { ...cards.fields, [field]: on } })}>
                      {tr(FIELD_KEYS[field])}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <TextField
                label={tr('light.days.title')}
                value={cards.title ?? ''}
                placeholder={tr('light.days.titlePlaceholder', { n: '{n}' })}
                onChange={(title) => setCards({ title: title === '' ? undefined : title }, false)}
              />
              <p className="type-hint">{tr('light.days.titleHint')}</p>
              <AnchorPicker label={tr('overlay.position')} value={cards.anchor} onChange={(anchor) => setCards({ anchor })} />
              <SizeField value={cards.size} onChange={(size) => setCards({ size }, false)} />
              <SettingRow label={tr('light.days.duration')} value={formatSecondsShort(cards.durationS)} paths={['film.dayCards']}>
                <RangeField
                  label={tr('light.days.duration')}
                  {...DAY_CARD_DURATION_RANGE}
                  value={cards.durationS}
                  format={formatSecondsShort}
                  onChange={(durationS) => setCards({ durationS }, false)}
                />
              </SettingRow>
              <Switch id={`${id}-view`} checked={cards.view} aria-describedby={`${id}-view-hint`} onChange={(view) => setCards({ view })}>
                {tr('light.days.view')}
              </Switch>
              <p id={`${id}-view-hint`} className="type-hint">
                {tr('light.days.viewHint')}
              </p>
            </>
          )}
        </fieldset>
      )}
    </PanelSection>
  )
}
