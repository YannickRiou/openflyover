/**
 * The WebGL side of the WebGPU clouds (`bridge.ts`):
 * - what the WebGPU march needs from the WebGL frame: the ray distance to the relief of each texel of the cloud pass (the
 *   library's `getRayDistanceToScene`, from the scene's depth buffer), and the six sun and sky irradiances its vertex
 *   shader computes with the atmosphere (`sampleSunSkyIrradiance`), both read back with `readPixels`;
 * - where the WebGPU result goes: the library's clouds and shadow map materials are patched to read it instead of
 *   marching (`webgpuClouds` = 1), so the rest of the pass is the library's own: the ray limits, the aerial perspective on
 *   the clouds, the resolve, the composition over the scene, the cloud shadows on the terrain.
 */
import type { CloudsEffect } from '@takram/three-clouds'
import { common, definitions, runtime } from '@takram/three-atmosphere/shaders/bruneton'
import { resolveIncludes } from '@takram/three-geospatial'
import { depth } from '@takram/three-geospatial/shaders'
import {
  DataArrayTexture,
  DataTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import { cloudDefinesOf, cloudUniformsOf, type Irradiances } from './fromEffect'
import type { CloudFrameOutput } from './gpu'

const VERTEX = /* glsl */ `
precision highp float;
layout(location = 0) in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Four texels of the cloud pass per output pixel, so that `readPixels` reads RGBA floats (always readable). */
const SCENE_DISTANCE = /* glsl */ `
precision highp float;
#include <packing>
#include "core/depth"

uniform sampler2D depthBuffer;
uniform mat4 inverseProjectionMatrix;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 resolution;
uniform vec2 targetUvScale;

out vec4 outputColor;

float distanceAt(const float x, const float y) {
  vec2 uv = vec2(x + 0.5, y + 0.5) / resolution;
  float depth = readDepthValue(depthBuffer, uv * targetUvScale);
  if (depth >= 1.0 - 1e-7) {
    return 0.0;
  }
  depth = reverseLogDepth(depth, cameraNear, cameraFar);
  float viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  // the library's -viewZ / dot(rayDirection, cameraDirection), in view space
  vec3 direction = normalize((inverseProjectionMatrix * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz);
  return viewZ / direction.z;
}

void main() {
  float x = floor(gl_FragCoord.x) * 4.0;
  float y = floor(gl_FragCoord.y);
  outputColor = vec4(distanceAt(x, y), distanceAt(x + 1.0, y), distanceAt(x + 2.0, y), distanceAt(x + 3.0, y));
}
`

/** The six irradiances of the library's vertex shader: ground sun, ground sky, then sun and sky at the bottom and top of the clouds. */
const IRRADIANCE = /* glsl */ `
precision highp float;
precision highp sampler3D;

#include "atmosphere/bruneton/definitions"

uniform AtmosphereParameters ATMOSPHERE;
uniform vec3 SUN_SPECTRAL_RADIANCE_TO_LUMINANCE;
uniform vec3 SKY_SPECTRAL_RADIANCE_TO_LUMINANCE;

uniform sampler2D transmittance_texture;
uniform sampler3D scattering_texture;
uniform sampler2D irradiance_texture;
uniform sampler3D single_mie_scattering_texture;
uniform sampler3D higher_order_scattering_texture;

#include "atmosphere/bruneton/common"
#include "atmosphere/bruneton/runtime"

uniform vec3 cameraPositionECEF;
uniform float bottomRadius;
uniform float minHeight;
uniform float maxHeight;
uniform vec3 sunDirection;

out vec4 outputColor;

void main() {
  int i = int(gl_FragCoord.x);
  vec3 sky;
  vec3 sun;
  if (i < 2) {
    sun = GetSunAndSkyScalarIrradiance(cameraPositionECEF * METER_TO_LENGTH_UNIT, sunDirection, sky);
  } else {
    float radius = (bottomRadius + (i < 4 ? minHeight : maxHeight)) * METER_TO_LENGTH_UNIT;
    sun = GetSunAndSkyScalarIrradiance(normalize(cameraPositionECEF) * radius, sunDirection, sky);
  }
  outputColor = vec4(i % 2 == 0 ? sun : sky, 1.0);
}
`

const MARCH_CALL = /color = marchClouds\(\s*rayOrigin,[\s\S]*?\);/
const CASCADE_OPEN = /void cascade\(\s*const int cascadeIndex,\s*const float mipLevel,\s*out vec4 outputColor,\s*out vec3 outputDepthVelocity\s*\)\s*\{/

/**
 * The clouds material reads the WebGPU march (`webgpuColor`, `webgpuFrontDepth`, texel per texel) where `webgpuClouds`
 * is 1; the source is unchanged when it does not have the expected text (the clouds then stay WebGL, `support.ts`).
 */
export function patchCloudsRead(source: string): string {
  const calls = source.match(new RegExp(MARCH_CALL.source, 'g')) ?? []
  if (calls.length !== 1 || source.includes('webgpuClouds')) return source
  return source
    .replace('uniform sampler2D depthBuffer;', 'uniform sampler2D depthBuffer;\nuniform float webgpuClouds;\nuniform highp sampler2D webgpuColor;\nuniform highp sampler2D webgpuFrontDepth;')
    .replace(
      MARCH_CALL,
      (call) => `if (webgpuClouds > 0.5) {
      color = texelFetch(webgpuColor, ivec2(gl_FragCoord.xy), 0);
      marchedFrontDepth = texelFetch(webgpuFrontDepth, ivec2(gl_FragCoord.xy), 0).r;
    } else {
      ${call}
    }`,
    )
}

/** The shadow map material writes the WebGPU shadow map (`webgpuShadow`) where `webgpuClouds` is 1. */
export function patchShadowRead(source: string): string {
  if (!CASCADE_OPEN.test(source) || source.includes('webgpuClouds')) return source
  return source
    .replace('in vec2 vUv;', 'in vec2 vUv;\nuniform float webgpuClouds;\nuniform highp sampler2DArray webgpuShadow;')
    .replace(
      CASCADE_OPEN,
      (open) => `${open}
  if (webgpuClouds > 0.5) {
    outputColor = texelFetch(webgpuShadow, ivec3(ivec2(gl_FragCoord.xy), cascadeIndex), 0);
    outputDepthVelocity = vec3(0.0);
    return;
  }`,
    )
}

/** The textures the patched materials read, and the switch. */
export interface WebgpuReads {
  mode: Uniform<number>
  color: Uniform<Texture | null>
  frontDepth: Uniform<Texture | null>
  shadow: Uniform<Texture | null>
}

/** Patch both materials of `effect`; null when one of them does not take the patch (another library version). */
export function patchEffect(effect: CloudsEffect): WebgpuReads | null {
  const clouds = effect.cloudsPass.currentMaterial
  const shadow = effect.shadowPass.currentMaterial
  const cloudsSource = patchCloudsRead(clouds.fragmentShader)
  const shadowSource = patchShadowRead(shadow.fragmentShader)
  const already = clouds.fragmentShader.includes('webgpuClouds') && shadow.fragmentShader.includes('webgpuClouds')
  if (!already && (cloudsSource === clouds.fragmentShader || shadowSource === shadow.fragmentShader)) return null
  const reads: WebgpuReads = {
    mode: (clouds.uniforms.webgpuClouds as Uniform<number> | undefined) ?? new Uniform(0),
    color: (clouds.uniforms.webgpuColor as Uniform<Texture | null> | undefined) ?? new Uniform(null),
    frontDepth: (clouds.uniforms.webgpuFrontDepth as Uniform<Texture | null> | undefined) ?? new Uniform(null),
    shadow: (shadow.uniforms.webgpuShadow as Uniform<Texture | null> | undefined) ?? new Uniform(null),
  }
  Object.assign(clouds.uniforms, { webgpuClouds: reads.mode, webgpuColor: reads.color, webgpuFrontDepth: reads.frontDepth })
  Object.assign(shadow.uniforms, { webgpuClouds: reads.mode, webgpuShadow: reads.shadow })
  if (!already) {
    clouds.fragmentShader = cloudsSource
    shadow.fragmentShader = shadowSource
    clouds.needsUpdate = true
    shadow.needsUpdate = true
  }
  return reads
}

const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

/** A full-screen draw of `material` into a float target, read back. */
class ReadbackPass {
  readonly mesh: Mesh<PlaneGeometry, RawShaderMaterial>
  private target = new WebGLRenderTarget(1, 1, { type: FloatType, format: RGBAFormat, depthBuffer: false, stencilBuffer: false })
  private pixels = new Float32Array(4)

  constructor(material: RawShaderMaterial) {
    this.target.texture.minFilter = NearestFilter
    this.target.texture.magFilter = NearestFilter
    this.mesh = new Mesh(new PlaneGeometry(2, 2), material)
    this.mesh.frustumCulled = false
  }

  read(renderer: WebGLRenderer, width: number, height: number): Float32Array {
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height)
    if (this.pixels.length !== width * height * 4) this.pixels = new Float32Array(width * height * 4)
    const previous = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    try {
      renderer.setRenderTarget(this.target)
      renderer.render(this.mesh, quadCamera)
      renderer.readRenderTargetPixels(this.target, 0, 0, width, height, this.pixels)
    } finally {
      renderer.setRenderTarget(previous)
      renderer.autoClear = autoClear
    }
    return this.pixels
  }

  dispose(): void {
    this.target.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

const copyDefines = (defines: Record<string, unknown>) => ({ ...defines }) as Record<string, string>

/** What the WebGPU frame needs from WebGL, measured for this frame. */
export interface WebglInputs {
  sceneDistance: Float32Array
  irradiances: Irradiances
}

const _camera = new Vector3()

/** The two read backs of a frame, built for one effect. */
export class WebglInputPasses {
  private distance: ReadbackPass
  private irradiance: ReadbackPass
  private distanceUniforms: Record<string, Uniform>
  private irradianceUniforms: Record<string, Uniform>
  private effect: CloudsEffect

  constructor(effect: CloudsEffect) {
    this.effect = effect
    const clouds = effect.cloudsPass.currentMaterial
    const u = clouds.uniforms as unknown as Record<string, Uniform>
    this.distanceUniforms = {
      depthBuffer: u.depthBuffer,
      inverseProjectionMatrix: u.inverseProjectionMatrix,
      cameraNear: u.cameraNear,
      cameraFar: u.cameraFar,
      targetUvScale: u.targetUvScale,
      resolution: new Uniform(new Vector2()),
    }
    this.distance = new ReadbackPass(
      new RawShaderMaterial({
        name: 'WebgpuCloudsSceneDistance',
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: resolveIncludes(SCENE_DISTANCE, { core: { depth } }),
        uniforms: this.distanceUniforms,
        depthTest: false,
        depthWrite: false,
      }),
    )
    this.irradianceUniforms = {
      ATMOSPHERE: u.ATMOSPHERE,
      SUN_SPECTRAL_RADIANCE_TO_LUMINANCE: u.SUN_SPECTRAL_RADIANCE_TO_LUMINANCE,
      SKY_SPECTRAL_RADIANCE_TO_LUMINANCE: u.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE,
      transmittance_texture: u.transmittance_texture,
      scattering_texture: u.scattering_texture,
      irradiance_texture: u.irradiance_texture,
      single_mie_scattering_texture: u.single_mie_scattering_texture,
      higher_order_scattering_texture: u.higher_order_scattering_texture,
      bottomRadius: u.bottomRadius,
      minHeight: u.minHeight,
      maxHeight: u.maxHeight,
      sunDirection: u.sunDirection,
      cameraPositionECEF: new Uniform(new Vector3()),
    }
    this.irradiance = new ReadbackPass(
      new RawShaderMaterial({
        name: 'WebgpuCloudsIrradiance',
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: resolveIncludes(IRRADIANCE, { atmosphere: { bruneton: { common, definitions, runtime } } }),
        uniforms: this.irradianceUniforms,
        defines: copyDefines(clouds.defines),
        depthTest: false,
        depthWrite: false,
      }),
    )
  }

  /** Read both for the frame whose uniforms `CloudsEffect.update` has just set; `width` × `height`: the cloud pass. */
  read(renderer: WebGLRenderer, width: number, height: number): WebglInputs {
    const effect = this.effect
    const defines = cloudDefinesOf(effect)
    const material = this.distance.mesh.material
    // the depth packing and the logarithmic depth as the clouds material reads them
    const wanted = {
      DEPTH_PACKING: defines.DEPTH_PACKING,
      USE_LOGARITHMIC_DEPTH_BUFFER: defines.USE_LOGARITHMIC_DEPTH_BUFFER,
    }
    const current = material.defines as Record<string, unknown>
    if (current.DEPTH_PACKING !== wanted.DEPTH_PACKING || current.USE_LOGARITHMIC_DEPTH_BUFFER !== wanted.USE_LOGARITHMIC_DEPTH_BUFFER) {
      material.defines = Object.fromEntries(Object.entries(wanted).filter(([, v]) => v !== undefined)) as Record<string, string>
      material.needsUpdate = true
    }
    ;(this.distanceUniforms.resolution.value as Vector2).set(width, height)
    const packedWidth = Math.ceil(width / 4)
    const packed = this.distance.read(renderer, packedWidth, height)
    const sceneDistance = new Float32Array(width * height)
    for (let y = 0; y < height; y++) sceneDistance.set(packed.subarray(y * packedWidth * 4, y * packedWidth * 4 + width), y * width)

    const u = cloudUniformsOf(effect)
    const camera = effect.mainCamera
    _camera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(u.worldToECEFMatrix.value).add(u.altitudeCorrection.value)
    ;(this.irradianceUniforms.cameraPositionECEF.value as Vector3).copy(_camera)
    const p = this.irradiance.read(renderer, 6, 1)
    const at = (i: number) => [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]] as const
    return {
      sceneDistance,
      irradiances: { groundSun: at(0), groundSky: at(1), minSun: at(2), minSky: at(3), maxSun: at(4), maxSky: at(5) },
    }
  }

  dispose(): void {
    this.distance.dispose()
    this.irradiance.dispose()
  }
}

/** The WebGPU frame as textures for the patched materials, reused from frame to frame. */
export class WebgpuUploads {
  private color: DataTexture | null = null
  private frontDepth: DataTexture | null = null
  private shadow: DataArrayTexture | null = null

  apply(output: CloudFrameOutput, reads: WebgpuReads): void {
    const { width, height, shadowSize, cascades } = output
    if (!this.color || this.color.image.width !== width || this.color.image.height !== height) {
      this.color?.dispose()
      this.frontDepth?.dispose()
      this.color = nearest(new DataTexture(output.color, width, height, RGBAFormat, HalfFloatType))
      this.frontDepth = nearest(new DataTexture(output.frontDepth, width, height, RedFormat, FloatType))
    } else {
      this.color.image.data = output.color
      this.frontDepth!.image.data = output.frontDepth
    }
    if (!this.shadow || this.shadow.image.width !== shadowSize || this.shadow.image.depth !== cascades) {
      this.shadow?.dispose()
      this.shadow = nearest(new DataArrayTexture(output.shadow, shadowSize, shadowSize, cascades))
      this.shadow.format = RGBAFormat
      this.shadow.type = HalfFloatType
    } else {
      this.shadow.image.data = output.shadow
    }
    this.color.needsUpdate = true
    this.frontDepth!.needsUpdate = true
    this.shadow.needsUpdate = true
    reads.color.value = this.color
    reads.frontDepth.value = this.frontDepth
    reads.shadow.value = this.shadow
  }

  dispose(): void {
    this.color?.dispose()
    this.frontDepth?.dispose()
    this.shadow?.dispose()
    this.color = this.frontDepth = this.shadow = null
  }
}

function nearest<T extends DataTexture | DataArrayTexture>(texture: T): T {
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.unpackAlignment = 1
  return texture
}
