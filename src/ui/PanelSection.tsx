import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { presetBadge } from '../export/qualityTier'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import type { PresetKnob } from '../export/qualityTier'
import { getPlatform } from '../platform'
import { modifiedPaths } from '../project/apply'
import type { SettingPath } from '../project/apply'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { Icon } from './icons'
import { ModifiedMarker } from './ModifiedMarker'
import { tabHasHeavySetting, tierName, weightOf } from './renderCost'
import type { WeightKey } from './renderCost'
import { COMPACT_QUERY, FOLDS_KEY, matchesQuery, parseFoldPrefs } from './shell'
import type { ShellTab, UiMode } from './shell'
import { usePreferences } from './preferences'
import { useModeShows } from './uiMode'
import { Disclosure, Slider, Tip } from './primitives'

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
 * Then as last left (remembered by title in the browser, `FOLDS_KEY`); before that open, on a computer except when it is not
 * the first section of its tab (a phone's sheet shows one tab at a time and keeps them open). The content stays mounted
 * when folded, and `summary` (what is set, in a few words) shows under the title meanwhile. From the mode `min` on (every
 * mode without it), or while one of `paths` (`keys` without them) is modified.
 */
export function PanelSection({
  title,
  summary,
  keys,
  hidden = false,
  min,
  paths = keys,
  children,
}: {
  title: string
  summary?: string
  keys?: (keyof Settings)[]
  hidden?: boolean
  min?: UiMode
  paths?: readonly SettingPath[]
  children: ReactNode
}) {
  // read once: the element then keeps its own state
  const [open] = useState(() => loadFolds()[title] ?? true)
  const section = useRef<HTMLDetailsElement>(null)
  const mounted = useRef(false)
  /** the default fold below is not a choice: its toggle event is not remembered (a phone would then open the section folded) */
  const defaultFold = useRef(false)
  // a computer, nothing remembered: the tab opens on its first section, the others wait folded (the DOM keeps the state, as below)
  useLayoutEffect(() => {
    const el = section.current
    // once, as mounted: a new title (another language) must not fold what the person opened
    if (!el || mounted.current) return
    mounted.current = true
    if (loadFolds()[title] !== undefined || matchesQuery(COMPACT_QUERY)) return
    const tab = el.closest('.tabpanel-frame')
    if (tab && tab.querySelector('details[data-panel-section]') !== el) {
      defaultFold.current = true
      el.open = false
    }
  }, [title])
  if (!useModeShows(min, paths)) return null
  return (
    <details ref={section} className="group" data-panel-section={title} open={open} hidden={hidden} onToggle={(e) => (defaultFold.current ? (defaultFold.current = false) : saveFold(title, e.currentTarget.open))}>
      <summary className="panel-head cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="panel-title">{title}</h2>
          {summary && (
            <p className="type-hint truncate group-open:hidden" data-testid="section-summary">
              {summary}
            </p>
          )}
        </div>
        {/* the marker's button must not fold the section; its box is in the flow here, not at the corner of a card */}
        {keys && (
          <span className="shrink-0" onClick={(e) => e.preventDefault()}>
            <ModifiedMarker keys={keys} label={title} />
          </span>
        )}
        <span className="flex text-text-2 transition-ui group-hover:text-text-1 group-[:not([open])]:-rotate-90">
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="flex flex-col gap-3">{children}</div>
    </details>
  )
}

/** Pictogram of a setting that lengthens the export, small glyph: a wider invisible hit area around it on touch. */
const WEIGHT = "relative inline-flex h-4 cursor-help items-end gap-0.5 rounded-[4px] px-[3px] py-0.5 align-middle touch:before:absolute touch:before:-inset-3.5 touch:before:content-['']"
const WEIGHT_BAR = ['h-1', 'h-2', 'h-3']

/**
 * « Poids de rendu »: three bars, as many filled as the setting's current value lengthens the export (renderCost.ts);
 * nothing at weight 0. It reads the store itself, so the memoised panels do not render again with the settings. Ink
 * bars on the line colour; the heaviest in amber (the app's « attention ») on an ink chip.
 */
export function RenderWeight({ weight }: { weight: WeightKey }) {
  const t = useT()
  const tier = useAppStore((s) => weightOf(s.settings, weight).tier)
  const tip = useAppStore((s) => weightOf(s.settings, weight).tip)
  if (tier === 0) return null
  return (
    <Tip text={tip} wrap={220}>
      <span className={`${WEIGHT} ml-2 ${tier === 3 ? 'bg-ink' : ''}`} data-testid="render-weight" data-tier={tier}>
        {WEIGHT_BAR.map((height, i) => (
          <i
            key={height}
            className={`w-[3px] rounded-[1px] ${height} ${i < tier ? (tier === 3 ? 'bg-amber-light' : 'bg-ink') : 'bg-line'}`}
            aria-hidden="true"
          />
        ))}
        <span className="sr-only">{t('export.weight.label', { tier: tierName(tier) })}</span>
      </span>
    </Tip>
  )
}

/**
 * « Imposé par Haute » / « Personnalisé »: next to the name of a row that the export quality drives (qualityTier.ts).
 * Glacier while the quality decides, amber once the value was chosen by hand over it; `stacked` puts it under
 * the name instead of after it.
 */
export function PresetBadge({ knob, stacked = false }: { knob: PresetKnob; stacked?: boolean }) {
  useT()
  const kind = useAppStore((s) => presetBadge(s.settings, knob)?.kind)
  const text = useAppStore((s) => presetBadge(s.settings, knob)?.text)
  if (!kind) return null
  return (
    <span
      className={`rounded-full px-2 align-middle text-caption font-semibold whitespace-nowrap text-ink ${stacked ? 'mt-0.5 block w-fit' : 'ml-2 inline-block'} ${kind === 'preset' ? 'bg-glacier' : 'bg-amber-light'}`}
      data-testid={`preset-badge-${knob}`}
    >
      {text}
    </span>
  )
}

/** Dot on a tab of the rail or the phone bar (a group of tabs there) while one of its settings is at the heaviest weight. */
export function TabWeightDot({ tabs }: { tabs: readonly ShellTab[] }) {
  const t = useT()
  const heavy = useAppStore((s) => tabs.some((tab) => tabHasHeavySetting(s.settings, tab)))
  if (!heavy) return null
  return (
    <>
      <span
        className="pointer-events-none absolute top-1 left-[calc(50%+6px)] size-2 rounded-full bg-amber-light ring-2 ring-ink"
        data-testid="tab-weight"
        aria-hidden="true"
      />
      <span className="sr-only">{t('export.weight.heavyActive')}</span>
    </>
  )
}

/** What takes the focus when a row unfolds, first match wins: the chosen radio, a field, else anything focusable (not an ⓘ first). */
const FOCUS_ORDER = [
  'input[type="radio"]:checked:enabled',
  'input:not([type="hidden"]):enabled, select:enabled, textarea:enabled',
  'button:enabled, [tabindex]:not([tabindex="-1"])',
]

/*
 * A row of settings: a hairline above it, the name on the left and the value on the right (secondary text; once changed,
 * primary text with an accent dot). The head's hover and focus bleed 8 px past the hairline.
 */
const ROW = 'border-t border-edge [&+&]:-mt-3'
const ROW_HEAD =
  'group -mx-2 flex min-h-control-lg w-[calc(100%+16px)] cursor-pointer items-center gap-2 rounded-sm px-2 text-left transition-ui hover:bg-surface-card'
/** The name, then its render weight; the badge of the export quality goes under it so the value keeps its room. */
const ROW_LABEL = 'type-label block min-w-0 flex-1'
const ROW_VALUE = 'max-w-[55%] truncate text-body text-text-2 tabular-nums'
const ROW_VALUE_MODIFIED = 'max-w-[55%] truncate text-body font-medium text-text-1 tabular-nums before:mr-2 before:inline-block before:size-1.5 before:rounded-full before:bg-brand before:align-middle'
/** The control unfolds under the head; a lone field does not repeat the name of its row (screen readers still read it). */
const ROW_BODY =
  'flex flex-col gap-3 pb-3 [&>.field:only-child_.type-label]:sr-only [&>fieldset:only-child>legend]:sr-only'
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
  min,
  children,
}: {
  label: string
  value: ReactNode
  paths?: readonly SettingPath[]
  /** the lowest mode that shows it; a lower mode shows it only while it is modified */
  min?: UiMode
  /** the setting lengthens the export: its pictogram follows the name */
  weight?: WeightKey
  /** the export quality drives the setting: its badge follows the pictogram */
  preset?: PresetKnob
  children: ReactNode
}) {
  const t = useT()
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
  if (!useModeShows(min, paths)) return null
  return (
    <Disclosure
      className={ROW}
      headClassName={ROW_HEAD}
      bodyClassName={ROW_BODY}
      headTestId="setting-row-head"
      bodyTestId="setting-row-body"
      bodyRef={body}
      onOpenChange={setOpen}
      head={
        <>
          <span className={ROW_LABEL} data-testid="setting-row-label">
            {label}
            {weight && <RenderWeight weight={weight} />}
            {preset && <PresetBadge knob={preset} stacked />}
          </span>
          <span className={modified ? ROW_VALUE_MODIFIED : ROW_VALUE} data-testid="setting-row-value" data-modified={modified || undefined}>
            {value}
            {modified && <span className="sr-only">{t('common.modified.srOnly')}</span>}
          </span>
          <span className="flex flex-none text-text-2 transition-ui group-hover:text-text-1 group-aria-[expanded=false]:-rotate-90">
            <Icon name="chevron-down" size={16} />
          </span>
        </>
      }
    >
      {children}
    </Disclosure>
  )
}

