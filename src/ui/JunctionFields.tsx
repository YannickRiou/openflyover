import { useId } from 'react'
import { STAGE_CARD_VARIABLES } from '../film/junctions'
import { JUNCTION_CARD_RANGE, JUNCTION_HOLD_RANGE, JUNCTION_KINDS, JUNCTION_KIND_LABELS } from '../film/model'
import type { JunctionCard, JunctionKind } from '../film/model'
import { t, useT } from '../i18n'
import { WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import { AnchorPicker } from './AnchorPicker'
import { formatNumber } from './format'
import { FilmTextStyleFields } from './OverlayPanel'
import { RangeField, TextField } from './PanelSection'
import { Checkbox, Radio, RadioGroup } from './primitives'

/** What each transition does, under its choice. */
const JUNCTION_KIND_HINTS: Record<JunctionKind, string> = {
  get coupe() { return t('inspector.junction.hint.coupe') },
  get 'fondu-noir'() { return t('inspector.junction.hint.fondu-noir') },
  get 'fondu-blanc'() { return t('inspector.junction.hint.fondu-blanc') },
  get nuit() { return t('inspector.junction.hint.nuit') },
}

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`

/** « Transition » of a junction and its « Durée » (a fade holds the film for that long), the same in the settings and the inspector. */
export function JunctionTransitionFields({
  kind,
  holdS,
  onChange,
}: {
  kind: JunctionKind
  holdS: number
  onChange(patch: { kind?: JunctionKind; holdS?: number }): void
}) {
  const t = useT()
  const id = useId()
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-kind`}>
          {t('inspector.junction.transition')}
        </label>
        <select id={`${id}-kind`} className="select" value={kind} aria-describedby={`${id}-hint`} onChange={(e) => onChange({ kind: e.currentTarget.value as JunctionKind })}>
          {JUNCTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {JUNCTION_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <p id={`${id}-hint`} className="field__hint">
          {JUNCTION_KIND_HINTS[kind]}
        </p>
      </div>
      {(kind === 'fondu-noir' || kind === 'fondu-blanc') && (
        <RangeField label={t('inspector.junction.duration')} {...JUNCTION_HOLD_RANGE} value={holdS} format={seconds} onChange={(v) => onChange({ holdS: v })} wide={false} />
      )}
    </>
  )
}

const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }

/**
 * Settings of the card of a stage « À la suite », in the inspector of its block: shown or not, automatic (name, number,
 * date, distance and D+ of the stage) or worded by the film with `{name} {n} {count} {date} {distance} {ascent}`,
 * where it sits, its size, colour, font and duration (also set by dragging the end of its block).
 */
export function StageCardFields({ card, onChange }: { card: JunctionCard; onChange(patch: Partial<JunctionCard>): void }) {
  const t = useT()
  const custom = card.text !== undefined
  return (
    <>
      <Checkbox checked={card.enabled} onChange={(on) => onChange({ enabled: on })}>{t('inspector.junction.show')}</Checkbox>
      <fieldset className="field fieldset">
        <legend className="field__label">{t('inspector.junction.content')}</legend>
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
          <p className="field__hint">{t('inspector.junction.variables', { list: STAGE_CARD_VARIABLES.map((v) => `{${v}}`).join(' ') })}</p>
        </>
      ) : (
        <p className="field__hint">{t('inspector.junction.autoHint')}</p>
      )}
      <AnchorPicker label={t('inspector.junction.position')} value={card.anchor} onChange={(anchor) => onChange({ anchor })} />
      <RangeField label={t('inspector.junction.size')} {...SIZE_RANGE} value={card.size} format={(v) => `×${formatNumber(v, 1)}`} onChange={(size) => onChange({ size })} wide={false} />
      <FilmTextStyleFields color={card.color} font={card.font} onChange={({ color, font }) => onChange({ color, font })} />
      <RangeField label={t('inspector.junction.displayDuration')} {...JUNCTION_CARD_RANGE} value={card.durationS} format={seconds} onChange={(durationS) => onChange({ durationS })} wide={false} />
    </>
  )
}
