/** ContourLayer — sets the contour lines of the terrain tiles (terrain/contourShader.ts) every frame, inside TerrainLayer. It draws nothing itself. */
import { useFrame } from '@react-three/fiber'
import { useAppStore } from '../state/store'
import { setContourUniforms } from '../terrain/contourShader'

export function ContourLayer() {
  useFrame(() => setContourUniforms(useAppStore.getState().settings.contours))
  return null
}