/** Content of a panel that shows from the mode `min` on, or whenever one of its `paths` is modified (or `also`, for what is not a setting). */
export function ModeGate({ min, paths, also = false, children }: { min: UiMode; paths?: readonly SettingPath[]; also?: boolean; children: ReactNode }) {
  const shown = useModeShows(min, paths)
  return shown || also ? <>{children}</> : null
}

/** The panels that tell, at their bottom, what a mode leaves out of them. */
type HintPanel = 'trace' | 'carte' | 'meteo' | 'lumiere' | 'survol' | 'habillage' | 'export'

const HINTS: Record<HintPanel, Partial<Record<UiMode, MessageKey>>> = {
  trace: { debutant: 'shell.mode.hint.trace.debutant', confirme: 'shell.mode.hint.trace.confirme' },
  carte: { debutant: 'shell.mode.hint.carte.debutant', confirme: 'shell.mode.hint.carte.confirme' },
  meteo: { confirme: 'shell.mode.hint.meteo.confirme' },
  lumiere: { confirme: 'shell.mode.hint.lumiere.confirme' },
  survol: { debutant: 'shell.mode.hint.survol.debutant', confirme: 'shell.mode.hint.survol.confirme' },
  habillage: { debutant: 'shell.mode.hint.habillage.debutant', confirme: 'shell.mode.hint.habillage.confirme' },
  export: { debutant: 'shell.mode.hint.export.debutant', confirme: 'shell.mode.hint.export.confirme' },
}

