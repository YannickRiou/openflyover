/**
 * Material of the glaciers (scene/GlacierLayer.tsx): a MeshStandardMaterial extended in `onBeforeCompile` with the albedo and
 * the hash noise of the snow (terrain/snowShader.ts), crevasses (thin dark lines of that noise, stretched along the glacier's
 * flow, only on a slope), steep faces letting the rock and the photo show, and an opacity that fades toward the edge. No
 * texture, no time: the export draws what the preview shows.
 */
import { MeshStandardMaterial } from 'three'
import { SNOW_ALBEDO_GLSL, SNOW_NOISE_GLSL } from '../terrain/snowShader'

/** Opacity of the ice on flat ground: the crevasses and the colours of the photo stay faintly visible. */
const GLACIER_OPACITY = 0.9
/** Share of the opacity kept on the steepest faces (seracs): some rock shows. */
const STEEP_OPACITY = 0.35

const vertexHead = /* glsl */ `
attribute float glacierFade;
attribute vec2 glacierFlow;
varying float vGlacierFade;
varying float vGlacierUp;
varying vec2 vGlacierXZ;
varying vec2 vGlacierUV;
`
const vertexNormal = /* glsl */ `
// cosine of the slope: 1 on flat ground, 0 on a vertical face
vGlacierUp = normalize(mat3(modelMatrix) * objectNormal).y;
`
const vertexPosition = /* glsl */ `
{
  vGlacierFade = glacierFade;
  vGlacierXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
  // along and across the flow of the glacier: linear in the position, so interpolating them is exact
  vec2 flow = normalize(mat3(modelMatrix) * vec3(glacierFlow.x, 0.0, glacierFlow.y)).xz;
  vGlacierUV = vec2(dot(vGlacierXZ, vec2(-flow.y, flow.x)), dot(vGlacierXZ, flow));
}
`
const fragmentHead = /* glsl */ `
varying float vGlacierFade;
varying float vGlacierUp;
varying vec2 vGlacierXZ;
varying vec2 vGlacierUV;
${SNOW_NOISE_GLSL}
// thin dark line where a value noise of cells (across, along × 8) crosses its mean: stretched along the flow, and gone
// where its cells would be under ~2 pixels (no shimmer)
float glacierCrack(vec2 uv, float size) {
  vec2 p = vec2(uv.x, uv.y * 0.125);
  float visible = clamp(size / (2.0 * length(fwidth(p))) - 0.5, 0.0, 1.0);
  return (1.0 - smoothstep(0.0, 0.07, abs(snowNoise(p, size) - 0.5))) * visible;
}
`
const fragmentGlacier = /* glsl */ `
float glacierSlope = smoothstep(0.45, 0.8, vGlacierUp);
float glacierOpacity = ${GLACIER_OPACITY.toFixed(2)} * mix(${STEEP_OPACITY.toFixed(2)}, 1.0, glacierSlope) * smoothstep(0.0, 1.0, vGlacierFade);
// crevasses: in patches, on the slopes, not on the flat of a névé
float glacierPatch = smoothstep(0.4, 0.65, snowNoise(vGlacierXZ, 140.0));
float glacierCracks = max(glacierCrack(vGlacierUV, 5.0), 0.8 * glacierCrack(vGlacierUV + 40.0, 13.0));
glacierCracks *= glacierPatch * smoothstep(0.995, 0.93, vGlacierUp) * glacierSlope;
// the albedo of the snow, the grain of the photo's relief not kept: the ice is one white
diffuseColor.rgb = ${SNOW_ALBEDO_GLSL} * (1.0 - 0.32 * glacierCracks);
diffuseColor.a *= glacierOpacity;
`
// what the sky lights (the shade) is a little bluer than what the sun lights
const fragmentShade = /* glsl */ `
reflectedLight.indirectDiffuse *= vec3(0.9, 0.97, 1.1);
`

/** Replace `chunk` by itself followed by `code`; throws when three's shader no longer has it. */
function after(source: string, chunk: string, code: string): string {
  if (!source.includes(chunk)) throw new Error(`glacier shader: ${chunk} not found`)
  return source.replace(chunk, `${chunk}\n${code}`)
}

/** One material for every glacier (its own program, cached under its own key). */
export function createGlacierMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // a little nearer than the relief it lies on: the coarse levels of detail of the relief do not reach through
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = vertexHead + after(after(shader.vertexShader, '#include <beginnormal_vertex>', vertexNormal), '#include <begin_vertex>', vertexPosition)
    shader.fragmentShader = fragmentHead + after(after(shader.fragmentShader, '#include <map_fragment>', fragmentGlacier), '#include <lights_fragment_end>', fragmentShade)
  }
  material.customProgramCacheKey = () => 'openflyover-glacier'
  return material
}
