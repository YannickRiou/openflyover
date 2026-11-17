/**
 * The clouds in WGSL (ROADMAP « 9 », `layout.ts` for the parameters): a port of the clouds library's GLSL
 * (`@takram/three-clouds` 0.7.6, shaders/clouds.frag, clouds.glsl, shadow.frag, structuredSampling.glsl, and
 * three-geospatial's cascadedShadowMaps, vogelDisk, interleavedGradientNoise), with the app's own patches
 * (`cloudShaders.ts`: the cover that varies over the scene; `CloudsLayer`: the night fill of the sky light).
 *
 * Three compute shaders, one invocation per texel:
 * - `SHADOW_SHADER`: the cloud shadow map (Beer shadow map, BSM), one layer per cascade, marched from the sun with
 *   structured volume sampling, as `shadow.frag`;
 * - `CLOUDS_SHADER`: the march of the clouds for one noise slice, as `marchClouds` of `clouds.frag` (the shadow map, the
 *   ground bounce, the powder), up to the relief (`sceneDistance`, measured by WebGL);
 * - `RESOLVE_SHADER`: the slice into the frame, as the library's resolve mixes the slices of an exported frame;
 * - `FINISH_SHADER`: the frame, in the layout the WebGL side uploads (half floats for the colour, the front depth).
 *
 * The rest of the library's pass stays in WebGL (`webglSide.ts`): the ray limits, the aerial perspective on the clouds,
 * the resolve, the composition and the cloud shadows on the terrain read what these shaders give.
 *
 * Texels follow the WebGL convention: row 0 is the bottom of the image, as `readPixels` and `texImage2D` order them.
 * Not ported (the WebGL clouds are kept when they are on, `support.ts`): the accurate sun and sky light, the light shafts
 * (shadow length), the haze, the accurate phase function, the turbulence.
 */
import { MAX_COVERAGE } from '../../weather/sceneClouds'
import { WORKGROUP_SIZE, paramsStruct } from './layout'

/** Bindings shared by the shadow map and the clouds, then each one's own. */
export const BINDINGS = {
  params: 0,
  linearRepeat: 1,
  localWeather: 2,
  shape: 3,
  shapeDetail: 4,
  turbulence: 5,
  stbn: 6,
  regionalCoverage: 7,
  linearClamp: 8,
  // shadow map
  shadowOut: 9,
  // clouds
  shadowMap: 9,
  sceneDistance: 10,
  current: 11,
  depthSum: 12,
} as const

export const RESOLVE_BINDINGS = { params: 0, current: 1, resolved: 2 } as const
export const FINISH_BINDINGS = { params: 0, resolved: 1, depthSum: 2, color: 3, depth: 4 } as const

/** Format of the shadow map: the library's (half floats). */
export const SHADOW_FORMAT = 'rgba16float'

