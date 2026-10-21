import { useId, useState } from 'react'
import { TITLE_CARD_ID } from '../film/cards'
import { useT } from '../i18n'
import type { CardId } from '../film/cards'
import { fileToLogoDataUrl } from '../overlay/assets'
import { cardFigureLabel, endFigures } from '../overlay/draw'
import { CARD_FIGURES, CARD_LINE_MAX, END_CREDITS_MAX } from '../overlay/settings'
import type { EndCardSettings, TitleCardSettings } from '../overlay/settings'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { SizeField, WidgetPosition, WidgetStyleOverrides } from './OverlayPanel'
import { Button, Checkbox, Chip, TextField } from './primitives'

/**
 * Settings of the opening title or of the closing card, in the inspector of its block on the timeline: what it says,
 * where it sits, its size and its own colours and fonts. When it shows is where its block is on the timeline: drag the
 * block, or an edge of it.
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
  const [imageError, setImageError] = useState<string | null>(null)

  const chooseImage = async () => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: t('marker.image.filter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] })
      if (!file) return
      setImageError(null)
      const image = await fileToLogoDataUrl(file)
      // the settings as they are now (another change or an undo may have happened during the decoding)
      const now = useAppStore.getState().settings.overlay
      useAppStore.getState().setSetting('overlay', { ...now, end: { ...now.end, image } })
    } catch {
      setImageError(t('marker.image.error'))
    }
  }

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
        <WidgetStyleOverrides widget="title" />
      </>
    )
  }

  const { end } = overlay
  const figures = endFigures(end)
  return (
    <>
      <TextField label={t('inspector.card.title')} value={end.title} placeholder={placeholder} onChange={(title) => setEnd({ title })} />
      <TextField
        label={t('inspector.card.line')}
        value={end.line ?? ''}
        placeholder={t('inspector.card.linePlaceholder')}
        maxLength={CARD_LINE_MAX}
        onChange={(line) => setEnd({ line: line || undefined })}
      />
      <fieldset className="field min-w-0">
        <legend className="type-label mb-1">{t('inspector.card.figures')}</legend>
        <div className="chips">
          {CARD_FIGURES.map((figure) => (
            <Chip
              key={figure}
              checked={figures.includes(figure)}
              onChange={(on) => setEnd({ figures: CARD_FIGURES.filter((f) => (f === figure ? on : figures.includes(f))) })}
            >
              {cardFigureLabel(figure)}
            </Chip>
          ))}
        </div>
        <p className="type-hint">{t('inspector.card.figuresHint')}</p>
      </fieldset>
      <Checkbox checked={end.showProfile ?? false} onChange={(on) => setEnd({ showProfile: on || undefined })}>
        {t('inspector.card.showProfile')}
      </Checkbox>
      <Checkbox checked={end.showMinimap ?? false} onChange={(on) => setEnd({ showMinimap: on || undefined })}>
        {t('inspector.card.showMinimap')}
      </Checkbox>
      <div className="field">
        <span className="type-label">{t('inspector.card.image')}</span>
        <div className="flex gap-2 *:min-w-0 *:flex-1">
          <Button onClick={() => void chooseImage()}>{end.image ? t('marker.image.change') : t('marker.image.choose')}</Button>
          {end.image && <Button onClick={() => setEnd({ image: undefined })}>{t('marker.image.remove')}</Button>}
        </div>
        {imageError && (
          <p className="type-hint" role="alert">
            {imageError}
          </p>
        )}
        <p className="type-hint">{t('inspector.card.graphicsHint')}</p>
      </div>
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
      <WidgetStyleOverrides widget="end" />
    </>
  )
}
