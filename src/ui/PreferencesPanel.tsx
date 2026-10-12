import { useId } from 'react'
import { getPlatform } from '../platform'
import { ACCENT_PRESETS, CHROME_PRESETS, DEFAULT_APPEARANCE, DENSITIES, THEMES, clampAccent, clampChrome } from './appearance'
import type { Density, Theme } from './appearance'
import { DiagnosticRow } from './DiagnosticDialog'
import { PanelSection } from './PanelSection'
import { setPreferences, usePreferences } from './preferences'
import { PERF_ITEMS, STATUS_CHIPS } from './shell'
import type { PerfItem, StatusChip } from './shell'

const STATUS_LABELS: Record<StatusChip, string> = { weather: 'Météo', landmarks: 'Repères', region: 'Région', water: 'Eau' }

const PERF_LABELS: Record<PerfItem, string> = {
  fps: 'Images par seconde',
  gpu: 'Textures et géométries',
  tiles: 'Tuiles',
  memory: 'Mémoire JavaScript',
  system: 'Mémoire et processeur',
}

const THEME_LABELS: Record<Theme, string> = { light: 'Clair', dark: 'Sombre', system: 'Système' }
const DENSITY_LABELS: Record<Density, string> = { comfortable: 'Confortable', compact: 'Compact' }

/** Exclusive choice among `keys`, as a segmented control. */
function Choice<K extends string>({ legend, labels, keys, value, onChange }: {
  legend: string
  labels: Record<K, string>
  keys: readonly K[]
  value: K
  onChange(value: K): void
}) {
  const name = useId()
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">{legend}</legend>
      <div className="segmented">
        {keys.map((key) => (
          <label key={key} className="segmented__option">
            <input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} />
            {labels[key]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Swatches of `presets` and a free colour picker; `clamp` is what the colour becomes once applied, told when it differs. */
function AppearanceColor({ label, presets, value, clamp, hint, onChange }: {
  label: string
  presets: readonly { color: string; label: string }[]
  value: string
  clamp(color: string): string
  hint: string
  onChange(color: string): void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="color-row">
        <input id={id} className="color-row__input" type="color" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
        {presets.map((preset) => (
          <button
            key={preset.color}
            type="button"
            className="color-row__swatch"
            style={{ background: preset.color }}
            aria-label={`${label} : ${preset.label}`}
            aria-pressed={value === preset.color}
            title={preset.label}
            onClick={() => onChange(preset.color)}
          />
        ))}
      </div>
      {clamp(value) !== value && <p className="field__hint">{hint}</p>}
    </div>
  )
}

/** Checkable chips of a group of on / off preferences. */
function Chips<K extends string>({ legend, labels, keys, value, onChange }: {
  legend: string
  labels: Record<K, string>
  keys: readonly K[]
  value: Record<K, boolean>
  onChange(value: Record<K, boolean>): void
}) {
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">{legend}</legend>
      <div className="chips">
        {keys.map((key) => (
          <label key={key} className="chip">
            <input type="checkbox" checked={value[key]} onChange={(e) => onChange({ ...value, [key]: e.currentTarget.checked })} />
            {labels[key]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * « Réglages » tab: preferences of the app on this device, not of the project (`preferences.ts`): what the status
 * bar shows, the clock time on the timeline, the diagnostic report.
 */
export function PreferencesPanel() {
  const prefs = usePreferences()
  const desktop = getPlatform().capabilities.isDesktop
  // the memory of the JavaScript engine is only told by Chromium; the machine's load only by the desktop app
  const heap = 'memory' in performance
  const perfKeys = PERF_ITEMS.filter((key) => (key === 'memory' ? heap : key === 'system' ? desktop : true))

  const appearance = prefs.appearance
  const setAppearance = (patch: Partial<typeof appearance>) => setPreferences({ appearance: { ...appearance, ...patch } })
  const isDefault = (Object.keys(DEFAULT_APPEARANCE) as (keyof typeof appearance)[]).every((key) => appearance[key] === DEFAULT_APPEARANCE[key])

  return (
    <>
      <p className="field__hint prefs__intro">Ces réglages valent pour cet appareil, pas pour le projet.</p>
      <PanelSection title="Apparence">
        <Choice legend="Thème" labels={THEME_LABELS} keys={THEMES} value={appearance.theme} onChange={(theme) => setAppearance({ theme })} />
        <AppearanceColor
          label="Couleur d'accentuation"
          presets={ACCENT_PRESETS}
          value={appearance.accent}
          clamp={clampAccent}
          hint="Couleur assombrie pour que le texte blanc des boutons reste lisible."
          onChange={(accent) => setAppearance({ accent })}
        />
        <AppearanceColor
          label="Couleur de la barre et du rail"
          presets={CHROME_PRESETS}
          value={appearance.chrome}
          clamp={clampChrome}
          hint="Couleur assombrie pour que le texte de la barre reste lisible."
          onChange={(chrome) => setAppearance({ chrome })}
        />
        <Choice legend="Densité" labels={DENSITY_LABELS} keys={DENSITIES} value={appearance.density} onChange={(density) => setAppearance({ density })} />
        <button type="button" className="btn btn--secondary" disabled={isDefault} onClick={() => setPreferences({ appearance: DEFAULT_APPEARANCE })}>
          Rétablir l'apparence par défaut
        </button>
      </PanelSection>
      <PanelSection title="Barre d'état">
        <Chips
          legend="Chargements"
          labels={STATUS_LABELS}
          keys={STATUS_CHIPS}
          value={prefs.status}
          onChange={(status) => setPreferences({ status })}
        />
        <Chips legend="Performances" labels={PERF_LABELS} keys={perfKeys} value={prefs.performance} onChange={(performance) => setPreferences({ performance })} />
        <p className="field__hint">Les performances s'affichent quand la barre a la place. Les crédits des sources restent toujours visibles.</p>
      </PanelSection>
      <PanelSection title="Timeline">
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={prefs.timelineClock} onChange={(e) => setPreferences({ timelineClock: e.currentTarget.checked })} />
          Afficher l'heure enregistrée
        </label>
        <p className="field__hint">Heure de la trace à la position du marqueur, après le minutage du film.</p>
      </PanelSection>
      <DiagnosticRow />
    </>
  )
}
