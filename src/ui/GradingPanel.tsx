import { useId } from 'react'
import { gradingText, hasGradingKeys, hasParamKeys } from '../film/paramKeys'
import { addParamKey } from '../film/timeline'
import { t, useT } from '../i18n'
import { getSettingsHistory } from '../project/history'
import { GRADING_PRESETS, GRADING_RANGES, gradingOfPreset, withGradingValue } from '../scene/grading'
import type { GradingPresetId, GradingValues } from '../scene/grading'
import { editFilm, getFilmSource, useKeyedValue } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { PanelKeys } from './KeyControls'
import { formatEv } from './format'
import { InfoTip, PanelSection, RangeField, SettingRow } from './PanelSection'
import { Radio, RadioGroup, Slider } from './primitives'

const SLIDERS: { key: keyof GradingValues; label: string; tip?: string }[] = [
  { key: 'contrast', get label() { return t('light.grading.contrast') } },
  { key: 'saturation', get label() { return t('light.grading.saturation') }, get tip() { return t('light.grading.saturationTip') } },
  { key: 'warmth', get label() { return t('light.grading.warmth') }, get tip() { return t('light.grading.warmthTip') } },
  { key: 'vignette', get label() { return t('light.grading.vignette') }, get tip() { return t('light.grading.vignetteTip') } },
]

/**
 * A grading preset, one undo step: the four values of the setting, and, for a value that keys drive (the setting is
 * then ignored), its value on the key at the marker, as its slider does (`useKeyedValue`).
 */
function applyGradingPreset(preset: GradingPresetId): void {
  const values = gradingOfPreset(preset)
  const { track } = getFilmSource()
  const atM = Math.round(useAppStore.getState().playback.progress * (track?.stats.distanceM ?? 0))
  getSettingsHistory().transaction(() => {
    useAppStore.getState().setSetting('grading', values)
    editFilm((f) => ({ film: GRADING_KEYS.reduce((film, name) => (hasParamKeys(film, [name]) ? addParamKey(film, atM, name, values[name]).film : film), f) }))
  })
}

const EXPOSURE_EV_MIN = -2
const EXPOSURE_EV_MAX = 2
const EXPOSURE_EV_STEP = 0.5

const GRADING_KEYS: readonly (keyof GradingValues)[] = ['contrast', 'saturation', 'warmth', 'vignette']

/**
 * « Couleurs » (section of the Lumière tab): colour grading of the image, preview and export alike. Preset chips
 * first (one undo step each), then the exposure (atmosphere only) and the four sliders, one row each (name and value,
 * slider and ◀ ◇ ▶ keys on demand).
 */
export function GradingPanel() {
  const t = useT()
  const id = useId()
  const grading = useAppStore((s) => s.settings.grading)
  const keyed = useAppStore((s) => hasGradingKeys(s.settings.film))
  const atmosphere = useAppStore((s) => s.settings.atmosphere)

  return (
    <PanelSection title={t('light.grading.title')} keys={['exposureEv', 'grading']}>
      <div className="field">
        <span id={`${id}-presets`} className="type-label">
          {t('light.grading.preset')}
        </span>
        <RadioGroup
          look="chips"
          className="mt-2"
          aria-labelledby={`${id}-presets`}
          value={grading.preset}
          onChange={(preset) => preset !== 'personnalise' && applyGradingPreset(preset)}
        >
          {GRADING_PRESETS.map((preset) => (
            <Radio key={preset.id} value={preset.id}>
              {preset.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="type-hint">{t('light.grading.custom')}</p>
      </div>

      {keyed && (
        <p className="type-hint">{t('light.grading.keyed')}</p>
      )}

      {atmosphere && <ExposureSlider />}

      {SLIDERS.map((slider) => (
        <GradingSlider key={slider.key} name={slider.key} label={slider.label} tip={slider.tip} />
      ))}
    </PanelSection>
  )
}

/** Exposure compensation on top of the automatic exposure; with keys it shows and edits the key at the marker (`useKeyedValue`). */
function ExposureSlider() {
  const t = useT()
  const exposureSetting = useAppStore((s) => s.settings.exposureEv)
  const exposureKeyed = useAppStore((s) => hasParamKeys(s.settings.film, ['exposure']))
  const setSetting = useAppStore((s) => s.setSetting)
  const [exposureEv, setExposureEv] = useKeyedValue('exposure', exposureSetting, (ev) => setSetting('exposureEv', ev))
  return (
    <SettingRow label={t('light.atmosphere.exposure')} value={formatEv(exposureEv)} paths={['exposureEv']}>
      <RangeField
        label={t('light.atmosphere.exposure')}
        tip={t('light.atmosphere.exposureTip')}
        min={EXPOSURE_EV_MIN}
        max={EXPOSURE_EV_MAX}
        step={EXPOSURE_EV_STEP}
        value={exposureEv}
        format={formatEv}
        onChange={setExposureEv}
      />
      {exposureKeyed && (
        <p className="type-hint">{t('light.atmosphere.exposureKeyed')}</p>
      )}
      <PanelKeys target={{ kind: 'param', param: 'exposure' }} />
    </SettingRow>
  )
}

/** One grading slider: with keys on its value it shows and edits the key at the marker (`useKeyedValue`), else the setting. */
function GradingSlider({ name, label, tip }: { name: keyof GradingValues; label: string; tip?: string }) {
  const grading = useAppStore((s) => s.settings.grading)
  const setSetting = useAppStore((s) => s.setSetting)
  const [value, setValue] = useKeyedValue(name, grading[name], (v) => setSetting('grading', withGradingValue(grading, name, v)))
  const range = GRADING_RANGES[name]
  const text = gradingText(name, value)
  return (
    <SettingRow label={label} value={text} paths={[`grading.${name}`]}>
      <div className="field">
        <div className="flex items-center gap-1">
          <span className="type-label">
            {label}
          </span>
          {tip && <InfoTip text={tip} />}
        </div>
        <Slider aria-label={label} min={range.min} max={range.max} step={range.step} value={value} onChange={setValue} format={() => text} wide={false} />
      </div>
      <PanelKeys target={{ kind: 'param', param: name }} />
    </SettingRow>
  )
}
