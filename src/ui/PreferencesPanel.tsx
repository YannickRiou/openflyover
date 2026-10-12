import { getPlatform } from '../platform'
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
 * bar shows, the clock time on the timeline.
 */
export function PreferencesPanel() {
  const prefs = usePreferences()
  const desktop = getPlatform().capabilities.isDesktop
  // the memory of the JavaScript engine is only told by Chromium; the machine's load only by the desktop app
  const heap = 'memory' in performance
  const perfKeys = PERF_ITEMS.filter((key) => (key === 'memory' ? heap : key === 'system' ? desktop : true))

  return (
    <>
      <p className="field__hint prefs__intro">Ces réglages valent pour cet appareil, pas pour le projet.</p>
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
    </>
  )
}
