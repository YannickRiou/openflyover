import type { PresetKnob } from '../export/qualityTier'
import { t, useT } from '../i18n'
import { LENS_RANGES } from '../scene/lens'
import type { LensSettings } from '../scene/lens'
import { useAppStore } from '../state/store'
import { PanelSection, RangeField, SettingRow } from './PanelSection'
import type { WeightKey } from './renderCost'
import { formatPercent } from './format'

function formatAmount(value: number): string {
  return value > 0 ? formatPercent(value) : t('lens.off')
}

/** Always open: the three effects that change every shot. */
const SLIDERS: { key: keyof LensSettings; label: string; tip: string; weight?: WeightKey; preset?: PresetKnob }[] = [
  {
    key: 'shutter',
    weight: 'shutter',
    preset: 'shutter',
    get label() { return t('lens.shutter.label') },
    get tip() { return t('lens.shutter.tip') },
  },
  { key: 'bloom', get label() { return t('lens.bloom.label') }, get tip() { return t('lens.bloom.tip') } },
  { key: 'depthOfField', weight: 'depthOfField', get label() { return t('lens.dof.label') }, get tip() { return t('lens.dof.tip') } },
]

/** « Objectif » tab (scene/lens.ts): motion blur, bloom and depth of field open; flare and bloom radius as rows. */
export function LensPanel() {
  const t = useT()
  const lens = useAppStore((s) => s.settings.lens)
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const setSetting = useAppStore((s) => s.setSetting)
  const set = (key: keyof LensSettings, value: number) => setSetting('lens', { ...lens, [key]: value })

  return (
    <PanelSection title={t('lens.title')} keys={['lens']}>
      {SLIDERS.map(({ key, label, tip, weight, preset }) => (
        <RangeField key={key} label={label} tip={tip} weight={weight} preset={preset} {...LENS_RANGES[key]} value={lens[key]} format={formatAmount} onChange={(value) => set(key, value)} />
      ))}
      <SettingRow label={t('lens.flare.label')} value={formatAmount(lens.flare)} paths={['lens.flare']}>
        <RangeField
          label={t('lens.flare.label')}
          tip={t('lens.flare.tip')}
          {...LENS_RANGES.flare}
          value={lens.flare}
          format={formatAmount}
          disabled={!atmosphere}
          onChange={(value) => set('flare', value)}
        />
      </SettingRow>
      <SettingRow label={t('lens.bloomRadius.label')} value={formatPercent(lens.bloomRadius)} paths={['lens.bloomRadius']}>
        <RangeField
          label={t('lens.bloomRadius.label')}
          {...LENS_RANGES.bloomRadius}
          value={lens.bloomRadius}
          format={formatPercent}
          disabled={lens.bloom === 0}
          onChange={(value) => set('bloomRadius', value)}
        />
      </SettingRow>
    </PanelSection>
  )
}
