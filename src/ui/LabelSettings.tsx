import { t, useT } from '../i18n'
import { playsBilan } from '../flyover/sequence'
import { KM_MARKER_STEPS, LABEL_RANGE_KM, LABEL_SIZE_RANGE } from '../scene/labelModel'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'
import { RangeField, SettingRow } from './PanelSection'
import { Checkbox, Select } from './primitives'

/** 0 -> "Aucune", 1 -> "Tous les kilomètres", 5 -> "Tous les 5 km" */
const kmStepLabel = (step: number) =>
  step === 0 ? t('track.labels.kmStepNone') : step === 1 ? t('track.labels.kmStepOne') : t('track.labels.kmStepMany', { step })

/** « Étiquettes 3D » section of the Habillage tab: which 3D labels are shown in the view, the kilometre markers, size and range. */
export function LabelSettings() {
  const tr = useT()
  const labels = useAppStore((s) => s.settings.labels)
  const setSetting = useAppStore((s) => s.setSetting)
  // what has nothing to label is not offered: no named point in the files, no photo or video on the timeline; a Bilan shows no kilometre nor end
  const hasWaypoints = useAppStore((s) => s.tracks.some((track) => (track.waypoints?.length ?? 0) > 0))
  const hasMedia = useAppStore((s) => s.settings.film.media.length > 0)
  const bilan = useAppStore((s) => playsBilan(s.settings.race, s.tracks.length))

  return (
    <>
      <fieldset className="field min-w-0">
        <legend className="type-label mb-1">{tr('track.labels.legend')}</legend>
        {hasWaypoints && (
        <Checkbox
          checked={labels.waypoints}
          onChange={(on) => setSetting('labels', { ...labels, waypoints: on })}
        >
          {tr('track.labels.waypoints')}
        </Checkbox>
        )}
        {!bilan && (
        <Checkbox
          checked={labels.endpoints}
          onChange={(on) => setSetting('labels', { ...labels, endpoints: on })}
        >
          {tr('track.labels.endpoints')}
        </Checkbox>
        )}
        {hasMedia && (
          <>
        <Checkbox checked={labels.photos} onChange={(on) => setSetting('labels', { ...labels, photos: on })}>{tr('track.labels.photos')}</Checkbox>
        <Checkbox checked={labels.photoPins} onChange={(on) => setSetting('labels', { ...labels, photoPins: on })}>{tr('track.labels.photoPins')}</Checkbox>
        <p className="type-hint">{tr('track.labels.photoPinsHint')}</p>
          </>
        )}
      </fieldset>
      {!bilan && (
      <SettingRow label={tr('track.labels.kmMarkers')} value={kmStepLabel(labels.kmStep)} paths={['labels.kmStep']}>
        <div className="field">
          <span className="type-label">{tr('track.labels.kmMarkers')}</span>
          <Select
            aria-label={tr('track.labels.kmMarkers')}
            value={labels.kmStep}
            options={KM_MARKER_STEPS.map((step) => ({ value: step, label: kmStepLabel(step) }))}
            onChange={(kmStep) => setSetting('labels', { ...labels, kmStep })}
          />
        </div>
      </SettingRow>
      )}
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
          tip={tr('track.labels.rangeTip')}
          {...LABEL_RANGE_KM}
          value={labels.rangeKm}
          format={(v) => `${formatNumber(v)} km`}
          onChange={(rangeKm) => setSetting('labels', { ...labels, rangeKm })}
        />
      </SettingRow>
    </>
  )
}
