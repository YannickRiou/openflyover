/**
 * SnowLayer — sets the snow line of the terrain tiles (terrain/snowShader.ts) every frame, inside TerrainLayer. It draws
 * nothing itself. A pure function of the settings, the weather and the film progress (the track under the marker, so
 * each stage of « À la suite » follows its own weather): the export draws what the preview shows.
 */
import { useFrame } from '@react-three/fiber'
import { trackPathOf } from '../flyover/path'
import { trackUnderMarker } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { NO_SNOW_LINE_M, snowUniforms } from '../terrain/snowShader'
import { resolveSnow, snowLineAtProgress } from '../weather/snowLine'
import { useWeatherStore, weatherSeriesOf } from '../weather/store'

export function SnowLayer() {
  useFrame(() => {
    const { playback, settings, tracks } = useAppStore.getState()
    const line = resolveSnow(settings.snow, () => {
      const under = trackUnderMarker(tracks, settings.race, playback.progress)
      const series = under && weatherSeriesOf(useWeatherStore.getState(), under.track)
      return under && series ? snowLineAtProgress(series, trackPathOf(under.track), under.progress) : null
    })
    snowUniforms.snowLine.value = line?.snowLineM ?? NO_SNOW_LINE_M
    snowUniforms.snowBand.value = line?.bandM ?? snowUniforms.snowBand.value
    snowUniforms.snowExaggeration.value = settings.exaggeration
  })
  return null
}
