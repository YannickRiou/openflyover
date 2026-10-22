/**
 * Snow on the terrain tiles: the material of a tile (MeshStandardMaterial) extended in `onBeforeCompile` to blend a
 * snow albedo over the imagery above the snow line, so the sun, the shadows, the exposure and the grading treat it as
 * any other ground. See ARCHITECTURE.md "Snow".
 *
 * The line comes from three uniforms shared by every tile (`snowUniforms`, set each frame by scene/SnowLayer.tsx from
 * the settings and the weather): a pure function of the film progress, so the export draws what the preview shows.
 * No texture is read: the ragged limit is a hash noise of the world position, faded out where its cells get smaller
 * than a pixel.
 */
import { Uniform } from 'three'
import type { MeshStandardMaterial } from 'three'

/** `snowLine` value that draws no snow (above every summit). */
export const NO_SNOW_LINE_M = 1e6
/** Earth radius (metres): the local frame is flat at its origin, the ground curves away below it. */
const EARTH_RADIUS_M = 6_371_000
/** Drop of the ground below the local frame per squared metre of distance to its origin (GLSL float literal); shared with the frozen lakes of the water layer. */
export const GROUND_DROP_PER_M2 = (0.5 / EARTH_RADIUS_M).toExponential(6)

export const snowUniforms = {
  /** altitude above sea level of the middle of the transition (metres, not exaggerated) */
  snowLine: new Uniform(NO_SNOW_LINE_M),
  /** width of the transition (metres) */
  snowBand: new Uniform(200),
  /** vertical exaggeration of the relief: the scene's height is the altitude times this */
  snowExaggeration: new Uniform(1),
}

const vertexHead = /* glsl */ `
varying vec3 vSnowPos;
varying float vSnowUp;
`
const vertexNormal = /* glsl */ `
// cosine of the slope: 1 on flat ground, 0 on a vertical face
vSnowUp = normalize(mat3(modelMatrix) * objectNormal).y;
`
const vertexPosition = /* glsl */ `
vSnowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

/** GLSL value noise (`snowNoise`) the ragged limit of the snow is made of; shared with the frozen lakes of the water layer. */
export const SNOW_NOISE_GLSL = /* glsl */ `
float snowHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
// value noise of cells of size metres, faded to its mean where a cell is under ~2 pixels
float snowNoise(vec2 p, float size) {
  vec2 q = p / size;
  vec2 i = floor(q);
  vec2 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), f.x), mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), f.x), f.y);
  return mix(0.5, n, clamp(size / (2.0 * length(fwidth(p))) - 0.5, 0.0, 1.0));
}
`
/** GLSL expression of the tearing of the limit at the world position `xz` (a vec2), about -0.5 to 0.5. */
export const snowRagGlsl = (xz: string) => `(0.55 * snowNoise(${xz}, 70.0) + 0.3 * snowNoise(${xz}, 25.0) + 0.15 * snowNoise(${xz}, 9.0) - 0.5)`

const fragmentHead = /* glsl */ `
uniform float snowLine;
uniform float snowBand;
uniform float snowExaggeration;
varying vec3 vSnowPos;
varying float vSnowUp;

`
const fragmentSnow = /* glsl */ `
if (snowLine < ${NO_SNOW_LINE_M.toFixed(1)} * 0.5) {
  // altitude above sea level: the height of the scene, plus the drop of the ground away from the origin
  float snowAlt = (vSnowPos.y + dot(vSnowPos.xz, vSnowPos.xz) * ${GROUND_DROP_PER_M2}) / snowExaggeration;
  float snowRag = ${snowRagGlsl('vSnowPos.xz')};
  // 0 under the transition, 1 above it, its limit torn by the noise
  float snowCover = smoothstep(-0.5 * snowBand, 0.5 * snowBand, snowAlt - snowLine + snowRag * snowBand * 0.9);
  // steep faces keep the rock: nothing beyond ~50 degrees, all of it under ~32
  snowCover *= smoothstep(0.62, 0.85, vSnowUp + snowRag * 0.08);
  // white, a little blue (linear), the relief of the photo kept faintly
  float snowLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 snowAlbedo = vec3(0.80, 0.83, 0.88) * (0.9 + 0.2 * clamp(snowLuma * 2.0, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, snowCover * 0.94);
}
`

/** Replace `chunk` by itself followed by `code`; throws when three's shader no longer has it. */
function after(source: string, chunk: string, code: string): string {
  if (!source.includes(chunk)) throw new Error(`snow shader: ${chunk} not found`)
  return source.replace(chunk, `${chunk}\n${code}`)
}

/** Extend the material of a terrain tile with the snow; every tile shares one program. */
export function applySnow(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, snowUniforms)
    shader.vertexShader = vertexHead + after(after(shader.vertexShader, '#include <beginnormal_vertex>', vertexNormal), '#include <begin_vertex>', vertexPosition)
    shader.fragmentShader = SNOW_NOISE_GLSL + fragmentHead + after(shader.fragmentShader, '#include <map_fragment>', fragmentSnow)
  }
  material.customProgramCacheKey = () => 'openflyover-terrain-snow'
}