const COMMON = /* wgsl */ `
${paramsStruct()}

@group(0) @binding(${BINDINGS.params}) var<uniform> P: Params;
@group(0) @binding(${BINDINGS.linearRepeat}) var linearRepeat: sampler;
@group(0) @binding(${BINDINGS.localWeather}) var localWeatherTexture: texture_2d<f32>;
@group(0) @binding(${BINDINGS.shape}) var shapeTexture: texture_3d<f32>;
@group(0) @binding(${BINDINGS.shapeDetail}) var shapeDetailTexture: texture_3d<f32>;
@group(0) @binding(${BINDINGS.turbulence}) var turbulenceTexture: texture_2d<f32>;
@group(0) @binding(${BINDINGS.stbn}) var stbnTexture: texture_3d<f32>;
@group(0) @binding(${BINDINGS.regionalCoverage}) var regionalCoverage: texture_2d<f32>;
@group(0) @binding(${BINDINGS.linearClamp}) var linearClamp: sampler;

const PI = 3.141592653589793;
const PI2 = 6.283185307179586;
const RECIPROCAL_PI = 0.3183098861837907;
const RECIPROCAL_PI4 = 0.07957747154594767;

fn remapClamped4(x: vec4f, a: vec4f, b: vec4f) -> vec4f {
  return clamp((x - a) / (b - a), vec4f(0.0), vec4f(1.0));
}

fn remapClamped(x: f32, a: f32, b: f32) -> f32 {
  return clamp((x - a) / (b - a), 0.0, 1.0);
}

// GLSL's mod: the sign of y
fn glslMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// The spatiotemporal noise of the library (getSTBN): nearest texel, repeated, one slice per frame
fn getSTBN(fragCoord: vec2f) -> f32 {
  let size = vec3i(textureDimensions(stbnTexture));
  let texel = vec2i(floor(fragCoord)) % size.xy;
  let slice = i32(P.frame.z) % size.z;
  return textureLoad(stbnTexture, vec3i(texel, slice), 0).r;
}

// Cube-sphere relaxation (getCubeSphereUv)
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

// sampleWeather, with the cover that varies over the scene (patchRegionalCoverage); mask: the shadow map's layer mask
fn sampleWeather(uv: vec2f, h: f32, mip: f32, mask: vec4f) -> Weather {
  var w: Weather;
  w.heightFraction = remapClamped4(vec4f(h), P.minLayerHeights, P.maxLayerHeights);
  let local = pow(
    textureSampleLevel(localWeatherTexture, linearRepeat, uv * P.localWeather.xy + P.localWeather.zw, mip),
    P.weatherExponents
  ) * mask;
  let heightScale = shapeAltering(w.heightFraction, P.shapeAlteringBiases);
  var localCoverage = vec4f(P.limits.w);
  if (P.regional.w > 0.0) {
    let regionalUv = (uv - P.regional.xy) * P.regional.z + 0.5;
    localCoverage = mix(localCoverage, textureSampleLevel(regionalCoverage, linearClamp, regionalUv, 0.0) * ${MAX_COVERAGE.toFixed(2)}, P.regional.w);
  }
  let factor = 1.0 - localCoverage * heightScale;
  w.density = remapClamped4(mix(local, vec4f(1.0), P.coverageFilterWidths), factor, factor + P.coverageFilterWidths);
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
      dot(density, remapClamped4(w.heightFraction, vec4f(0.3), vec4f(0.0)));
  }
  let shapePosition = (position + evolution + turbulence) * P.shapeRepeat.xyz + P.shapeOffset.xyz;
  let shape = textureSampleLevel(shapeTexture, linearRepeat, shapePosition, 0.0).r;
  density = remapClamped4(density, vec4f(1.0 - shape) * P.shapeAmounts, vec4f(1.0));
  if (P.switches.y > 0.5 && mip * 0.5 + (jitter - 0.5) * 0.5 < 0.5) {
    let detailPosition = (position + turbulence) * P.shapeDetailRepeat.xyz + P.shapeDetailOffset.xyz;
    let detail = textureSampleLevel(shapeDetailTexture, linearRepeat, detailPosition, 0.0).r;
    // fluffy at the top and whippy at the bottom
    var modifier = mix(vec4f(pow(detail, 6.0)), vec4f(1.0 - detail), remapClamped4(w.heightFraction, vec4f(0.2), vec4f(0.4)));
    modifier = mix(vec4f(0.0), modifier, P.shapeDetailAmounts);
    density = remapClamped4(density * 2.0, modifier * 0.5, vec4f(1.0));
  }
  density = saturate(density * P.densityScales * layerDensity(w.heightFraction));
  var media: Media;
  let sum = density.x + density.y + density.z + density.w;
  media.weight = density / sum;
  media.scattering = sum * P.medium.x;
  media.extinction = sum * P.medium.y + media.scattering;
  return media;
}

fn raySphereFirst4(origin: vec3f, direction: vec3f, radius: vec4f) -> vec4f {
  let b = 2.0 * dot(direction, origin);
  let c = dot(origin, origin) - radius * radius;
  let discriminant = b * b - 4.0 * c;
  return select((-b - sqrt(max(vec4f(0.0), discriminant))) * 0.5, vec4f(-1.0), discriminant <= vec4f(0.0));
}

fn raySphereSecond(origin: vec3f, direction: vec3f, radius: f32) -> f32 {
  let b = 2.0 * dot(direction, origin);
  let c = dot(origin, origin) - radius * radius;
  let discriminant = b * b - 4.0 * c;
  if (discriminant < 0.0) {
    return -1.0;
  }
  return (-b + sqrt(discriminant)) * 0.5;
}
`

