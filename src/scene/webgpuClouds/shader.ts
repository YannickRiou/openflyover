/**
 * The march of the clouds in WGSL, one invocation per texel (step 1 of the WebGPU clouds, `layout.ts`). A port of the
 * clouds library's GLSL (`@takram/three-clouds`, shaders/clouds.frag and clouds.glsl: `marchClouds`, `sampleWeather`,
 * `sampleMedia`, `marchOpticalDepth`, the multiple scattering and the phase function), so that the same work is timed.
 *
 * Not ported yet (later steps): the cloud shadow map (BSM) and the ground bounce, the haze, the light shafts, the depth of
 * the scene (the clouds behind the relief are marched too), the mip levels of the textures (level 0 only), the
 * accurate sun and sky light (two irradiances interpolated over the height, as the library's « low » and « medium »).
 * The output is the library's: premultiplied radiance and opacity, before the aerial perspective.
 */
import { WORKGROUP_SIZE, paramsStruct } from './layout'

/** Bindings of the group 0, in the order of `CLOUD_SHADER`. */
export const BINDINGS = {
  params: 0,
  sampler: 1,
  localWeather: 2,
  shape: 3,
  shapeDetail: 4,
  turbulence: 5,
  output: 6,
} as const

export const OUTPUT_FORMAT = 'rgba16float'

