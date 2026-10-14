import { useMemo } from 'react'
import { TRACK_METRICS, robustRange, trackMetricValues } from '../flyover/trackColor'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'

/** Over the 3D view, bottom left, on ink: it never takes the pointer. */
const LEGEND =
  'pointer-events-none absolute top-auto right-auto bottom-4 left-4 flex w-55 flex-col gap-1 rounded-md bg-chrome px-3 py-2 text-hint tabular-nums text-white'

/**
 * Legend of the track colouring over the 3D view: quantity, colormap, and the shared colour range
 * (2nd–98th percentile: values beyond saturate at the ends), and the grey of the points without a value.
 */
export function TrackLegend() {
  const t = useT()
  const tracks = useAppStore((s) => s.tracks)
  const colorBy = useAppStore((s) => s.settings.trackColorBy)
  const { range, missing } = useMemo(() => {
    if (colorBy === 'none') return { range: null, missing: false }
    const series = tracks.flatMap((track) => trackMetricValues(track, colorBy))
    return { range: robustRange(series), missing: series.some((values) => values.some(Number.isNaN)) }
  }, [tracks, colorBy])

  if (colorBy === 'none' || tracks.length === 0) return null
  const { label, unit, fractionDigits, colormap } = TRACK_METRICS[colorBy]
  const format = (value: number) => `${formatNumber(value, fractionDigits)} ${unit}`

  return (
    <div className={LEGEND} role="group" aria-label={t('track.legend.aria', { label })}>
      <span className="font-semibold">{label}</span>
      {range ? (
        <>
          <span
            className="h-2.5 rounded-[2px]"
            style={{ backgroundImage: `linear-gradient(to right, ${colormap.join(', ')})` }}
            title={t('track.legend.extremes')}
          />
          <span className="flex justify-between">
            <span>{format(range.min)}</span>
            <span>{format(range.max)}</span>
          </span>
        </>
      ) : null}
      {missing && (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-4 rounded-[2px] border border-white bg-ink-soft" />
          {range ? t('track.legend.noValue') : t('track.legend.noData')}
        </span>
      )}
    </div>
  )
}
