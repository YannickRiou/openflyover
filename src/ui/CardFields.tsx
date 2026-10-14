import { useId } from 'react'
import { TITLE_CARD_ID } from '../film/cards'
import { useT } from '../i18n'
import type { CardId } from '../film/cards'
import { END_CREDITS_MAX, END_START_MAX, END_START_MIN, TITLE_END_MAX, TITLE_END_MIN } from '../overlay/settings'
import type { EndCardSettings, TitleCardSettings } from '../overlay/settings'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { formatPercent } from './format'
import { SizeField, WidgetPosition, WidgetStyleOverrides } from './OverlayPanel'
import { RangeField } from './PanelSection'
import { Checkbox, TextField } from './primitives'

/**
 * Settings of the opening title or of the closing card, in the inspector of its block on the timeline: what it says,
 * where it sits, its size, when it shows (also set by dragging the edge of its block) and its own colours and fonts.
 * They are the settings of the overlay (`overlay.title`, `overlay.end`): the switch is the panel's.
 */
export function CardFields({ card }: { card: CardId }) {
  const t = useT()
  const id = useId()
  const overlay = useAppStore((s) => s.settings.overlay)
  const trackName = useAppStore((s) => s.tracks[0]?.name)
  const hasTime = useAppStore((s) => s.tracks[0]?.stats.startTime !== undefined)
  const hasWeather = useWeatherStore((s) => s.series !== null)
  const setTitle = (patch: Partial<TitleCardSettings>) => useAppStore.getState().setSetting('overlay', { ...overlay, title: { ...overlay.title, ...patch } })
  const setEnd = (patch: Partial<EndCardSettings>) => useAppStore.getState().setSetting('overlay', { ...overlay, end: { ...overlay.end, ...patch } })
  const placeholder = trackName ?? t('inspector.card.trackName')

  if (card === TITLE_CARD_ID) {
    const { title } = overlay
    return (
      <>
        <TextField label={t('inspector.card.title')} value={title.title} placeholder={placeholder} onChange={(value) => setTitle({ title: value })} />
        <TextField label={t('inspector.card.subtitle')} value={title.subtitle} placeholder={t('inspector.card.subtitlePlaceholder')} onChange={(subtitle) => setTitle({ subtitle })} />
        <Checkbox
          checked={title.showDate && hasTime}
          disabled={!hasTime}
          onChange={(on) => setTitle({ showDate: on })}
        >
          {t('inspector.card.showDate')}
        </Checkbox>
        <WidgetPosition widget="title" />
        <SizeField value={title.size} onChange={(size) => setTitle({ size })} />
        <RangeField
          label={t('inspector.card.duration')}
          min={TITLE_END_MIN}
          max={TITLE_END_MAX}
          step={0.01}
          value={title.end}
          format={(v) => t('inspector.card.ofFlyover', { value: formatPercent(v) })}
          onChange={(end) => setTitle({ end })}
        />
        <WidgetStyleOverrides widget="title" />
      </>
    )
  }

  const { end } = overlay
  return (
    <>
      <TextField label={t('inspector.card.title')} value={end.title} placeholder={placeholder} onChange={(title) => setEnd({ title })} />
      <Checkbox
        checked={end.showWeather && hasWeather}
        disabled={!hasWeather}
        onChange={(on) => setEnd({ showWeather: on })}
      >
        {t('inspector.card.showWeather')}
      </Checkbox>
      <div className="field">
        <label className="type-label" htmlFor={`${id}-credits`}>
          {t('inspector.card.credits')}
        </label>
        <textarea
          id={`${id}-credits`}
          className="input resize-y px-3 py-2 leading-[1.4]"
          rows={4}
          maxLength={END_CREDITS_MAX}
          placeholder={t('inspector.card.creditsPlaceholder')}
          value={end.credits ?? ''}
          onChange={(e) => setEnd({ credits: e.currentTarget.value || undefined })}
        />
        <p className="type-hint">{t('inspector.card.creditsHint')}</p>
      </div>
      <WidgetPosition widget="end" />
      <SizeField value={end.size} onChange={(size) => setEnd({ size })} />
      <RangeField
        label={t('inspector.card.appearance')}
        min={END_START_MIN}
        max={END_START_MAX}
        step={0.01}
        value={end.start}
        format={(v) => t('inspector.card.atOfFlyover', { value: formatPercent(v) })}
        onChange={(start) => setEnd({ start })}
      />
      <WidgetStyleOverrides widget="end" />
    </>
  )
}