const SHADOW_MAIN = /* wgsl */ `
@group(0) @binding(${BINDINGS.shadowOut}) var shadowOut: texture_storage_2d_array<${SHADOW_FORMAT}, write>;

// Structured volume sampling (structuredSampling.glsl)
fn structureNormal(direction: vec3f, jitter: f32) -> vec3f {
  let a = 0.85065080835204;
  let b = 0.5257311121191336;
  let kT = 0.6180339887498948;
  let kT2 = 0.38196601125010515;
  let absD = abs(direction);
  let selector1 = dot(absD, vec3f(1.0, kT2, -kT));
  let selector2 = dot(absD, vec3f(-kT, 1.0, kT2));
  let selector3 = dot(absD, vec3f(kT2, -kT, 1.0));
  let octantSign = sign(direction);
  let v1 = select(vec3f(-b, 0.0, a), vec3f(a, b, 0.0), selector1 > 0.0) * octantSign;
  let v2 = select(vec3f(a, -b, 0.0), vec3f(0.0, a, b), selector2 > 0.0) * octantSign;
  let v3 = select(vec3f(0.0, a, -b), vec3f(b, 0.0, a), selector3 > 0.0) * octantSign;
  // sortVertices
  let base = vec3f(0.5, 0.5, 1.0);
  var aw = vec4f(v1, dot(v1, base));
  var bw = vec4f(v2, dot(v2, base));
  var cw = vec4f(v3, dot(v3, base));
  if (aw.w > bw.w) { let t = aw; aw = bw; bw = t; }
  if (bw.w > cw.w) { let t = bw; bw = cw; cw = t; }
  if (aw.w > bw.w) { let t = aw; aw = bw; bw = t; }
  // getPentagonalWeights
  let d = vec3f(dot(aw.xyz, direction), dot(bw.xyz, direction), dot(cw.xyz, direction));
  let e = exp(d * 40.0);
  let weights = e / (e.x + e.y + e.z);
  if (jitter < weights.x) {
    return aw.xyz;
  }
  if (jitter < weights.x + weights.y) {
    return bw.xyz;
  }
  return cw.xyz;
}

fn marchShadow(origin: vec3f, direction: vec3f, maxRayDistance: f32, jitter: f32, mip: f32) -> vec4f {
  let maxIterationCount = i32(P.shadowMarch.x);
  let normal = structureNormal(direction, jitter);
  let samplePeriod = clamp(maxRayDistance / f32(maxIterationCount), P.shadowMarch.y, P.shadowMarch.z);
  // intersectStructuredPlanes
  let NoD = dot(direction, normal);
  let stepSize = samplePeriod / abs(NoD);
  var rayDistance = -glslMod(dot(origin, normal), samplePeriod) / NoD;
  if (rayDistance < 0.0) {
    rayDistance += stepSize;
  }
  // TEMPORAL_JITTER
  rayDistance -= stepSize * jitter;

  var extinctionSum = 0.0;
  var maxOpticalDepth = 0.0;
  var maxOpticalDepthTail = 0.0;
  var transmittanceIntegral = 1.0;
  var weightedDistanceSum = 0.0;
  var transmittanceSum = 0.0;
  var sampleCount = 0;
  for (var i = 0; i < maxIterationCount; i++) {
    if (rayDistance > maxRayDistance) {
      break;
    }
    let position = rayDistance * direction + origin;
    let h = length(position) - P.radii.x;
    if (insideLayerIntervals(h)) {
      rayDistance += stepSize;
      continue;
    }
    let uv = globeUv(position);
    let w = sampleWeather(uv, h, mip, P.shadowLayerMask);
    if (any(w.density > vec4f(P.shadowLimits.x))) {
      let media = sampleMedia(w, position, uv, mip, jitter);
      if (media.extinction > P.shadowLimits.y) {
        extinctionSum += media.extinction;
        maxOpticalDepth += media.extinction * stepSize;
        transmittanceIntegral *= exp(-media.extinction * stepSize);
        weightedDistanceSum += rayDistance * transmittanceIntegral;
        transmittanceSum += transmittanceIntegral;
        sampleCount++;
      }
    }
    if (transmittanceIntegral <= P.shadowLimits.z) {
      maxOpticalDepthTail = min(P.shadowMarch.w * stepSize * exp(f32(1 - sampleCount)), stepSize * 0.5);
      break;
    }
    rayDistance += stepSize;
  }
  if (sampleCount == 0) {
    return vec4f(maxRayDistance, 0.0, 0.0, 0.0);
  }
  let frontDepth = min(weightedDistanceSum / transmittanceSum, maxRayDistance);
  return vec4f(frontDepth, extinctionSum / f32(sampleCount), maxOpticalDepth, maxOpticalDepthTail);
}

const CASCADE_MIP_LEVELS = array<f32, 4>(0.0, 0.5, 1.0, 2.0);
const MAX_HALF_FLOAT = 65504.0;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = u32(P.shadowFilter.x);
  let cascade = id.z;
  if (id.x >= size || id.y >= size || cascade >= u32(P.shadow.w)) {
    return;
  }
  let fragCoord = vec2f(id.xy) + 0.5;
  let clip = fragCoord / f32(size) * 2.0 - 1.0;
  var point = P.inverseShadowMatrices[cascade] * vec4f(clip, -1.0, 1.0);
  point /= point.w;
  let sunPosition = (P.worldToEcef * vec4f(point.xyz, 1.0)).xyz + P.altitude.xyz;
  let direction = normalize(-P.sun.xyz);
  let first = raySphereFirst4(sunPosition, direction, P.radii.x + vec4f(P.shadow.y, P.shadow.z, 0.0, 0.0));
  let rayNear = max(0.0, first.x);
  var rayFar = first.y;
  if (rayFar < 0.0) {
    rayFar = 1e6;
  }
  let origin = rayNear * direction + sunPosition;
  let color = marchShadow(origin, direction, rayFar - rayNear, getSTBN(fragCoord), CASCADE_MIP_LEVELS[cascade]);
  // a ray that misses the bottom of the clouds (a low sun) has a length of 1e6 m, past what a half float holds: WebGL
  // stores the largest one, and an infinity here would spread through the filtering of the map (no shadow at the edges)
  textureStore(shadowOut, vec2i(id.xy), i32(cascade), min(color, vec4f(MAX_HALF_FLOAT)));
}
`