export const CLOUD_SHADER = /* wgsl */ `
${paramsStruct()}

@group(0) @binding(${BINDINGS.params}) var<uniform> P: Params;
@group(0) @binding(${BINDINGS.sampler}) var linearRepeat: sampler;
@group(0) @binding(${BINDINGS.localWeather}) var localWeatherTexture: texture_2d<f32>;
@group(0) @binding(${BINDINGS.shape}) var shapeTexture: texture_3d<f32>;
@group(0) @binding(${BINDINGS.shapeDetail}) var shapeDetailTexture: texture_3d<f32>;
@group(0) @binding(${BINDINGS.turbulence}) var turbulenceTexture: texture_2d<f32>;
@group(0) @binding(${BINDINGS.output}) var output: texture_storage_2d<${OUTPUT_FORMAT}, write>;

const RECIPROCAL_PI4 = 0.07957747154594767;
const SCATTER_ANISOTROPY = vec2f(0.7, -0.2);
const SCATTER_ANISOTROPY_MIX = 0.5;

fn remapClamped(x: vec4f, a: vec4f, b: vec4f) -> vec4f {
  return clamp((x - a) / (b - a), vec4f(0.0), vec4f(1.0));
}

// Cube-sphere relaxation (the library's getCubeSphereUv)
fn globeUv(position: vec3f) -> vec2f {
  let n = normalize(position);
  let f = abs(n);
  let c = n / max(f.x, max(f.y, f.z));
  var m: vec2f;
  if (f.y > f.x && f.y > f.z) {
    m = select(n.xz, vec2f(-n.x, n.z), c.y > 0.0);
  } else if (f.x > f.y && f.x > f.z) {
    m = select(vec2f(-n.y, n.z), n.yz, c.x > 0.0);
  } else {
    m = select(vec2f(n.x, -n.y), n.xy, c.z > 0.0);
  }
  let m2 = m * m;
  let q = dot(m2, vec2f(-2.0, 2.0)) - 3.0;
  let q2 = q * q;
  var uv: vec2f;
  uv.x = sqrt(1.5 + m2.x - m2.y - 0.5 * sqrt(-24.0 * m2.x + q2)) * select(-1.0, 1.0, m.x > 0.0);
  uv.y = sqrt(6.0 / (3.0 - uv.x * uv.x)) * m.y;
  return uv * 0.5 + 0.5;
}

fn insideLayerIntervals(h: f32) -> bool {
  let gt = vec3f(h) > P.minIntervalHeights.xyz;
  let lt = vec3f(h) < P.maxIntervalHeights.xyz;
  return any(gt & lt);
}

struct Weather {
  heightFraction: vec4f,
  density: vec4f,
}

fn shapeAltering(heightFraction: vec4f, bias: vec4f) -> vec4f {
  let biased = pow(heightFraction, bias);
  let x = clamp(biased * 2.0 - 1.0, vec4f(-1.0), vec4f(1.0));
  return 1.0 - x * x;
}

fn sampleWeather(uv: vec2f, h: f32, mip: f32) -> Weather {
  var w: Weather;
  w.heightFraction = remapClamped(vec4f(h), P.minLayerHeights, P.maxLayerHeights);
  let local = pow(
    textureSampleLevel(localWeatherTexture, linearRepeat, uv * P.localWeather.xy + P.localWeather.zw, mip),
    P.weatherExponents
  );
  let factor = 1.0 - P.limits.w * shapeAltering(w.heightFraction, P.shapeAlteringBiases);
  w.density = remapClamped(mix(local, vec4f(1.0), P.coverageFilterWidths), factor, factor + P.coverageFilterWidths);
  return w;
}

fn layerDensity(heightFraction: vec4f) -> vec4f {
  return P.densityExpTerms * exp(P.densityExponents * heightFraction) +
    P.densityLinearTerms * heightFraction +
    P.densityConstantTerms;
}

struct Media {
  weight: vec4f,
  scattering: f32,
  extinction: f32,
}

fn sampleMedia(w: Weather, position: vec3f, uv: vec2f, mip: f32, jitter: f32) -> Media {
  var density = w.density;
  let evolution = -normalize(position) * length(P.localWeather.zw) * 2e4;
  var turbulence = vec3f(0.0);
  if (P.switches.z > 0.5) {
    let turbulenceUv = uv * P.localWeather.xy * P.turbulenceRepeat.xy;
    turbulence = P.secondary.w *
      (textureSampleLevel(turbulenceTexture, linearRepeat, turbulenceUv, 0.0).rgb * 2.0 - 1.0) *
      dot(density, remapClamped(w.heightFraction, vec4f(0.3), vec4f(0.0)));
  }
  let shapePosition = (position + evolution + turbulence) * P.shapeRepeat.xyz + P.shapeOffset.xyz;
  let shape = textureSampleLevel(shapeTexture, linearRepeat, shapePosition, 0.0).r;
  density = remapClamped(density, vec4f(1.0 - shape) * P.shapeAmounts, vec4f(1.0));
  if (P.switches.y > 0.5 && mip * 0.5 + (jitter - 0.5) * 0.5 < 0.5) {
    let detailPosition = (position + turbulence) * P.shapeDetailRepeat.xyz + P.shapeDetailOffset.xyz;
    let detail = textureSampleLevel(shapeDetailTexture, linearRepeat, detailPosition, 0.0).r;
    // fluffy at the top and whippy at the bottom
    var modifier = mix(vec4f(pow(detail, 6.0)), vec4f(1.0 - detail), remapClamped(w.heightFraction, vec4f(0.2), vec4f(0.4)));
    modifier = mix(vec4f(0.0), modifier, P.shapeDetailAmounts);
    density = remapClamped(density * 2.0, modifier * 0.5, vec4f(1.0));
  }
  density = saturate(density * P.densityScales * layerDensity(w.heightFraction));
  var media: Media;
  let sum = density.x + density.y + density.z + density.w;
  media.weight = density / sum;
  media.scattering = sum * P.medium.x;
  media.extinction = sum * P.medium.y + media.scattering;
  return media;
}

fn marchOpticalDepth(origin: vec3f, direction: vec3f, maxIterationCount: i32, mip: f32, jitter: f32) -> f32 {
  let count = i32(max(0.0, mix(f32(maxIterationCount + 1), 1.0, mip) - jitter));
  if (count == 0) {
    // the library's fudge factor for the mean optical depth
    return 0.5;
  }
  var stepSize = P.secondary.y / f32(count);
  var distance = stepSize * jitter;
  var opticalDepth = 0.0;
  for (var i = 0; i < count; i++) {
    let position = distance * direction + origin;
    let uv = globeUv(position);
    let w = sampleWeather(uv, length(position) - P.radii.x, mip);
    opticalDepth += sampleMedia(w, position, uv, mip, jitter).extinction * stepSize;
    distance += stepSize;
    stepSize *= P.secondary.z;
  }
  return opticalDepth;
}

fn henyeyGreenstein(g: vec2f, cosTheta: f32) -> vec2f {
  let g2 = g * g;
  return RECIPROCAL_PI4 * ((1.0 - g2) / max(vec2f(1e-7), pow(1.0 + g2 - 2.0 * g * cosTheta, vec2f(1.5))));
}

fn phaseFunction(cosTheta: f32, attenuation: f32) -> f32 {
  let weights = vec2f(1.0 - SCATTER_ANISOTROPY_MIX, SCATTER_ANISOTROPY_MIX);
  return dot(henyeyGreenstein(SCATTER_ANISOTROPY * attenuation, cosTheta), weights);
}

fn multipleScattering(opticalDepth: f32, cosTheta: f32) -> f32 {
  var coeffs = vec3f(1.0); // attenuation, contribution, phase attenuation
  var scattering = 0.0;
  let octaves = i32(P.frame.w);
  for (var i = 0; i < octaves; i++) {
    scattering += coeffs.x * exp(-opticalDepth * coeffs.y) * phaseFunction(cosTheta, coeffs.z);
    coeffs *= 0.5;
  }
  return scattering;
}

fn marchClouds(origin: vec3f, direction: vec3f, nearFar: vec2f, cosTheta: f32, jitter: f32) -> vec4f {
  var radianceIntegral = vec3f(0.0);
  var transmittanceIntegral = 1.0;
  let maxRayDistance = nearFar.y - nearFar.x;
  var stepSize = P.march.y + (P.march.w - 1.0) * nearFar.x;
  var distance = stepSize * jitter * 2.0;
  let maxIterationCount = i32(P.march.x);
  for (var i = 0; i < maxIterationCount; i++) {
    if (distance > maxRayDistance) {
      break;
    }
    let position = distance * direction + origin;
    let h = length(position) - P.radii.x;
    let mip = log2(max(1.0, 1.0 + distance * 1e-5));
    if (insideLayerIntervals(h)) {
      stepSize *= P.march.w;
      distance += mix(stepSize, P.march.z, min(1.0, mip));
      continue;
    }
    let uv = globeUv(position);
    let w = sampleWeather(uv, h, mip);
    if (!any(w.density > vec4f(P.limits.x))) {
      // a longer step in empty space
      stepSize *= P.march.w;
      distance += mix(stepSize, P.march.z, min(1.0, mip));
      continue;
    }
    let media = sampleMedia(w, position, uv, mip, jitter);
    if (media.extinction > P.limits.y) {
      let alpha = clamp((h - P.radii.y) / (P.radii.z - P.radii.y), 0.0, 1.0);
      let sun = mix(P.sunIrradianceMin.xyz, P.sunIrradianceMax.xyz, alpha);
      let sky = mix(P.skyIrradianceMin.xyz, P.skyIrradianceMax.xyz, alpha);
      let opticalDepth = marchOpticalDepth(position, P.sun.xyz, i32(P.secondary.x), mip, jitter);
      var radiance = sun * multipleScattering(opticalDepth, cosTheta);
      // crude sky gradient, better than none in the shadows
      radiance += sky * RECIPROCAL_PI4 * dot(w.heightFraction * 0.5 + 0.5, media.weight) * P.medium.z;
      radiance *= media.scattering;
      radiance *= 1.0 - P.medium.w * exp(-media.extinction * P.switches.x);
      // energy-conserving integration of the scattered light (Frostbite 2016, 5.6.3)
      let transmittance = exp(-media.extinction * stepSize);
      radianceIntegral += transmittanceIntegral * (radiance - radiance * transmittance) / max(media.extinction, 1e-7);
      transmittanceIntegral *= transmittance;
    }
    if (transmittanceIntegral <= P.limits.z) {
      break;
    }
    stepSize *= P.march.w;
    distance += stepSize;
  }
  return vec4f(radianceIntegral, clamp((transmittanceIntegral - 1.0) / (P.limits.z - 1.0), 0.0, 1.0));
}

// Where the ray is inside the clouds (the library's getRayNearFar); negative: no clouds on this ray.
fn rayNearFar(camera: vec3f, direction: vec3f) -> vec2f {
  let bottom = P.radii.x;
  let radii = bottom + vec4f(0.0, P.radii.y, P.radii.z, 0.0);
  let b = 2.0 * dot(direction, camera);
  let discriminant = b * b - 4.0 * (dot(camera, camera) - radii * radii);
  let miss = discriminant <= vec4f(0.0);
  let q = sqrt(max(vec4f(0.0), discriminant));
  let first = select((-b - q) * 0.5, vec4f(-1.0), miss);
  let second = select((-b + q) * 0.5, vec4f(-1.0), miss);
  let r = length(camera);
  let mu = dot(camera, direction) / r;
  let ground = mu < 0.0 && r * r * (mu * mu - 1.0) + bottom * bottom >= 0.0;
  let cameraHeight = P.camera.w;
  if (cameraHeight < P.radii.y) {
    if (ground) {
      return vec2f(-1.0);
    }
    return vec2f(second.y, min(second.z, P.radii.w));
  }
  if (cameraHeight < P.radii.z) {
    return select(vec2f(P.sun.w, second.z), vec2f(P.sun.w, first.y), ground);
  }
  return select(vec2f(first.z, second.z), vec2f(first.z, first.y), ground);
}

// Interleaved gradient noise, shifted per noise slice (the library reads a spatiotemporal blue noise texture)
fn jitterAt(texel: vec2u, frame: f32) -> f32 {
  let p = vec2f(texel) + 5.588238 * frame;
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(u32(P.frame.x), u32(P.frame.y));
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let screen = (vec2f(id.xy) + 0.5) / vec2f(size);
  let ndc = vec2f(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0);
  let viewPosition = (P.inverseProjection * vec4f(ndc, 1.0, 1.0)).xyz;
  let direction = normalize((P.viewToEcef * vec4f(viewPosition, 0.0)).xyz);
  let camera = P.camera.xyz;
  let nearFar = rayNearFar(camera, direction);
  var color = vec4f(0.0);
  if (nearFar.x >= 0.0 && nearFar.y > nearFar.x) {
    color = marchClouds(nearFar.x * direction + camera, direction, nearFar, dot(P.sun.xyz, direction), jitterAt(id.xy, P.frame.z));
  }
  textureStore(output, vec2i(id.xy), color);
}
`