/** The note at the bottom of a panel: what the current mode leaves out of it, and that Ctrl+K still finds it. */
export function ModeHint({ panel }: { panel: HintPanel }) {
  const t = useT()
  const mode = usePreferences((s) => s.uiMode)
  const key = HINTS[panel][mode]
  return key ? (
    <p className="type-hint pb-3" data-testid="mode-hint">
      {t(key)} {t('shell.mode.hint.search')}
    </p>
  ) : null
}

/** ⓘ with a one-sentence explanation (tooltip on hover and keyboard focus, read by screen readers). */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tip text={text} wrap={200} tap>
      <span
        className="relative inline-flex flex-none cursor-help rounded-full text-text-2 transition-ui hover:text-text-1 focus-visible:text-text-1 touch:before:absolute touch:before:-inset-3.5 touch:before:content-['']"
        tabIndex={0}
        role="img"
        aria-label={text}
      >
        <Icon name="info" size={14} />
      </span>
    </Tip>
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
  const labelEl = <span className="type-label">{label}</span>
  return (
    <div className="field">
      {tip || weight || preset ? (
        <div className="flex items-center gap-1">
          {labelEl}
          {tip && <InfoTip text={tip} />}
          {weight && <RenderWeight weight={weight} />}
          {preset && <PresetBadge knob={preset} />}
        </div>
      ) : (
        labelEl
      )}
      <Slider aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} wide={wide} format={format} spoken={spoken} onChange={onChange} />
    </div>
  )
}
