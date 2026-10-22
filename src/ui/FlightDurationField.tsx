import { useState } from 'react'
import { clamp } from '../core/math'
import { t, useT } from '../i18n'
import { FLYOVER_DURATION_RANGE } from '../flyover/cameraSettings'
import {
  durationAtSliderPosition,
  durationForKmh,
  durationForSpeedUp,
  hasSpeedUp,
  kmhRange,
  recordedTotalS,
  speedKmh,
  speedPosition,
  speedUpFactor,
  speedUpRange,
  SPEED_POSITIONS,
} from '../flyover/flightSpeed'
import { correctedStats } from '../import/stats'
import { setFlightTiming, useFilmClock, useFilmSequence, useFilmSource, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDuration, formatNumber, formatSpeedUp } from './format'
import { InfoTip } from './PanelSection'
import { Button, NumberField, Slider, ToggleButton, ToggleButtonGroup } from './primitives'

/** « − » and « + » around the duration slider: the fine adjustment the slider only roughly reaches (a square the height of a control). */
const STEP_BUTTON = 'w-control flex-none px-0'

type Face = 'duration' | 'speed'

/** 90 -> "1 min 30 s", 45 -> "45 s" */
function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  if (m === 0) return `${s} s`
  return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, '0')} s`
}

/** 190.4 -> "190 km/h", 3.64 -> "3,6 km/h" */
const formatKmh = (kmh: number) => t('camera.speed.kmh', { value: formatNumber(kmh, kmh < 10 ? 1 : 0) })

/**
 * « Durée du survol »: the one setting (`flyoverDurationS`) set by its duration or by the marker's average speed (× the
 * recorded time and km/h, or km/h alone for an outing without times). Only the duration is stored; the face chosen is
 * the panel's (it opens on the duration). The other face is written beside it, read only.
 */
export function FlightDurationField() {
  const t = useT()
  const [face, setFace] = useState<Face>('duration')
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const film = useFilmClock()
  const { stageIds, film: filmSettings } = useFilmSource()
  const track = useFilmTrack()
  const lengthM = track?.stats.distanceM ?? 0
  // the recorded time of what is flown: each stage's own (the nights between two days are not part of it)
  const sequence = useFilmSequence()
  const recordedS = track ? recordedTotalS((sequence ? sequence.stages.map((s) => s.track) : [track]).map((tr) => correctedStats(tr).durationS)) : undefined
  const stopCount = film.stops.length
  // « À la suite »: the stages whose flight time is set on the timeline take theirs out of the duration
  const timedStages = stageIds?.filter((id) => filmSettings.stageDurations?.[id] !== undefined).length ?? 0
  const set = (next: number | undefined) => next !== undefined && next !== durationS && setFlightTiming({ durationS: next })
  /** one notch of the slider, one way or the other, kept inside the range */
  const stepDuration = (direction: 1 | -1) =>
    setFlightTiming({ durationS: clamp(durationS + direction * FLYOVER_DURATION_RANGE.step, FLYOVER_DURATION_RANGE.min, FLYOVER_DURATION_RANGE.max) })

  const kmh = speedKmh(lengthM, durationS)
  const timed = hasSpeedUp(recordedS)
  const upFactor = timed ? speedUpFactor(recordedS, durationS) : undefined
  const speedUp = timed ? formatSpeedUp(recordedS, durationS) : null
  const asSpeed =
    kmh === undefined
      ? undefined
      : speedUp
        ? t('camera.speed.asSpeedUp', { speedUp, recorded: formatDuration(recordedS ?? 0), kmh: formatKmh(kmh) })
        : t('camera.speed.asKmh', { kmh: formatKmh(kmh) })
  const speedWords = (d: number) => {
    const k = speedKmh(lengthM, d)
    const up = timed ? formatSpeedUp(recordedS, d) : null
    return [up, k === undefined ? null : formatKmh(k)].filter(Boolean).join(' · ')
  }
  const upRange = timed ? speedUpRange(recordedS) : undefined
  const kRange = kmhRange(lengthM)
  const shown: Face = lengthM > 0 ? face : 'duration'

  return (
    <div className="field">
      <div className="flex items-center gap-1">
        <span className="type-label">{t('camera.duration.label')}</span>
        <InfoTip text={t('camera.duration.tip')} />
      </div>
      {lengthM > 0 && (
        <ToggleButtonGroup<Face> aria-label={t('camera.speed.by')} value={face} onChange={setFace}>
          <ToggleButton value="duration">{t('camera.speed.byDuration')}</ToggleButton>
          <ToggleButton value="speed">{t('camera.speed.bySpeed')}</ToggleButton>
        </ToggleButtonGroup>
      )}
      {shown === 'duration' ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={STEP_BUTTON}
            aria-label={t('camera.duration.shorten')}
            disabled={durationS <= FLYOVER_DURATION_RANGE.min}
            onClick={() => stepDuration(-1)}
          >
            −
          </Button>
          <Slider
            className="w-auto flex-auto"
            aria-label={t('camera.duration.label')}
            min={FLYOVER_DURATION_RANGE.min}
            max={FLYOVER_DURATION_RANGE.max}
            step={FLYOVER_DURATION_RANGE.step}
            value={durationS}
            onChange={(v) => setFlightTiming({ durationS: v })}
            spoken={formatSeconds}
          />
          <Button
            size="sm"
            className={STEP_BUTTON}
            aria-label={t('camera.duration.lengthen')}
            disabled={durationS >= FLYOVER_DURATION_RANGE.max}
            onClick={() => stepDuration(1)}
          >
            +
          </Button>
        </div>
      ) : (
        <Slider
          className="w-auto flex-auto"
          aria-label={t('camera.speed.sliderAria')}
          min={0}
          max={SPEED_POSITIONS}
          step={1}
          value={speedPosition(durationS)}
          onChange={(position) => set(durationAtSliderPosition(position, durationS))}
          format={() => speedWords(durationS)}
          spoken={() => speedWords(durationS)}
        />
      )}
      <div className="flex items-center gap-1">
        {shown === 'duration' ? (
          <>
            <NumberField
              className="w-[4.5rem]"
              aria-label={t('camera.speed.durationAria')}
              {...FLYOVER_DURATION_RANGE}
              value={durationS}
              onChange={(v) => set(Math.round(v))}
            />
            <span className="type-body">{t('camera.speed.seconds')}</span>
            <span className="type-hint ml-auto">{formatSeconds(durationS)}</span>
          </>
        ) : upRange && upFactor !== undefined ? (
          <>
            <span className="type-body">×</span>
            <NumberField
              className="w-[4.5rem]"
              aria-label={t('camera.speed.upAria')}
              {...upRange}
              value={clamp(Math.round(upFactor), upRange.min, upRange.max)}
              onChange={(v) => set(durationForSpeedUp(recordedS, v))}
            />
            <span className="type-hint ml-auto">{t('camera.speed.asDuration', { duration: formatSeconds(durationS) })}</span>
          </>
        ) : (
          <>
            <NumberField
              className="w-[5.5rem]"
              aria-label={t('camera.speed.kmhAria')}
              {...kRange}
              value={clamp(Number((kmh ?? kRange.min).toFixed(kRange.step < 1 ? 1 : 0)), kRange.min, kRange.max)}
              onChange={(v) => set(durationForKmh(lengthM, v))}
            />
            <span className="type-body">{t('camera.speed.unitKmh')}</span>
            <span className="type-hint ml-auto">{t('camera.speed.asDuration', { duration: formatSeconds(durationS) })}</span>
          </>
        )}
      </div>
      {shown === 'duration' && asSpeed && <p className="type-hint">{asSpeed}</p>}
      {lengthM > 0 && (
        <p className="type-hint">
          {t(shown === 'duration' ? 'camera.speed.hintDuration' : 'camera.speed.hintSpeed')}
          {shown === 'speed' && !upRange && ` ${t('camera.speed.hintUntimed')}`}
          {(stageIds?.length ?? 0) > 1 && ` ${t('camera.speed.hintStages')}`}
        </p>
      )}
      <p className="type-hint">
        {t('camera.duration.film', {
          duration: formatSeconds(Math.round(film.totalTime())),
          stops: stopCount === 0 ? t('camera.duration.noStops') : t('camera.duration.stops', { count: stopCount }),
        })}
        {timedStages > 0 && ` · ${t('camera.duration.timedStages', { count: timedStages })}`}
      </p>
    </div>
  )
}
