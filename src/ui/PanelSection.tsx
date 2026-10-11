import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { presetBadge } from '../export/qualityTier'
import type { PresetKnob } from '../export/qualityTier'
import { getPlatform } from '../platform'
import { modifiedPaths } from '../project/apply'
import type { SettingPath } from '../project/apply'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { Icon } from './icons'
import { ModifiedMarker } from './ModifiedMarker'
import { TIER_NAMES, tabHasHeavySetting, weightOf } from './renderCost'
import type { WeightKey } from './renderCost'
import { FOLDS_KEY, parseFoldPrefs } from './shell'
import type { ShellTab } from './shell'

/** The fold states remembered by the browser (none when its storage cannot be read). */
function loadFolds(): Record<string, boolean> {
  try {
    return parseFoldPrefs(getPlatform().storage.get(FOLDS_KEY))
  } catch {
    return {}
  }
}

/** Remember that section `title` is open or folded (the choice lasts for the session without storage). */
function saveFold(title: string, open: boolean) {
  try {
    const folds = loadFolds()
    if (folds[title] !== open) getPlatform().storage.set(FOLDS_KEY, JSON.stringify({ ...folds, [title]: open }))
  } catch {
    // storage unavailable: the section is just not remembered
  }
}

/**
 * Foldable section of a tab, flat with a sticky header (title, « modifié / Par défaut » of `keys` if given, chevron).
 * Open at first, then as last left (remembered by title in the browser, `FOLDS_KEY`); the content stays mounted when
 * folded.
 */
export function PanelSection({
  title,
  keys,
  hidden = false,
  children,
}: {
  title: string
  keys?: (keyof Settings)[]
  hidden?: boolean
  children: ReactNode
}) {
  // read once: the element then keeps its own state
  const [open] = useState(() => loadFolds()[title] ?? true)
  return (
    <details className="fold panel-section" open={open} hidden={hidden} onToggle={(e) => saveFold(title, e.currentTarget.open)}>
      <summary className="fold__summary">
        <h2 className="section-title fold__title">{title}</h2>
        {/* the marker's button must not fold the section */}
        {keys && (
          <span className="fold__marker" onClick={(e) => e.preventDefault()}>
            <ModifiedMarker keys={keys} label={title} />
          </span>
        )}
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="panel-section__body">{children}</div>
    </details>
  )
}

/**
 * « Poids de rendu »: three bars, as many filled as the setting's current value lengthens the export (renderCost.ts);
 * nothing at weight 0. It reads the store itself, so the memoised panels do not render again with the settings.
 */
export function RenderWeight({ weight }: { weight: WeightKey }) {
  const tier = useAppStore((s) => weightOf(s.settings, weight).tier)
  const tip = useAppStore((s) => weightOf(s.settings, weight).tip)
  if (tier === 0) return null
  return (
    <span className={`render-weight render-weight--${tier}`} data-tip={tip}>
      {[1, 2, 3].map((bar) => (
        <i key={bar} className={bar <= tier ? 'render-weight__bar render-weight__bar--on' : 'render-weight__bar'} aria-hidden="true" />
      ))}
      <span className="visually-hidden">Poids de rendu : {TIER_NAMES[tier]}</span>
    </span>
  )
}

/**
 * « Imposé par Haute » / « Personnalisé »: next to the name of a row that the export quality drives (qualityTier.ts).
 * Periwinkle while the quality decides, chartreuse once the value was chosen by hand over it.
 */
export function PresetBadge({ knob }: { knob: PresetKnob }) {
  const kind = useAppStore((s) => presetBadge(s.settings, knob)?.kind)
  const text = useAppStore((s) => presetBadge(s.settings, knob)?.text)
  if (!kind) return null
  return (
    <span className={`preset-badge preset-badge--${kind}`} data-testid={`preset-badge-${knob}`}>
      {text}
    </span>
  )
}

/** Dot on a tab of the rail or the phone bar while one of its settings is at the heaviest weight. */
export function TabWeightDot({ tab }: { tab: ShellTab }) {
  const heavy = useAppStore((s) => tabHasHeavySetting(s.settings, tab))
  if (!heavy) return null
  return (
    <>
      <span className="rail__weight" aria-hidden="true" />
      <span className="visually-hidden">, réglage lourd actif</span>
    </>
  )
}

/** What takes the focus when a row unfolds, first match wins: the chosen radio, a field, else anything focusable (not an ⓘ first). */
const FOCUS_ORDER = [
  'input[type="radio"]:checked:enabled',
  'input:not([type="hidden"]):enabled, select:enabled, textarea:enabled',
  'button:enabled, [tabindex]:not([tabindex="-1"])',
]

/**
 * A secondary setting on one row: its name and current value (`value`), its control hidden until the row is pressed,
 * then unfolded under it with the focus on it. The value reads as changed when one of `paths` differs from its default.
 */
export function SettingRow({
  label,
  value,
  paths = [],
  weight,
  preset,
  children,
}: {
  label: string
  value: ReactNode
  paths?: readonly SettingPath[]
  /** the setting lengthens the export: its pictogram follows the name */
  weight?: WeightKey
  /** the export quality drives the setting: its badge follows the pictogram */
  preset?: PresetKnob
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const modified = useAppStore((s) => modifiedPaths(s.settings, paths).length > 0)
  // once the control shows (not on mount): it takes the focus
  useEffect(() => {
    if (!open) return
    for (const selector of FOCUS_ORDER) {
      const control = body.current?.querySelector<HTMLElement>(selector)
      if (control) return control.focus()
    }
  }, [open])
  return (
    <div className="setting-row">
      <button type="button" className="setting-row__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="setting-row__label">
          {label}
          {weight && <RenderWeight weight={weight} />}
          {preset && <PresetBadge knob={preset} />}
        </span>
        <span className={modified ? 'setting-row__value setting-row__value--modified' : 'setting-row__value'}>
          {value}
          {modified && <span className="visually-hidden"> (modifié)</span>}
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      <div id={id} ref={body} className="setting-row__body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}

/** ⓘ with a one-sentence explanation (tooltip on hover and keyboard focus, read by screen readers). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" tabIndex={0} role="img" aria-label={text} data-tip={text}>
      <Icon name="info" size={14} />
    </span>
  )
}

/** A slider with its label and its value written out (`wide`: room for a value with a unit). */
export function RangeField({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  disabled = false,
  wide = true,
  tip,
  weight,
  preset,
  spoken = format,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format(value: number): string
  onChange(value: number): void
  disabled?: boolean
  wide?: boolean
  /** explanation in an ⓘ next to the label */
  tip?: string
  /** the setting lengthens the export: its pictogram follows the name */
  weight?: WeightKey
  /** the export quality drives the setting: its badge follows the pictogram */
  preset?: PresetKnob
  /** value read by screen readers, when it differs from the displayed one */
  spoken?(value: number): string
}) {
  const id = useId()
  const labelEl = (
    <label className="field__label" htmlFor={id}>
      {label}
    </label>
  )
  return (
    <div className="field">
      {tip || weight || preset ? (
        <div className="field__label-row">
          {labelEl}
          {tip && <InfoTip text={tip} />}
          {weight && <RenderWeight weight={weight} />}
          {preset && <PresetBadge knob={preset} />}
        </div>
      ) : (
        labelEl
      )}
      <div className="range-row">
        <input
          id={id}
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          aria-valuetext={spoken(value)}
        />
        <output className={wide ? 'range-row__value range-row__value--wide' : 'range-row__value'} htmlFor={id}>
          {format(value)}
        </output>
      </div>
    </div>
  )
}

export function TextField({
  label,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange(value: string): void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  )
}
