/**
 * « Jours et nuits » (Lumière tab): the nights of a multi-day track shown as pauses of the flight (a switch; dusk, night
 * and dawn seconds, `film.nights`), and the cards of the days (`film.dayCards`: which figures, title, place, size, colours
 * and fonts, how long, and a high view of the day during the night before it; also in the inspector of a day card block,
 * `DayCardFields`). « À la suite »: the stages are the days; the seconds stay here (the « Nuit » junctions use them,
 * the transitions that pass a night use them), the stage cards replace the day cards, and the transitions set the night
 * and the high view of the stage (Trace › Plusieurs traces).
 */
import { useId, useMemo } from 'react'
import { isDayCard, trackDays, withoutDayCards } from '../film/days'
import { useT } from '../i18n'
import { DAY_CARD_DURATION_RANGE, DAY_CARD_FIELD_LABELS, DAY_CARD_FIELDS, DEFAULT_DAY_CARDS, NIGHT_PARTS, NIGHT_PART_RANGE } from '../film/model'
import type { FilmDayCards, FilmNights } from '../film/model'
import { nightPauseS } from '../flyover/nights'
import { trackPathOf } from '../flyover/path'
import { mergeOverrides } from '../overlay/settings'
import { editFilm, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { AnchorPicker } from './AnchorPicker'
import { formatSecondsShort } from './format'
import { SizeField, StyleOverrides } from './OverlayPanel'
import { PanelSection, RangeField, SettingRow } from './PanelSection'
import { Chip, Switch, TextField } from './primitives'

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
  // « À la suite », the nights passed by « Nuit » junctions count too
  const shown = clock.nights.length + clock.junctions.filter((j) => j.kind === 'nuit').length
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
      {sequence && <p className="type-hint">{tr('light.nights.sequenceHint')}</p>}
      {/* « À la suite », the « Nuit » transitions use these seconds whether the nights inside the stages show or not */}
      {(nights.enabled || sequence) &&
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
          {cards.enabled && days.length >= 2 && <DayCardFields />}
        </fieldset>
      )}
    </PanelSection>
  )
}

/**
 * Settings shared by every day card (`film.dayCards`): figures, title, place, size, how long, the high view of the
 * night; in the Lumière tab and in the inspector of a day card block.
 */
export function DayCardFields() {
  const tr = useT()
  const id = useId()
  const { film } = useFilmSource()
  const cards = film.dayCards ?? DEFAULT_DAY_CARDS
  const overlay = useAppStore((s) => s.settings.overlay)
  const setCards = (patch: Partial<FilmDayCards>, step = true) =>
    editFilm((f) => ({ film: { ...f, dayCards: { ...(f.dayCards ?? DEFAULT_DAY_CARDS), ...patch } } }), { step })
  return (
    <>
      <fieldset className="field min-w-0">
        <legend className="type-label mb-1">{tr('light.days.fields')}</legend>
        <div className="chips">
          {DAY_CARD_FIELDS.map((field) => (
            <Chip key={field} checked={cards.fields[field]} onChange={(on) => setCards({ fields: { ...cards.fields, [field]: on } })}>
              {DAY_CARD_FIELD_LABELS[field]}
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
      <StyleOverrides overlay={overlay} own={cards.overrides ?? {}} onChange={(patch) => setCards({ overrides: mergeOverrides(cards.overrides, patch) }, false)} />
      <SettingRow label={tr('light.days.duration')} value={formatSecondsShort(cards.durationS)} paths={['film.dayCards']}>
        <RangeField
          label={tr('light.days.duration')}
          {...DAY_CARD_DURATION_RANGE}
          value={cards.durationS}
          format={formatSecondsShort}
          onChange={(durationS) => setCards({ durationS }, false)}
        />
      </SettingRow>
      {/* a single track: the high view is that of the night pauses, none while they are off */}
      <Switch id={`${id}-view`} checked={cards.view} disabled={!film.nights.enabled} aria-describedby={`${id}-view-hint`} onChange={(view) => setCards({ view })}>
        {tr('light.days.view')}
      </Switch>
      <p id={`${id}-view-hint`} className="type-hint">
        {film.nights.enabled ? tr('light.days.viewHint') : tr('light.days.viewNeedsNights')}
      </p>
    </>
  )
}
