/**
 * « Couleurs vives » of the IGN photos: the material of a tile, already extended by the snow and the contours, gets a
 * third patch that makes the imagery colour livelier right after the photo is sampled (before the snow is blended over
 * it): yellows lean to yellow-green, colours get more saturated and contrasted. Realistic, only prettier.
 *
 * One uniform shared by every tile (`vividUniforms`, set each frame from the settings): 0 draws the photo as it is, so
 * the slider and the choice of another imagery never rebuild a tile. The formula is `vividColour`, tested; the GLSL
 * below follows its steps one by one. No texture is read.
 */
import { Uniform } from 'three'
import type { MeshStandardMaterial } from 'three'
import type { Settings } from '../state/store'

/** The imagery whose photos the setting livens (the plan is a drawn map, the other photos are left alone). */
const VIVID_IMAGERY_ID = 'ign-ortho'

export const vividUniforms = {
  /** 0 leaves the imagery as it is, 1 is the full effect */
  imageryVivid: new Uniform(0),
}

/** The strength the shader gets: the setting with the IGN photos, else 0 (the value of the setting is kept). */
export function vividStrength(settings: Pick<Settings, 'imagerySourceId' | 'imageryVivid'>): number {
  return settings.imagerySourceId === VIVID_IMAGERY_ID ? settings.imageryVivid : 0
}

/** Set the uniform from the settings. */
export function setVividUniforms(settings: Pick<Settings, 'imagerySourceId' | 'imageryVivid'>): void {
  vividUniforms.imageryVivid.value = vividStrength(settings)
}

/** Hue turned towards green at the full effect (degrees), saturation added, brightness taken off, contrast curve. */
const SHIFT_DEG = 20
const SATURATION = 0.6
const DARKEN = 0.1
const CURVE = 0.15
/** Luma that the contrast curve leaves where it is. */
const PIVOT = 0.4

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** [h in degrees, s, v] of an sRGB colour (components 0..1). */
function toHsv(r: number, g: number, b: number): [number, number, number] {
  const v = Math.max(r, g, b)
  const d = v - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (v === r) h = ((g - b) / d + 6) % 6
    else if (v === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [h * 60, v === 0 ? 0 : d / v, v]
}

function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const k = (n: number) => (n + h / 60) % 6
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)]
}

/**
 * The livened colour: `rgb` is an sRGB colour (0..1 each, not linear), `strength` from 0 (the same colour) to 1. Steps: the
 * hue of clear yellows leans to yellow-green (pale rocks and scree barely move); saturation up and brightness a little
 * down; contrast around the luma `PIVOT`; clamped.
 */
export function vividColour(rgb: readonly [number, number, number], strength: number): [number, number, number] {
  if (strength <= 0) return [rgb[0], rgb[1], rgb[2]]
  const s = strength
  const [h, sat, v] = toHsv(rgb[0], rgb[1], rgb[2])
  const weight = clamp01((sat - 0.12) / 0.2) * Math.max(0, 1 - Math.abs(h - 60) / 35)
  const [r1, g1, b1] = fromHsv(h + SHIFT_DEG * s * weight, sat, v)
  const l1 = luma(r1, g1, b1)
  const gain = 1 - DARKEN * s
  const r2 = (l1 + (1 + SATURATION * s) * (r1 - l1)) * gain
  const g2 = (l1 + (1 + SATURATION * s) * (g1 - l1)) * gain
  const b2 = (l1 + (1 + SATURATION * s) * (b1 - l1)) * gain
  const l2 = Math.max(1e-4, luma(r2, g2, b2))
  const k = clamp01(PIVOT + (l2 - PIVOT) * (1 + CURVE * s)) / l2
  return [clamp01(r2 * k), clamp01(g2 * k), clamp01(b2 * k)]
}

const fragmentHead = /* glsl */ `
uniform float imageryVivid;
vec3 vividToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 vividToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 vividHsv(vec3 c) {
  float v = max(c.r, max(c.g, c.b));
  float d = v - min(c.r, min(c.g, c.b));
  float h = 0.0;
  if (d > 0.0) {
    if (v == c.r) h = mod((c.g - c.b) / d + 6.0, 6.0);
    else if (v == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
  }
  return vec3(h * 60.0, v == 0.0 ? 0.0 : d / v, v);
}
vec3 vividRgb(vec3 hsv) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + hsv.x / 60.0, 6.0);
  return hsv.z - hsv.z * hsv.y * clamp(min(k, 4.0 - k), 0.0, 1.0);
}
// vividColour of vividShader.ts, step by step (c: sRGB colour)
vec3 vividColour(vec3 c, float s) {
  vec3 hsv = vividHsv(c);
  float w = clamp((hsv.y - 0.12) / 0.2, 0.0, 1.0) * max(0.0, 1.0 - abs(hsv.x - 60.0) / 35.0);
  c = vividRgb(vec3(hsv.x + ${SHIFT_DEG.toFixed(1)} * s * w, hsv.y, hsv.z));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = (l + (1.0 + ${SATURATION.toFixed(1)} * s) * (c - l)) * (1.0 - ${DARKEN.toFixed(1)} * s);
  l = max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  float l2 = clamp(${PIVOT.toFixed(1)} + (l - ${PIVOT.toFixed(1)}) * (1.0 + ${CURVE.toFixed(2)} * s), 0.0, 1.0);
  return clamp(c * (l2 / l), 0.0, 1.0);
}
`
// the photo only (a tile without one keeps its flat colour); nothing runs at 0: the colour is exactly the photo's
const fragmentVivid = /* glsl */ `
#ifdef USE_MAP
if (imageryVivid > 0.0) {
  diffuseColor.rgb = vividToLinear(vividColour(vividToSrgb(clamp(diffuseColor.rgb, 0.0, 1.0)), imageryVivid));
}
#endif
`

/** Extend the material of a tile after `applyContours`; every tile shares one program. */
export function applyVivid(material: MeshStandardMaterial): void {
  const previous = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    const chunk = '#include <map_fragment>'
    if (!shader.fragmentShader.includes(chunk)) throw new Error(`vivid shader: ${chunk} not found`)
    Object.assign(shader.uniforms, vividUniforms)
    // right after the photo is sampled, so before the code the snow adds there
    shader.fragmentShader = fragmentHead + shader.fragmentShader.replace(chunk, `${chunk}\n${fragmentVivid}`)
  }
  material.customProgramCacheKey = () => 'openflyover-terrain-snow-contours-vivid'
}
