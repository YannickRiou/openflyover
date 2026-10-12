import { KM_MARKER_STEPS, LABEL_RANGE_KM, LABEL_SIZE_RANGE } from '../scene/labelModel'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'
import { RangeField, SettingRow } from './PanelSection'

/** 0 -> "Aucune", 1 -> "Tous les kilomètres", 5 -> "Tous les 5 km" */
const kmStepLabel = (step: number) => (step === 0 ? 'Aucune' : step === 1 ? 'Tous les kilomètres' : `Tous les ${step} km`)

/** « Étiquettes » section of the Trace tab: which 3D labels are shown in the view, the kilometre markers, size and range. */
export function LabelSettings() {
  const labels = useAppStore((s) => s.settings.labels)
  const setSetting = useAppStore((s) => s.setSetting)

  return (
    <>
      <fieldset className="field fieldset">
        <legend className="field__label">Étiquettes dans la vue</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.waypoints}
            onChange={(e) => setSetting('labels', { ...labels, waypoints: e.currentTarget.checked })}
          />
          Points nommés du fichier GPX
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.endpoints}
            onChange={(e) => setSetting('labels', { ...labels, endpoints: e.currentTarget.checked })}
          />
          Départ et arrivée
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={labels.photos} onChange={(e) => setSetting('labels', { ...labels, photos: e.currentTarget.checked })} />
          Photos, là où elles ont été prises
        </label>
      </fieldset>
      <SettingRow label="Bornes kilométriques" value={kmStepLabel(labels.kmStep)} paths={['labels.kmStep']}>
        <label className="field">
          <span className="field__label">Bornes kilométriques</span>
          <select
            className="select"
            value={labels.kmStep}
            onChange={(e) => setSetting('labels', { ...labels, kmStep: Number(e.currentTarget.value) })}
          >
            {KM_MARKER_STEPS.map((step) => (
              <option key={step} value={step}>
                {kmStepLabel(step)}
              </option>
            ))}
          </select>
        </label>
      </SettingRow>
      <SettingRow label="Taille des étiquettes" value={`×${formatNumber(labels.size, 1)}`} paths={['labels.size']}>
        <RangeField
          label="Taille"
          {...LABEL_SIZE_RANGE}
          value={labels.size}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(size) => setSetting('labels', { ...labels, size })}
        />
      </SettingRow>
      <SettingRow label="Portée des étiquettes" value={`${formatNumber(labels.rangeKm)} km`} paths={['labels.rangeKm']}>
        <RangeField
          label="Portée"
          {...LABEL_RANGE_KM}
          value={labels.rangeKm}
          format={(v) => `${formatNumber(v)} km`}
          onChange={(rangeKm) => setSetting('labels', { ...labels, rangeKm })}
        />
      </SettingRow>
    </>
  )
}
