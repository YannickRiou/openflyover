import { useId } from 'react'
import { hasGradingKeys } from '../film/paramKeys'
import { t, useT } from '../i18n'
import { getSettingsHistory } from '../project/history'
import { GRADING_PRESETS, GRADING_RANGES, gradingOfPreset, withGradingValue } from '../scene/grading'
import type { GradingValues } from '../scene/grading'
import { useAppStore } from '../state/store'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, SettingRow } from './PanelSection'
import { formatNumber, formatPercent } from './format'
import { Radio, RadioGroup } from './primitives'

const SLIDERS: { key: keyof GradingValues; label: string; tip?: string }[] = [
  { key: 'contrast', get label() { return t('light.grading.contrast') } },
  { key: 'saturation', get label() { return t('light.grading.saturation') }, get tip() { return t('light.grading.saturationTip') } },
  { key: 'warmth', get label() { return t('light.grading.warmth') }, get tip() { return t('light.grading.warmthTip') } },
  { key: 'vignette', get label() { return t('light.grading.vignette') }, get tip() { return t('light.grading.vignetteTip') } },
]

/** −0.25 -> "−25", 0.3 -> "+30", 0 -> "0" */
function formatSigned(v: number): string {
  const percent = Math.round(v * 100)
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${formatNumber(Math.abs(percent))}`
}

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
        <span id={`${id}-presets`} className="field__label">
          {t('light.grading.preset')}
        </span>
        <RadioGroup
          look="chips"
          className="sun-chips"
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
        {grading.preset === 'personnalise' && <p className="field__hint">{t('light.grading.custom')}</p>}
      </div>

      {keyed && (
        <p className="field__hint">{t('light.grading.keyed')}</p>
      )}

      {SLIDERS.map(({ key, label, tip }) => {
        const range = GRADING_RANGES[key]
        const inputId = `${id}-${key}`
        const text = key === 'vignette' ? formatPercent(grading[key]) : formatSigned(grading[key])
        return (
          <SettingRow key={key} label={label} value={text} paths={[`grading.${key}`]}>
            <div className="field">
              <div className="field__label-row">
                <label className="field__label" htmlFor={inputId}>
                  {label}
                </label>
                {tip && <InfoTip text={tip} />}
              </div>
              <div className="range-row">
                <input
                  id={inputId}
                  className="range"
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={grading[key]}
                  onChange={(e) => setSetting('grading', withGradingValue(grading, key, Number(e.currentTarget.value)))}
                  aria-valuetext={text}
                />
                <output className="range-row__value" htmlFor={inputId}>
                  {text}
                </output>
              </div>
            </div>
            <PanelKeys target={{ kind: 'param', param: key }} />
          </SettingRow>
        )
      })}
    </PanelSection>
  )
}
