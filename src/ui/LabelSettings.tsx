import { t, useT } from '../i18n'
import { KM_MARKER_STEPS, LABEL_RANGE_KM, LABEL_SIZE_RANGE } from '../scene/labelModel'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'
import { RangeField, SettingRow } from './PanelSection'
import { Checkbox, Select } from './primitives'

/** 0 -> "Aucune", 1 -> "Tous les kilomètres", 5 -> "Tous les 5 km" */
const kmStepLabel = (step: number) =>
  step === 0 ? t('track.labels.kmStepNone') : step === 1 ? t('track.labels.kmStepOne') : t('track.labels.kmStepMany', { step })

/** « Étiquettes » section of the Trace tab: which 3D labels are shown in the view, the kilometre markers, size and range. */
export function LabelSettings() {
  const tr = useT()
  const labels = useAppStore((s) => s.settings.labels)
  const setSetting = useAppStore((s) => s.setSetting)

  return (
    <>
      <fieldset className="field fieldset">
        <legend className="field__label">{tr('track.labels.legend')}</legend>
        <Checkbox
          checked={labels.waypoints}
          onChange={(on) => setSetting('labels', { ...labels, waypoints: on })}
        >
          {tr('track.labels.waypoints')}
        </Checkbox>
        <Checkbox
          checked={labels.endpoints}
          onChange={(on) => setSetting('labels', { ...labels, endpoints: on })}
        >
          {tr('track.labels.endpoints')}
        </Checkbox>
        <Checkbox checked={labels.photos} onChange={(on) => setSetting('labels', { ...labels, photos: on })}>{tr('track.labels.photos')}</Checkbox>
      </fieldset>
      <SettingRow label={tr('track.labels.kmMarkers')} value={kmStepLabel(labels.kmStep)} paths={['labels.kmStep']}>
        <div className="field">
          <span className="field__label">{tr('track.labels.kmMarkers')}</span>
          <Select
            aria-label={tr('track.labels.kmMarkers')}
            value={labels.kmStep}
            options={KM_MARKER_STEPS.map((step) => ({ value: step, label: kmStepLabel(step) }))}
            onChange={(kmStep) => setSetting('labels', { ...labels, kmStep })}
          />
        </div>
      </SettingRow>
      <SettingRow label={tr('track.labels.size')} value={`×${formatNumber(labels.size, 1)}`} paths={['labels.size']}>
        <RangeField
          label={tr('track.labels.sizeShort')}
          {...LABEL_SIZE_RANGE}
          value={labels.size}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(size) => setSetting('labels', { ...labels, size })}
        />
      </SettingRow>
      <SettingRow label={tr('track.labels.range')} value={`${formatNumber(labels.rangeKm)} km`} paths={['labels.rangeKm']}>
        <RangeField
          label={tr('track.labels.rangeShort')}
          {...LABEL_RANGE_KM}
          value={labels.rangeKm}
          format={(v) => `${formatNumber(v)} km`}
          onChange={(rangeKm) => setSetting('labels', { ...labels, rangeKm })}
        />
      </SettingRow>
    </>
  )
}
