import { useId } from 'react'
import { gradingText, hasGradingKeys } from '../film/paramKeys'
import { t, useT } from '../i18n'
import { getSettingsHistory } from '../project/history'
import { GRADING_PRESETS, GRADING_RANGES, gradingOfPreset, withGradingValue } from '../scene/grading'
import type { GradingValues } from '../scene/grading'
import { useKeyedValue } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, SettingRow } from './PanelSection'
import { Radio, RadioGroup, Slider } from './primitives'

const SLIDERS: { key: keyof GradingValues; label: string; tip?: string }[] = [
  { key: 'contrast', get label() { return t('light.grading.contrast') } },
  { key: 'saturation', get label() { return t('light.grading.saturation') }, get tip() { return t('light.grading.saturationTip') } },
  { key: 'warmth', get label() { return t('light.grading.warmth') }, get tip() { return t('light.grading.warmthTip') } },
  { key: 'vignette', get label() { return t('light.grading.vignette') }, get tip() { return t('light.grading.vignetteTip') } },
]

/**
 * « Couleurs » (section of the Lumière tab): colour grading of the image, preview and export alike. Preset chips
 * first (one undo step each), then the four sliders, one row each (name and value, slider and ◀ ◇ ▶ keys on demand).
 */
export function GradingPanel() {
  const t = useT()
  const id = useId()
  const grading = useAppStore((s) => s.settings.grading)
  const keyed = useAppStore((s) => hasGradingKeys(s.settings.film))
  const setSetting = useAppStore((s) => s.setSetting)

  return (
    <PanelSection title={t('light.grading.title')} keys={['grading']}>
      <div className="field">
        <span id={`${id}-presets`} className="type-label">
          {t('light.grading.preset')}
        </span>
        <RadioGroup
          look="chips"
          className="mt-2"
          aria-labelledby={`${id}-presets`}
          value={grading.preset}
          onChange={(preset) => preset !== 'personnalise' && getSettingsHistory().transaction(() => setSetting('grading', gradingOfPreset(preset)))}
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

      {SLIDERS.map((slider) => (
        <GradingSlider key={slider.key} name={slider.key} label={slider.label} tip={slider.tip} />
      ))}
    </PanelSection>
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
