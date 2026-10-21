import { useId } from 'react'
import { STAGE_CARD_VARIABLES } from '../film/junctions'
import { DAY_CARD_FIELDS, DAY_CARD_FIELD_LABELS, JUNCTION_CARD_RANGE, JUNCTION_HOLD_RANGE, JUNCTION_KIND_LABELS, PASSAGE_KINDS, STAGE_CARD_FIELDS } from '../film/model'
import type { JunctionCard, JunctionKind } from '../film/model'
import { t, useT } from '../i18n'
import { WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import { AnchorPicker } from './AnchorPicker'
import { formatNumber } from './format'
import { FilmTextStyleFields } from './OverlayPanel'
import { RangeField } from './PanelSection'
import { Checkbox, Chip, Radio, RadioGroup, Select, TextField } from './primitives'

/** What each passage does, under its choice. */
const PASSAGE_HINTS: Record<PassageKind, string> = {
  get coupe() { return t('inspector.junction.hint.coupe') },
  get 'fondu-noir'() { return t('inspector.junction.hint.fondu-noir') },
  get 'fondu-blanc'() { return t('inspector.junction.hint.fondu-blanc') },
}

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`

type PassageKind = (typeof PASSAGE_KINDS)[number]

/**
 * The three choices of a junction, the same in the settings and the inspector: « Passage » (a cut or a fade, held for
 * its « Durée »), « Passer la nuit » (the night between two days; `hasNight` false: there is none between these two
 * stages, said under it; absent: not known, in the settings) and « Revoir l'étape finie » (the high view of the stage).
 */
export function JunctionTransitionFields({
  kind,
  holdS,
  night,
  recap,
  hasNight,
  onChange,
}: {
  kind: JunctionKind
  holdS: number
  night: boolean
  recap: boolean
  hasNight?: boolean
  onChange(patch: { kind?: JunctionKind; holdS?: number; night?: boolean; recap?: boolean }): void
}) {
  const t = useT()
  const id = useId()
  const passage: PassageKind = kind === 'nuit' ? 'fondu-noir' : kind
  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="type-label" htmlFor={`${id}-kind`}>
          {t('inspector.junction.transition')}
        </label>
        <Select
          id={`${id}-kind`}
          value={passage}
          aria-describedby={`${id}-hint`}
          options={PASSAGE_KINDS.map((k) => ({ value: k, label: JUNCTION_KIND_LABELS[k] }))}
          onChange={(next) => onChange({ kind: next })}
        />
        <p id={`${id}-hint`} className="type-hint">
          {PASSAGE_HINTS[passage]}
        </p>
      </div>
      {passage !== 'coupe' && (
        <RangeField label={t('inspector.junction.duration')} {...JUNCTION_HOLD_RANGE} value={holdS} format={seconds} onChange={(v) => onChange({ holdS: v })} wide={false} />
      )}
      <Checkbox checked={night} onChange={(on) => onChange({ night: on })}>{t('inspector.junction.night')}</Checkbox>
      <p className="type-hint">{night && hasNight === false ? t('inspector.junction.noNight') : t('inspector.junction.nightHint')}</p>
      <Checkbox checked={recap} onChange={(on) => onChange({ recap: on })}>{t('inspector.junction.recap')}</Checkbox>
      <p className="type-hint">{t('inspector.junction.recapHint')}</p>
    </>
  )
}

/** Range of the size of a stage card (×, as a text's). */
const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }

/**
 * Settings of a stage card « À la suite », the common card's (Trace › Plusieurs traces) or one card's (the inspector of
 * its block): automatic (name, number and the figures chosen) or worded by the film with `{name} {n} {count} {date}
 * {distance} {ascent}`, where it sits, its size, colour, font and duration (also set by dragging the end of its block).
 */
export function StageCardFields({ card, onChange }: { card: JunctionCard; onChange(patch: Partial<JunctionCard>): void }) {
  const t = useT()
  const custom = card.text !== undefined
  const fields = card.fields ?? STAGE_CARD_FIELDS
  return (
    <>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="type-label">{t('inspector.junction.content')}</legend>
        <RadioGroup
          aria-label={t('inspector.junction.content')}
          value={custom ? 'custom' : 'auto'}
          onChange={(content) => onChange(content === 'custom' ? { text: '{name}', subtitle: t('inspector.junction.defaultSubtitle') } : { text: undefined, subtitle: undefined })}
        >
          <Radio value="auto">{t('inspector.junction.auto')}</Radio>
          <Radio value="custom">{t('inspector.junction.custom')}</Radio>
        </RadioGroup>
      </fieldset>
      {custom ? (
        <>
          <TextField label={t('inspector.junction.text')} value={card.text ?? ''} onChange={(text) => onChange({ text })} />
          <TextField label={t('inspector.junction.subtitle')} value={card.subtitle ?? ''} onChange={(subtitle) => onChange({ subtitle: subtitle || undefined })} />
          <p className="type-hint">{t('inspector.junction.variables', { list: STAGE_CARD_VARIABLES.map((v) => `{${v}}`).join(' ') })}</p>
        </>
      ) : (
        <>
          <fieldset className="field min-w-0">
            <legend className="type-label mb-1">{t('light.days.fields')}</legend>
            <div className="chips">
              {DAY_CARD_FIELDS.map((field) => (
                <Chip key={field} checked={fields[field]} onChange={(on) => onChange({ fields: { ...fields, [field]: on } })}>
                  {DAY_CARD_FIELD_LABELS[field]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <p className="type-hint">{t('inspector.junction.autoHint')}</p>
        </>
      )}
      <AnchorPicker label={t('inspector.junction.position')} value={card.anchor} onChange={(anchor) => onChange({ anchor })} />
      <RangeField label={t('inspector.junction.size')} {...SIZE_RANGE} value={card.size} format={(v) => `×${formatNumber(v, 1)}`} onChange={(size) => onChange({ size })} wide={false} />
      <FilmTextStyleFields color={card.color} font={card.font} onChange={({ color, font }) => onChange({ color, font })} />
      <RangeField label={t('inspector.junction.displayDuration')} {...JUNCTION_CARD_RANGE} value={card.durationS} format={seconds} onChange={(durationS) => onChange({ durationS })} wide={false} />
    </>
  )
}
