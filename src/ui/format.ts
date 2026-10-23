/**
 * Number formatting for the UI, in the language of the interface (`Intl`, through `i18n/format.ts`): « 1 234,5 » in French
 * (narrow no-break space thousands separator, decimal comma), « 1,234.5 » in English. Units and patterns (« 4 h 12 »)
 * are messages of the `format` domain.
 */
import type { TrackStats } from '../core/types'
import { t } from '../i18n'
import { formatNumberIntl } from '../i18n/format'

const PLACEHOLDER = '–'

/** 1234567.8 -> "1 234 567,8" (French) / "1,234,567.8" (English); `fractionDigits` decimals, no sign on a value that rounds to zero. */
export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return PLACEHOLDER
  return formatNumberIntl(value, fractionDigits)
}

/** 0.5 -> "+0,5 IL" (stops of light) */
export function formatEv(ev: number): string {
  return t('light.ev', { value: `${ev > 0 ? '+' : ev < 0 ? '−' : ''}${formatNumber(Math.abs(ev), 1)}` })
}

/** bytes -> "420 Mo", "1,2 Go" (French) / "420 MB", "1.2 GB" (English) */
export function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? t('format.gigabytes', { value: formatNumber(bytes / 1e9, 1) }) : t('format.megabytes', { value: formatNumber(Math.max(bytes, 0) / 1e6) })
}

/** 4 -> "4", 4.5 -> "4,5", 1.25 -> "1,25" */
export function formatShort(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2)
}

/** 0.35 -> "35 %" (a share in [0, 1]). */
export function formatPercent(share: number): string {
  return t('format.percent', { value: formatNumber(share * 100) })
}

/** 1.5 -> "1,5 s", 1.25 -> "1,25 s": seconds with only the decimals they need (two at most). */
export function formatSecondsShort(seconds: number): string {
  return t('format.seconds', { value: formatNumberIntl(seconds, 2, 0) })
}

/**
 * How many times faster than the outing the flyover runs: recorded time (start to end, nights included) over the
 * flyover duration, « × 24 » (one decimal under 10); null when the track has no times.
 */
export function formatSpeedUp(recordedS: number | undefined, flightS: number): string | null {
  if (recordedS === undefined || !(recordedS > 0) || !(flightS > 0)) return null
  const ratio = recordedS / flightS
  return `× ${ratio >= 10 ? Math.round(ratio) : formatNumber(ratio, 1)}`
}

/** Metres -> "850 m" below 1 km, otherwise "12,4 km" (999,6 m rounds up to "1,0 km", never "1 000 m"). */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return PLACEHOLDER
  if (Math.round(metres) < 1000) return `${formatNumber(metres)} m`
  return `${formatNumber(metres / 1000, 1)} km`
}

/** Metres of climb -> "980 m" (rounded, never negative). */
export function formatAscent(metres: number): string {
  if (!Number.isFinite(metres)) return PLACEHOLDER
  return `${formatNumber(Math.max(0, metres))} m`
}

/** Seconds -> "4 h 12" (minutes zero-padded) or "35 min" under one hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return PLACEHOLDER
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return t('format.minutes', { minutes })
  return t('format.hoursMinutes', { hours, minutes: String(minutes).padStart(2, '0') })
}

/** Slowest pace shown (km/h): below it the outing is stopped and a pace in minutes per km means nothing. */
export const PACE_MIN_KMH = 1

/** Speed (km/h) -> pace « 5:42 » (minutes and seconds per km), null when stopped or unknown. */
export function formatPace(kmh: number | undefined): string | null {
  if (kmh === undefined || !Number.isFinite(kmh) || kmh < PACE_MIN_KMH) return null
  const total = Math.round(3600 / kmh)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "12,4 km · D+ 980 m · 4 h 12" (duration omitted when unknown). */
export function formatTrackSummary(stats: TrackStats): string {
  const parts = [formatDistance(stats.distanceM), t('format.ascent', { value: formatAscent(stats.ascentM) })]
  if (stats.durationS !== undefined && stats.durationS > 0) parts.push(formatDuration(stats.durationS))
  return parts.join(' · ')
}

const MINUS = '−'

/** Time gap (ms, positive = behind) -> "+45 s", "+1 min 20", "−1 h 05", "0 s". */
export function formatTimeGap(ms: number): string {
  if (!Number.isFinite(ms)) return PLACEHOLDER
  const total = Math.round(Math.abs(ms) / 1000)
  if (total === 0) return t('format.seconds', { value: 0 })
  const sign = ms > 0 ? '+' : MINUS
  if (total < 60) return `${sign}${t('format.seconds', { value: total })}`
  if (total < 3600) return `${sign}${t('format.minutesSeconds', { minutes: Math.floor(total / 60), seconds: String(total % 60).padStart(2, '0') })}`
  const minutes = Math.round(total / 60)
  return `${sign}${t('format.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })}`
}

/** Distance gap (m, negative = behind) -> "−350 m", "+1,2 km", "0 m". */
export function formatDistanceGap(metres: number): string {
  if (!Number.isFinite(metres)) return PLACEHOLDER
  if (Math.round(metres) === 0) return '0 m'
  return `${metres > 0 ? '+' : MINUS}${formatDistance(Math.abs(metres))}`
}

/** -30 -> "−30°" */
export function formatDegrees(deg: number): string {
  return `${deg < 0 ? '−' : ''}${formatNumber(Math.abs(deg))}°`
}

/** Instant -> "14 h 32" (French) / "14:32" (English), in the browser time zone (as the timeline). */
export function formatClock(ms: number): string {
  const date = new Date(ms)
  return t('format.clock', { hours: date.getHours(), minutes: String(date.getMinutes()).padStart(2, '0') })
}
