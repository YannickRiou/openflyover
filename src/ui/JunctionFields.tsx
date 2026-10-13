import { useId } from 'react'
import { STAGE_CARD_VARIABLES } from '../film/junctions'
import { JUNCTION_CARD_RANGE, JUNCTION_HOLD_RANGE, JUNCTION_KINDS, JUNCTION_KIND_LABELS } from '../film/model'
import type { JunctionCard, JunctionKind } from '../film/model'
import { WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import { AnchorPicker } from './AnchorPicker'
import { formatNumber } from './format'
import { FilmTextStyleFields } from './OverlayPanel'
import { RangeField, TextField } from './PanelSection'

/** What each transition does, under its choice. */
const JUNCTION_KIND_HINTS: Record<JunctionKind, string> = {
  coupe: 'L’image passe d’un coup d’une étape à l’autre ; le film ne s’arrête pas.',
  'fondu-noir': 'Le film s’arrête ici le temps indiqué, en fondu au noir.',
  'fondu-blanc': 'Le film s’arrête ici le temps indiqué, en fondu au blanc.',
  nuit: 'La nuit passée entre les deux étapes : le soleil se couche, la nuit passe, il se lève. Sans nuit entre elles, un fondu au noir.',
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
  const id = useId()
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-kind`}>
          Transition
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
        <RangeField label="Durée" {...JUNCTION_HOLD_RANGE} value={holdS} format={seconds} onChange={(v) => onChange({ holdS: v })} wide={false} />
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
  const id = useId()
  const custom = card.text !== undefined
  return (
    <>
      <label className="checkbox">
        <input type="checkbox" checked={card.enabled} onChange={(e) => onChange({ enabled: e.currentTarget.checked })} />
        Afficher le carton
      </label>
      <fieldset className="field fieldset">
        <legend className="field__label">Contenu</legend>
        <div className="segmented">
          <label className="segmented__option">
            <input type="radio" name={`${id}-content`} checked={!custom} onChange={() => onChange({ text: undefined, subtitle: undefined })} />
            Automatique
          </label>
          <label className="segmented__option">
            <input type="radio" name={`${id}-content`} checked={custom} onChange={() => onChange({ text: '{name}', subtitle: 'Étape {n} sur {count} · {date}' })} />
            Mon texte
          </label>
        </div>
      </fieldset>
      {custom ? (
        <>
          <TextField label="Texte" value={card.text ?? ''} onChange={(text) => onChange({ text })} />
          <TextField label="Sous-titre" value={card.subtitle ?? ''} onChange={(subtitle) => onChange({ subtitle: subtitle || undefined })} />
          <p className="field__hint">Variables : {STAGE_CARD_VARIABLES.map((v) => `{${v}}`).join(' ')}.</p>
        </>
      ) : (
        <p className="field__hint">Le nom de l’étape, « Étape 2 sur 3 » et sa date, sa distance et son dénivelé.</p>
      )}
      <AnchorPicker label="Position" value={card.anchor} onChange={(anchor) => onChange({ anchor })} />
      <RangeField label="Taille" {...SIZE_RANGE} value={card.size} format={(v) => `×${formatNumber(v, 1)}`} onChange={(size) => onChange({ size })} wide={false} />
      <FilmTextStyleFields color={card.color} font={card.font} onChange={({ color, font }) => onChange({ color, font })} />
      <RangeField label="Durée d’affichage" {...JUNCTION_CARD_RANGE} value={card.durationS} format={seconds} onChange={(durationS) => onChange({ durationS })} wide={false} />
    </>
  )
}
