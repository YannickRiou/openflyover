import { useId } from 'react'
import { TITLE_CARD_ID } from '../film/cards'
import type { CardId } from '../film/cards'
import { END_CREDITS_MAX, END_START_MAX, END_START_MIN, TITLE_END_MAX, TITLE_END_MIN } from '../overlay/settings'
import type { EndCardSettings, TitleCardSettings } from '../overlay/settings'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { formatPercent } from './format'
import { SizeField, WidgetPosition, WidgetStyleOverrides } from './OverlayPanel'
import { RangeField, TextField } from './PanelSection'

/**
 * Settings of the opening title or of the closing card, in the inspector of its block on the timeline: what it says,
 * where it sits, its size, when it shows (also set by dragging the edge of its block) and its own colours and fonts.
 * They are the settings of the overlay (`overlay.title`, `overlay.end`): the switch is the panel's.
 */
export function CardFields({ card }: { card: CardId }) {
  const id = useId()
  const overlay = useAppStore((s) => s.settings.overlay)
  const trackName = useAppStore((s) => s.tracks[0]?.name)
  const hasTime = useAppStore((s) => s.tracks[0]?.stats.startTime !== undefined)
  const hasWeather = useWeatherStore((s) => s.series !== null)
  const setTitle = (patch: Partial<TitleCardSettings>) => useAppStore.getState().setSetting('overlay', { ...overlay, title: { ...overlay.title, ...patch } })
  const setEnd = (patch: Partial<EndCardSettings>) => useAppStore.getState().setSetting('overlay', { ...overlay, end: { ...overlay.end, ...patch } })
  const placeholder = trackName ?? 'Nom de la trace'

  if (card === TITLE_CARD_ID) {
    const { title } = overlay
    return (
      <>
        <TextField label="Titre" value={title.title} placeholder={placeholder} onChange={(value) => setTitle({ title: value })} />
        <TextField label="Sous-titre" value={title.subtitle} placeholder="Lieu, occasion…" onChange={(subtitle) => setTitle({ subtitle })} />
        <label className="checkbox">
          <input type="checkbox" checked={title.showDate && hasTime} disabled={!hasTime} onChange={(e) => setTitle({ showDate: e.currentTarget.checked })} />
          Date de la sortie
        </label>
        <WidgetPosition widget="title" />
        <SizeField value={title.size} onChange={(size) => setTitle({ size })} />
        <RangeField
          label="Durée d'affichage"
          min={TITLE_END_MIN}
          max={TITLE_END_MAX}
          step={0.01}
          value={title.end}
          format={(v) => `${formatPercent(v)} du survol`}
          onChange={(end) => setTitle({ end })}
        />
        <WidgetStyleOverrides widget="title" />
      </>
    )
  }

  const { end } = overlay
  return (
    <>
      <TextField label="Titre" value={end.title} placeholder={placeholder} onChange={(title) => setEnd({ title })} />
      <label className="checkbox">
        <input type="checkbox" checked={end.showWeather && hasWeather} disabled={!hasWeather} onChange={(e) => setEnd({ showWeather: e.currentTarget.checked })} />
        Météo de la sortie
      </label>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-credits`}>
          Générique
        </label>
        <textarea
          id={`${id}-credits`}
          className="input input--multiline"
          rows={4}
          maxLength={END_CREDITS_MAX}
          placeholder={'Une ligne par nom\nMusique : …'}
          value={end.credits ?? ''}
          onChange={(e) => setEnd({ credits: e.currentTarget.value || undefined })}
        />
        <p className="field__hint">Rempli, il défile sous la carte jusqu’à la fin du film, centré.</p>
      </div>
      <WidgetPosition widget="end" />
      <SizeField value={end.size} onChange={(size) => setEnd({ size })} />
      <RangeField
        label="Apparition"
        min={END_START_MIN}
        max={END_START_MAX}
        step={0.01}
        value={end.start}
        format={(v) => `à ${formatPercent(v)} du survol`}
        onChange={(start) => setEnd({ start })}
      />
      <WidgetStyleOverrides widget="end" />
    </>
  )
}
