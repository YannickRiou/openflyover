/**
 * 3D contour lines on the terrain tiles: the material of a tile, already extended by the snow (`applySnow`), gets a
 * second patch that draws a line wherever the altitude crosses a multiple of the interval, every fifth one stronger.
 * The lines belong to the ground: the sun, the shadows, the exposure and the grading treat them as the imagery, and
 * they follow the relief in the camera's perspective. The altitude is the snow shader's (height of the scene divided
 * by the exaggeration, plus the drop of the curved ground), so the interval is in real metres.
 *
 * Three uniforms shared by every tile (`contourUniforms`, set each frame by scene/ContourLayer.tsx from the settings).
 * A line is about a pixel wide whatever the distance and fades out where lines come closer than ~3 pixels (steep
 * slopes seen from afar): there the picture would be a grey mesh instead of a map. No texture is read.
 */
import { Color, Uniform } from 'three'
import type { MeshStandardMaterial } from 'three'
import { DEFAULT_CONTOURS, type ContourSettings } from './contours'
import { GROUND_DROP_PER_M2 } from './snowShader'

export const contourUniforms = {
  contourInterval: new Uniform(DEFAULT_CONTOURS.intervalM),
  /** 0 draws no line */
  contourOpacity: new Uniform(0),
  contourColor: new Uniform(new Color(DEFAULT_CONTOURS.color)),
}

/** Set the uniforms from the settings (the exaggeration is the snow shader's, set by SnowLayer). */
export function setContourUniforms(settings: ContourSettings): void {
  contourUniforms.contourInterval.value = settings.intervalM
  contourUniforms.contourOpacity.value = settings.enabled ? settings.opacity : 0
  contourUniforms.contourColor.value.set(settings.color)
}

const fragmentHead = /* glsl */ `
uniform float contourInterval;
uniform float contourOpacity;
uniform vec3 contourColor;
`
const fragmentContours = /* glsl */ `
if (contourOpacity > 0.0) {
  float contourU = (vSnowPos.y + dot(vSnowPos.xz, vSnowPos.xz) * ${GROUND_DROP_PER_M2}) / snowExaggeration / contourInterval;
  float contourPx = fwidth(contourU);
  // pixels to the nearest line
  float contourD = abs(fract(contourU - 0.5) - 0.5) / max(contourPx, 1e-5);
  // every fifth line is an index line: wider and stronger
  float contourIndex = mod(floor(contourU + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
  float contourHalf = 0.5 * mix(1.0, 2.0, contourIndex);
  float contourLine = (1.0 - smoothstep(contourHalf - 0.5, contourHalf + 0.5, contourD)) * mix(0.55, 1.0, contourIndex);
  contourLine *= 1.0 - smoothstep(0.2, 0.4, contourPx);
  // flat ground (a lake, a valley floor) exactly at a multiple would turn into a patch, not a line
  contourLine *= smoothstep(0.0003, 0.002, contourPx);
  diffuseColor.rgb = mix(diffuseColor.rgb, contourColor, contourLine * contourOpacity);
}
`

/** Extend the material of a tile after `applySnow` (it uses the snow's world position and exaggeration); every tile shares one program. */
export function applyContours(material: MeshStandardMaterial): void {
  const snow = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    snow(shader, renderer)
    const chunk = '#include <color_fragment>'
    if (!shader.fragmentShader.includes(chunk)) throw new Error(`contour shader: ${chunk} not found`)
    Object.assign(shader.uniforms, contourUniforms)
    shader.fragmentShader = fragmentHead + shader.fragmentShader.replace(chunk, `${chunk}\n${fragmentContours}`)
  }
  material.customProgramCacheKey = () => 'openflyover-terrain-snow-contours'
}