const CLOUDS_MAIN = /* wgsl */ `
@group(0) @binding(${BINDINGS.shadowMap}) var shadowMap: texture_2d_array<f32>;
@group(0) @binding(${BINDINGS.sceneDistance}) var<storage, read> sceneDistance: array<f32>;
@group(0) @binding(${BINDINGS.current}) var<storage, read_write> current: array<vec4f>;
@group(0) @binding(${BINDINGS.depthSum}) var<storage, read_write> depthSum: array<vec2f>;

fn henyeyGreenstein(g: vec2f, cosTheta: f32) -> vec2f {
  let g2 = g * g;
  return RECIPROCAL_PI4 * ((1.0 - g2) / max(vec2f(1e-7), pow(1.0 + g2 - 2.0 * g * cosTheta, vec2f(1.5))));
}

fn phaseFunction(cosTheta: f32, attenuation: f32) -> f32 {
  let weights = vec2f(1.0 - P.scatter.z, P.scatter.z);
  return dot(henyeyGreenstein(P.scatter.xy * attenuation, cosTheta), weights);
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

struct Depth {
  opticalDepth: f32,
  distance: f32,
}

fn marchOpticalDepth(origin: vec3f, direction: vec3f, maxIterationCount: i32, mip: f32, jitter: f32) -> Depth {
  var result = Depth(0.0, 0.0);
  let count = i32(max(0.0, mix(f32(maxIterationCount + 1), 1.0, mip) - jitter));
  if (count == 0) {
    // the library's fudge factor for the mean optical depth
    result.opticalDepth = 0.5;
    return result;
  }
  var stepSize = P.secondary.y / f32(count);
  var next = stepSize * jitter;
  for (var i = 0; i < count; i++) {
    result.distance = next;
    let position = next * direction + origin;
    let uv = globeUv(position);
    let w = sampleWeather(uv, length(position) - P.radii.x, mip, vec4f(1.0));
    result.opticalDepth += sampleMedia(w, position, uv, mip, jitter).extinction * stepSize;
    next += stepSize;
    stepSize *= P.secondary.z;
  }
  return result;
}

// three-geospatial's getFadedCascadeIndex
fn fadedCascadeIndex(world: vec3f, jitter: f32) -> i32 {
  let viewZ = (P.view * vec4f(world, 1.0)).z;
  let near = P.sun.w;
  let far = P.shadow.x;
  let depth = (viewZ + near) / (near - far);
  let count = i32(P.shadow.w);
  var nextIndex = -1;
  var prevIndex = -1;
  var alpha = 0.0;
  for (var i = 0; i < count; i++) {
    var interval: vec2f;
    switch i {
      case 0: { interval = P.shadowIntervals01.xy; }
      case 1: { interval = P.shadowIntervals01.zw; }
      case 2: { interval = P.shadowIntervals23.xy; }
      default: { interval = P.shadowIntervals23.zw; }
    }
    let center = (interval.x + interval.y) * 0.5;
    let closestEdge = select(interval.y, interval.x, depth < center);
    let margin = closestEdge * closestEdge * 0.5;
    interval += margin * vec2f(-0.5, 0.5);
    if (i < count - 1) {
      if (depth >= interval.x && depth < interval.y) {
        prevIndex = nextIndex;
        nextIndex = i;
        alpha = saturate(min(depth - interval.x, interval.y - depth) / margin);
      }
    } else if (depth >= interval.x) {
      prevIndex = nextIndex;
      nextIndex = i;
      alpha = saturate((depth - interval.x) / margin);
    }
  }
  return select(prevIndex, nextIndex, jitter <= alpha);
}

fn readShadowOpticalDepth(uv: vec2f, distanceToTop: f32, distanceOffset: f32, cascade: i32) -> f32 {
  let shadow = textureSampleLevel(shadowMap, linearClamp, uv, cascade, 0.0);
  let distanceToFront = max(0.0, distanceToTop - distanceOffset - shadow.r);
  return min(shadow.b + shadow.a, shadow.g * distanceToFront);
}

fn interleavedGradientNoise(coord: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(coord, vec2f(0.06711056, 0.00583715))));
}

fn vogelDisk(index: i32, sampleCount: i32, phi: f32) -> vec2f {
  let r = sqrt(f32(index) + 0.5) / sqrt(f32(sampleCount));
  let theta = f32(index) * 2.39996322972865332 + phi;
  return r * vec2f(cos(theta), sin(theta));
}

fn sampleShadowOpticalDepth(position: vec3f, distanceOffset: f32, radius: f32, jitter: f32, fragCoord: vec2f) -> f32 {
  let distanceToTop = raySphereSecond(position, P.sun.xyz, P.radii.x + P.shadow.y);
  if (distanceToTop <= 0.0) {
    return 0.0;
  }
  let world = (P.ecefToWorld * vec4f(position - P.altitude.xyz, 1.0)).xyz;
  let cascade = fadedCascadeIndex(world, jitter);
  if (cascade < 0) {
    return 0.0;
  }
  var clip = P.shadowMatrices[cascade] * vec4f(world, 1.0);
  clip /= clip.w;
  let uv = clip.xy * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return 0.0;
  }
  if (radius < 0.1) {
    return readShadowOpticalDepth(uv, distanceToTop, distanceOffset, cascade);
  }
  let count = i32(P.shadowFilter.z);
  let texelSize = 1.0 / P.shadowFilter.x;
  let phi = interleavedGradientNoise(fragCoord) * PI2;
  var total = 0.0;
  for (var i = 0; i < count; i++) {
    let offset = vogelDisk(i, count, phi);
    total += readShadowOpticalDepth(uv + offset * radius * texelSize, distanceToTop, distanceOffset, cascade);
  }
  return total / f32(count);
}

fn radianceFromGround(position: vec3f, normal: vec3f, mip: f32, jitter: f32) -> vec3f {
  let toGround = marchOpticalDepth(position, -normal, i32(P.ground.x), mip, jitter).opticalDepth;
  let groundIrradiance = P.groundSky.xyz + (1.0 - P.limits.w) * P.groundSun.xyz;
  return 0.3 * RECIPROCAL_PI * groundIrradiance * exp(-toGround);
}

struct Marched {
  color: vec4f,
  frontDepth: f32,
}

fn marchClouds(origin: vec3f, direction: vec3f, nearFar: vec2f, cosTheta: f32, jitter: f32, startTexelsPerPixel: f32, fragCoord: vec2f) -> Marched {
  var radianceIntegral = vec3f(0.0);
  var transmittanceIntegral = 1.0;
  var weightedDistanceSum = 0.0;
  var transmittanceSum = 0.0;
  let maxRayDistance = nearFar.y - nearFar.x;
  var stepSize = P.march.y + (P.march.w - 1.0) * nearFar.x;
  var distance = stepSize * jitter * 2.0;
  let maxIterationCount = i32(P.march.x);
  let shadowTop = P.shadow.y;
  for (var i = 0; i < maxIterationCount; i++) {
    if (distance > maxRayDistance) {
      break;
    }
    let position = distance * direction + origin;
    let h = length(position) - P.radii.x;
    let mip = log2(max(1.0, startTexelsPerPixel + distance * 1e-5));
    if (insideLayerIntervals(h)) {
      stepSize *= P.march.w;
      distance += mix(stepSize, P.march.z, min(1.0, mip));
      continue;
    }
    let uv = globeUv(position);
    let w = sampleWeather(uv, h, mip, vec4f(1.0));
    if (!any(w.density > vec4f(P.limits.x))) {
      // a longer step in empty space
      stepSize *= P.march.w;
      distance += mix(stepSize, P.march.z, min(1.0, mip));
      continue;
    }
    let media = sampleMedia(w, position, uv, mip, jitter);
    if (media.extinction > P.limits.y) {
      let alpha = remapClamped(h, P.radii.y, P.radii.z);
      let sky = mix(P.skyIrradianceMin.xyz, P.skyIrradianceMax.xyz, alpha);
      let sun = mix(P.sunIrradianceMin.xyz, P.sunIrradianceMax.xyz, alpha);
      let normal = normalize(position);
      // the march towards the sun for the details, the shadow map beyond
      let toSun = marchOpticalDepth(position, P.sun.xyz, i32(P.secondary.x), mip, jitter);
      var opticalDepth = toSun.opticalDepth;
      if (h < shadowTop) {
        opticalDepth += sampleShadowOpticalDepth(
          position,
          toSun.distance,
          P.shadowFilter.y * remapClamped(dot(P.sun.xyz, normal), 0.1, 0.0),
          jitter,
          fragCoord
        );
      }
      var radiance = sun * multipleScattering(opticalDepth, cosTheta);
      if (P.ground.z > 0.5 && h < shadowTop && mip < 0.5) {
        radiance += radianceFromGround(position, normal, mip, jitter) * RECIPROCAL_PI4 * P.ground.y;
      }
      // crude sky gradient, better than none in the shadows; the night fill of the app
      let skyGradient = dot(w.heightFraction * 0.5 + 0.5, media.weight);
      radiance += (sky * P.medium.z + P.night.xyz) * RECIPROCAL_PI4 * skyGradient;
      radiance *= media.scattering;
      if (P.switches.w > 0.5) {
        radiance *= 1.0 - P.medium.w * exp(-media.extinction * P.switches.x);
      }
      // energy-conserving integration of the scattered light (Frostbite 2016, 5.6.3)
      let transmittance = exp(-media.extinction * stepSize);
      radianceIntegral += transmittanceIntegral * (radiance - radiance * transmittance) / max(media.extinction, 1e-7);
      transmittanceIntegral *= transmittance;
      // for the aerial perspective on the clouds (5.9.1)
      weightedDistanceSum += distance * transmittanceIntegral;
      transmittanceSum += transmittanceIntegral;
    }
    if (transmittanceIntegral <= P.limits.z) {
      break;
    }
    stepSize *= P.march.w;
    distance += stepSize;
  }
  var result: Marched;
  result.color = vec4f(radianceIntegral, remapClamped(transmittanceIntegral, 1.0, P.limits.z));
  result.frontDepth = select(-1.0, weightedDistanceSum / transmittanceSum, transmittanceSum > 0.0);
  return result;
}

struct Intersections {
  ground: bool,
  first: vec4f,
  second: vec4f,
}

fn intersectionsOf(camera: vec3f, direction: vec3f) -> Intersections {
  var result: Intersections;
  let bottom = P.radii.x;
  let r = length(camera);
  let mu = dot(camera, direction) / r;
  result.ground = mu < 0.0 && r * r * (mu * mu - 1.0) + bottom * bottom >= 0.0;
  let radii = bottom + vec4f(0.0, P.radii.y, P.radii.z, P.shadow.y);
  let b = 2.0 * dot(direction, camera);
  let discriminant = b * b - 4.0 * (dot(camera, camera) - radii * radii);
  let miss = discriminant <= vec4f(0.0);
  let q = sqrt(max(vec4f(0.0), discriminant));
  result.first = select((-b - q) * 0.5, vec4f(-1.0), miss);
  result.second = select((-b + q) * 0.5, vec4f(-1.0), miss);
  return result;
}

// getRayNearFar of clouds.frag
fn rayNearFar(x: Intersections) -> vec2f {
  let cameraHeight = P.camera.w;
  var nearFar: vec2f;
  if (cameraHeight < P.radii.y) {
    if (x.ground) {
      return vec2f(-1.0);
    }
    nearFar = vec2f(x.second.y, min(x.second.z, P.radii.w));
  } else if (cameraHeight < P.radii.z) {
    nearFar = select(vec2f(P.sun.w, x.second.z), vec2f(P.sun.w, x.first.y), x.ground);
  } else {
    nearFar = vec2f(x.first.z, select(x.second.z, x.first.y, x.ground));
  }
  return nearFar;
}

fn rayDirection(fragCoord: vec2f) -> vec3f {
  let ndc = fragCoord / P.frame.xy * 2.0 - 1.0;
  // a point of the ray in view space (the library's vertex shader takes z = 0 too)
  let view = P.inverseProjection * vec4f(ndc, 0.0, 1.0);
  return normalize((P.viewToEcef * vec4f(view.xyz / view.w, 0.0)).xyz);
}

// The coordinate getMipLevel differentiates: the local weather texels under the start of the ray
fn weatherCoord(fragCoord: vec2f, fallback: vec2f) -> vec2f {
  let direction = rayDirection(fragCoord);
  let nearFar = rayNearFar(intersectionsOf(P.camera.xyz, direction));
  if (nearFar.x < 0.0) {
    return fallback;
  }
  return globeUv(nearFar.x * direction + P.camera.xyz) * P.localWeather.xy * P.frame.xy;
}

// getMipLevel without derivatives: the differences inside the 2 × 2 quad of the texel, as dFdx and dFdy give them
fn mipLevelAt(fragCoord: vec2f, coord: vec2f) -> f32 {
  let quad = floor((fragCoord - 0.5) * 0.5) * 2.0 + 0.5;
  let origin = weatherCoord(quad, coord);
  let ddx = weatherCoord(quad + vec2f(1.0, 0.0), origin) - origin;
  let ddy = weatherCoord(quad + vec2f(0.0, 1.0), origin) - origin;
  let deltaMaxSqr = max(dot(ddx, ddx), dot(ddy, ddy)) * 0.1;
  return max(0.0, 0.5 * log2(max(1.0, deltaMaxSqr)));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(P.frame.xy);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let index = id.y * size.x + id.x;
  let fragCoord = vec2f(id.xy) + 0.5;
  let direction = rayDirection(fragCoord);
  let camera = P.camera.xyz;
  var nearFar = rayNearFar(intersectionsOf(camera, direction));
  let toScene = sceneDistance[index];
  if (toScene > 0.0) {
    nearFar.y = min(nearFar.y, toScene);
  }
  var marched = Marched(vec4f(0.0), -1.0);
  if (!any(nearFar < vec2f(0.0)) && nearFar.y >= nearFar.x) {
    let origin = nearFar.x * direction + camera;
    var mip = mipLevelAt(fragCoord, globeUv(origin) * P.localWeather.xy * P.frame.xy) * P.ground.w;
    mip = mix(0.0, mip, min(1.0, 0.2 * P.camera.w / P.radii.z));
    marched = marchClouds(origin, direction, nearFar, dot(P.sun.xyz, direction), getSTBN(fragCoord), pow(2.0, mip), fragCoord);
  }
  // this slice (resolved into the frame by RESOLVE_SHADER), and the sum of the front depths of the slices that met clouds
  current[index] = marched.color;
  let depth = select(vec2f(0.0), vec2f(marched.frontDepth, 1.0), marched.frontDepth >= 0.0);
  if (P.altitude.w > 0.5) {
    depthSum[index] = depth;
  } else {
    depthSum[index] += depth;
  }
}
`

