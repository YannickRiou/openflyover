/**
 * Patches of the shaders of `@takram/three-clouds` and `@takram/three-atmosphere` 0.7.6, applied to their source text
 * like the other patches of `CloudsLayer` (the libraries have no option for either). A source that does not contain
 * the expected text is returned unchanged (`cloudShaders.test.ts` checks the installed version).
 *
 * - Cover that varies over the scene: `sampleWeather`, shared by the cloud march and the shadow map, takes the
 *   `coverage` of each layer from a small texture (`CloudField`, weather/sceneClouds.ts) read at the cube-sphere UV of the
 *   sample, instead of the single `coverage` uniform. `regionalAmount` 0 gives back the library's behaviour.
 * - Cloud shadows on the terrain: the aerial perspective already reads the cloud shadow map, but only to dim its own
 *   post-process lighting, which the app does not use (the terrain is lit by three's lights). The sun's transmittance
 *   through the clouds now dims the colour of the pixel by the share of the sun in its light.
 */
import { MAX_COVERAGE } from '../weather/sceneClouds'

const LOCAL_WEATHER_OFFSET = 'uniform vec2 localWeatherOffset;'
const FACTOR = 'vec4 factor = 1.0 - coverage * heightScale;'

/** Uniforms added to the materials of the clouds and of their shadow map by `patchRegionalCoverage`. */
export const REGIONAL_UNIFORMS = ['regionalCoverage', 'regionalFrame', 'regionalAmount'] as const

/**
 * Cloud or shadow fragment shader reading the coverage of each layer from `regionalCoverage` (RGBA8, one layer per
 * channel, 255 = MAX_COVERAGE; `regionalFrame` = centre UV, 1 / width) where `regionalAmount` is 1.
 */
export function patchRegionalCoverage(source: string): string {
  if (!source.includes(LOCAL_WEATHER_OFFSET) || !source.includes(FACTOR) || source.includes('regionalCoverage')) return source
  return source
    .replace(
      LOCAL_WEATHER_OFFSET,
      `${LOCAL_WEATHER_OFFSET}\nuniform sampler2D regionalCoverage;\nuniform vec3 regionalFrame;\nuniform float regionalAmount;`,
    )
    .replace(
      FACTOR,
      `vec4 localCoverage = vec4(coverage);
  if (regionalAmount > 0.0) {
    vec2 regionalUv = (uv - regionalFrame.xy) * regionalFrame.z + 0.5;
    localCoverage = mix(localCoverage, textureLod(regionalCoverage, regionalUv, 0.0) * ${MAX_COVERAGE.toFixed(2)}, regionalAmount);
  }
  vec4 factor = 1.0 - localCoverage * heightScale;`,
    )
}

const NORMAL_BUFFER = 'uniform sampler2D normalBuffer;'
const SHADOW_SAMPLE = `  float stbn = getSTBN();
  float radius = getShadowRadius(worldPosition);
  float opticalDepth = sampleShadowOpticalDepth(worldPosition, positionECEF, radius, stbn);`
const UNLIT = `#else // defined(SUN_LIGHT) || defined(SKY_LIGHT)
  radiance = inputColor.rgb;
  #endif // defined(SUN_LIGHT) || defined(SKY_LIGHT)`

/**
 * Aerial perspective fragment shader dimming the terrain under the clouds: with `cloudShadowStrength` > 0 the
 * shadow map is read (not at all at 0) and the colour is multiplied by 1 − strength · sunShare · (1 − transmittance),
 * sunShare being the sun's part of the irradiance on a horizontal surface there (the shader has no normal of the relief).
 */
export function patchCloudShadow(source: string): string {
  if (!source.includes(NORMAL_BUFFER) || !source.includes(SHADOW_SAMPLE) || !source.includes(UNLIT) || source.includes('cloudShadowStrength')) {
    return source
  }
  return source
    .replace(NORMAL_BUFFER, `uniform float cloudShadowStrength;\n${NORMAL_BUFFER}`)
    .replace(
      SHADOW_SAMPLE,
      `  float opticalDepth = 0.0;
  if (cloudShadowStrength > 0.0) {
    float stbn = getSTBN();
    float radius = getShadowRadius(worldPosition);
    opticalDepth = sampleShadowOpticalDepth(worldPosition, positionECEF, radius, stbn);
  }`,
    )
    .replace(
      UNLIT,
      `#else // defined(SUN_LIGHT) || defined(SKY_LIGHT)
  radiance = inputColor.rgb;
  #ifdef HAS_SHADOW
  if (cloudShadowStrength > 0.0 && sunTransmittance < 1.0) {
    vec3 cloudSkyIrradiance;
    vec3 cloudSunIrradiance = GetSunAndSkyIrradiance(positionECEF, normalECEF, sunDirection, cloudSkyIrradiance);
    float cloudSunShare = dot(cloudSunIrradiance, vec3(1.0)) / max(1e-6, dot(cloudSunIrradiance + cloudSkyIrradiance, vec3(1.0)));
    radiance *= mix(1.0, sunTransmittance, cloudShadowStrength * cloudSunShare);
  }
  #endif // HAS_SHADOW
  #endif // defined(SUN_LIGHT) || defined(SKY_LIGHT)`,
    )
}
