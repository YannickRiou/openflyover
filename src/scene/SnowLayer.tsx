/**
 * SnowLayer — sets the snow line of the terrain tiles (terrain/snowShader.ts) every frame, inside TerrainLayer. It draws
 * nothing itself. A pure function of the settings, the weather and the film progress (the track under the marker, so
 * each stage of « À la suite » follows its own weather): the export draws what the preview shows. A stage whose weather is
 * not there (loading, failed) keeps the line of the stage before while some weather is loaded.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { trackPathOf } from '../flyover/path'
import { trackUnderMarker } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { NO_SNOW_LINE_M, snowUniforms } from '../terrain/snowShader'
import { resolveSnow, snowLineAtProgress, type SnowLine } from '../weather/snowLine'
import { useWeatherStore, weatherSeriesOf, weatherShown } from '../weather/store'

export function SnowLayer() {
  const last = useRef<SnowLine | null>(null)
  useFrame(() => {
    const { playback, settings, tracks } = useAppStore.getState()
    const line = resolveSnow(settings.snow, () => {
      const under = trackUnderMarker(tracks, settings.race, playback.progress)
      const weather = useWeatherStore.getState()
      const series = under && weatherSeriesOf(weather, under.track)
      if (!under || !series) return weatherShown(weather) ? last.current : null
      return (last.current = snowLineAtProgress(series, trackPathOf(under.track), under.progress).line)
    })
    snowUniforms.snowLine.value = line?.snowLineM ?? NO_SNOW_LINE_M
    snowUniforms.snowBand.value = line?.bandM ?? snowUniforms.snowBand.value
    snowUniforms.snowExaggeration.value = settings.exaggeration
  })
  return null
}