export const SHADOW_SHADER = COMMON + SHADOW_MAIN
export const CLOUDS_SHADER = COMMON + CLOUDS_MAIN

/**
 * The slices into the frame, as the library's resolve does it when the export turns the temporal upscale off
 * (cloudsResolve.frag, `temporalAntialiasing`; varianceClipping.glsl, 4 neighbours, gamma 1): the frame so far clipped to
 * the colours around the texel in this slice, then mixed with it by `alpha` = 1 / (slice + 1). The camera does not move
 * between the slices of a frame: the history is read at the texel itself.
 */
export const RESOLVE_SHADER = /* wgsl */ `
struct Resolve {
  size: vec2u,
  alpha: f32,
  unused: f32,
}

@group(0) @binding(${RESOLVE_BINDINGS.params}) var<uniform> R: Resolve;
@group(0) @binding(${RESOLVE_BINDINGS.current}) var<storage, read> current: array<vec4f>;
@group(0) @binding(${RESOLVE_BINDINGS.resolved}) var<storage, read_write> resolved: array<vec4f>;

fn at(p: vec2i) -> vec4f {
  let q = clamp(p, vec2i(0), vec2i(R.size) - 1);
  return current[u32(q.y) * R.size.x + u32(q.x)];
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= R.size.x || id.y >= R.size.y) {
    return;
  }
  let index = id.y * R.size.x + id.x;
  let c = current[index];
  if (R.alpha >= 1.0) {
    resolved[index] = c;
    return;
  }
  let p = vec2i(id.xy);
  var moment1 = c;
  var moment2 = c * c;
  for (var i = 0; i < 4; i++) {
    var offset: vec2i;
    switch i {
      case 0: { offset = vec2i(1, 0); }
      case 1: { offset = vec2i(0, -1); }
      case 2: { offset = vec2i(0, 1); }
      default: { offset = vec2i(-1, 0); }
    }
    let n = at(p + offset);
    moment1 += n;
    moment2 += n * n;
  }
  let mean = moment1 / 5.0;
  let sigma = sqrt(max(moment2 / 5.0 - mean * mean, vec4f(0.0)));
  // clipAABB(clamp(mean, min, max) = mean, history, mean - sigma, mean + sigma)
  let history = resolved[index];
  let v = history - mean;
  let unit = abs(v.xyz / (sigma.xyz + 1e-7));
  let ma = max(unit.x, max(unit.y, unit.z));
  var clipped = history;
  if (ma > 1.0) {
    clipped = mean + v / ma;
  }
  resolved[index] = mix(clipped, c, R.alpha);
}
`

