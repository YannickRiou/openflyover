import { useId } from 'react'
import { t, useT } from '../i18n'
import { getPlatform } from '../platform'
import { ACCENT_PRESETS, CHROME_PRESETS, DEFAULT_APPEARANCE, DENSITIES, THEMES, clampAccent, clampChrome } from './appearance'
import type { Density, Theme } from './appearance'
import { DiagnosticRow } from './DiagnosticDialog'
import { PanelSection } from './PanelSection'
import { setPreferences, usePreferences } from './preferences'
import { PERF_ITEMS, STATUS_CHIPS } from './shell'
import type { PerfItem, StatusChip } from './shell'

const STATUS_LABELS: Record<StatusChip, string> = {
  get weather() { return t('settings.preferences.status.weather') },
  get landmarks() { return t('settings.preferences.status.landmarks') },
  get region() { return t('settings.preferences.status.region') },
  get water() { return t('settings.preferences.status.water') },
}

const PERF_LABELS: Record<PerfItem, string> = {
  get fps() { return t('settings.preferences.perf.fps') },
  get gpu() { return t('settings.preferences.perf.gpu') },
  get tiles() { return t('settings.preferences.perf.tiles') },
  get memory() { return t('settings.preferences.perf.memory') },
  get system() { return t('settings.preferences.perf.system') },
}

const THEME_LABELS: Record<Theme, string> = {
  get light() { return t('settings.preferences.theme.light') },
  get dark() { return t('settings.preferences.theme.dark') },
  get system() { return t('settings.preferences.theme.system') },
}
const DENSITY_LABELS: Record<Density, string> = {
  get comfortable() { return t('settings.preferences.density.comfortable') },
  get compact() { return t('settings.preferences.density.compact') },
}

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
  const t = useT()
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
            aria-label={t('settings.preferences.swatchAria', { label, preset: preset.label })}
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
  const t = useT()
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
      <p className="field__hint prefs__intro">{t('settings.preferences.intro')}</p>
      <PanelSection title={t('settings.preferences.appearance.title')}>
        <Choice legend={t('settings.preferences.appearance.theme')} labels={THEME_LABELS} keys={THEMES} value={appearance.theme} onChange={(theme) => setAppearance({ theme })} />
        <AppearanceColor
          label={t('settings.preferences.appearance.accent')}
          presets={ACCENT_PRESETS}
          value={appearance.accent}
          clamp={clampAccent}
          hint={t('settings.preferences.appearance.accentHint')}
          onChange={(accent) => setAppearance({ accent })}
        />
        <AppearanceColor
          label={t('settings.preferences.appearance.chrome')}
          presets={CHROME_PRESETS}
          value={appearance.chrome}
          clamp={clampChrome}
          hint={t('settings.preferences.appearance.chromeHint')}
          onChange={(chrome) => setAppearance({ chrome })}
        />
        <Choice legend={t('settings.preferences.appearance.density')} labels={DENSITY_LABELS} keys={DENSITIES} value={appearance.density} onChange={(density) => setAppearance({ density })} />
        <button type="button" className="btn btn--secondary" disabled={isDefault} onClick={() => setPreferences({ appearance: DEFAULT_APPEARANCE })}>
          {t('settings.preferences.appearance.reset')}
        </button>
      </PanelSection>
      <PanelSection title={t('settings.preferences.statusBar.title')}>
        <Chips
          legend={t('settings.preferences.statusBar.loads')}
          labels={STATUS_LABELS}
          keys={STATUS_CHIPS}
          value={prefs.status}
          onChange={(status) => setPreferences({ status })}
        />
        <Chips legend={t('settings.preferences.statusBar.performance')} labels={PERF_LABELS} keys={perfKeys} value={prefs.performance} onChange={(performance) => setPreferences({ performance })} />
        <p className="field__hint">{t('settings.preferences.statusBar.hint')}</p>
      </PanelSection>
      <PanelSection title={t('settings.preferences.timeline.title')}>
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={prefs.timelineClock} onChange={(e) => setPreferences({ timelineClock: e.currentTarget.checked })} />
          {t('settings.preferences.timeline.clock')}
        </label>
        <p className="field__hint">{t('settings.preferences.timeline.clockHint')}</p>
      </PanelSection>
      <DiagnosticRow />
    </>
  )
}