/**
 * The frame: colour in half floats (two per u32, as a WebGL `HalfFloatType` RGBA texture reads them),
 * front depth from the start of the ray, -1 where no slice met clouds.
 */
export const FINISH_SHADER = /* wgsl */ `
struct Finish {
  size: vec2u,
  unused: vec2f,
}

@group(0) @binding(${FINISH_BINDINGS.params}) var<uniform> F: Finish;
@group(0) @binding(${FINISH_BINDINGS.resolved}) var<storage, read> resolved: array<vec4f>;
@group(0) @binding(${FINISH_BINDINGS.depthSum}) var<storage, read> depthSum: array<vec2f>;
@group(0) @binding(${FINISH_BINDINGS.color}) var<storage, read_write> color: array<vec2u>;
@group(0) @binding(${FINISH_BINDINGS.depth}) var<storage, read_write> depth: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= F.size.x || id.y >= F.size.y) {
    return;
  }
  let index = id.y * F.size.x + id.x;
  let c = resolved[index];
  color[index] = vec2u(pack2x16float(c.xy), pack2x16float(c.zw));
  let d = depthSum[index];
  depth[index] = select(-1.0, d.x / d.y, d.y > 0.0);
}
`

/** Halves a level of an RGBA8 texture into the next (the mips of the local weather, as WebGL's generateMipmap). */
export const MIP_SHADER = /* wgsl */ `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var halved: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(halved);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let p = vec2i(id.xy) * 2;
  let c = textureLoad(source, p, 0) + textureLoad(source, p + vec2i(1, 0), 0) +
    textureLoad(source, p + vec2i(0, 1), 0) + textureLoad(source, p + vec2i(1, 1), 0);
  textureStore(halved, vec2i(id.xy), c * 0.25);
}
`
