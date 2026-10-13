/**
 * Motion blur: radial speed blur, then the average of the export sub-frames or a trail while the preview plays
 * (ARCHITECTURE.md, « Objectif »).
 */
import { BlendFunction, Effect, ShaderPass } from 'postprocessing'
import { HalfFloatType, NoBlending, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { previewShutterWeight, RADIAL_MASK_START, SHUTTER_SUBFRAMES, shutterCentreWeights, shutterSubFrame } from './lens'

const fragmentShader = /* glsl */ `
uniform sampler2D shutterAverage;
uniform bool shutterActive;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = shutterActive ? texture2D(shutterAverage, uv) : inputColor;
}
`

const blendShader = /* glsl */ `
#define RADIAL_TAPS 10
#define SUBFRAMES ${SHUTTER_SUBFRAMES}
uniform sampler2D inputBuffer;
uniform sampler2D historyBuffer;
uniform float historyWeight;
uniform int subFrame;
uniform float centreWeight[SUBFRAMES];
uniform vec2 radialCentre;
uniform float radialLength;
uniform float radialAspect;
varying vec2 vUv;

// 0 in the centre of travel (sharp inside the start), 1 in the farthest corner (twin of radialMask in lens.ts)
float radialMask(vec2 offset) {
  vec2 corner = (0.5 + abs(radialCentre - 0.5)) * vec2(radialAspect, 1.0);
  return smoothstep(${RADIAL_MASK_START.toFixed(2)}, 1.0, length(offset * vec2(radialAspect, 1.0)) / length(corner));
}

void main() {
  vec2 offset = vUv - radialCentre;
  float mask = radialMask(offset);
  vec4 color = texture2D(inputBuffer, vUv);
  float streak = radialLength * mask;
  if (streak > 0.0) {
    for (int i = 1; i < RADIAL_TAPS; i++) {
      color += texture2D(inputBuffer, vUv - offset * streak * float(i) / float(RADIAL_TAPS - 1));
    }
    color /= float(RADIAL_TAPS);
  }
  float history = historyWeight * mask;
  if (subFrame >= 0) {
    // export: weighted running mean, W = cumulative sum of mix(centre, 1, mask) over the sub-frames so far
    float before = 0.0;
    float total = 0.0;
    for (int i = 0; i < SUBFRAMES; i++) {
      if (i > subFrame) break;
      float w = mix(centreWeight[i], 1.0, mask);
      if (i < subFrame) before += w;
      total += w;
    }
    history = before / total;
  }
  gl_FragColor = mix(color, texture2D(historyBuffer, vUv), history);
}
`

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

export class ShutterEffect extends Effect {
  playing = false
  shutter = 0
  fps = 30
  /** radial speed blur of this frame: centre (uv) and streak length, 0 = none */
  readonly radialCentre = new Vector2(0.5, 0.5)
  radialLength = 0
  private history: WebGLRenderTarget
  private current: WebGLRenderTarget
  private readonly blend: ShaderPass
  /** a sub-frame rendered again (waiting for tiles) restarts from the same history */
  private lastIndex = -1
  private trail = false
  /** sub-frame count the centre weights were last uploaded for */
  private centreCount = 0

  constructor() {
    super('ShutterEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['shutterAverage', new Uniform<Texture | null>(null)],
        ['shutterActive', new Uniform(false)],
      ]),
    })
    // half floats: an average of 8-bit images would lose its low bits
    const target = () => new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType })
    this.history = target()
    this.current = target()
    this.blend = new ShaderPass(
      new ShaderMaterial({
        name: 'ShutterBlend',
        uniforms: {
          inputBuffer: new Uniform(null),
          historyBuffer: new Uniform(null),
          historyWeight: new Uniform(0),
          subFrame: new Uniform(-1),
          centreWeight: new Uniform<number[]>(new Array<number>(SHUTTER_SUBFRAMES).fill(1)),
          radialCentre: new Uniform(new Vector2()),
          radialLength: new Uniform(0),
          radialAspect: new Uniform(1),
        },
        vertexShader,
        fragmentShader: blendShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
  }

  private swap(): void {
    ;[this.history, this.current] = [this.current, this.history]
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime = 0): void {
    const { index, count } = shutterSubFrame()
    const active = this.uniforms.get('shutterActive')!
    let weight: number
    let subFrameIndex = -1
    if (count > 1) {
      subFrameIndex = index
      if (index > 0 && index !== this.lastIndex) this.swap()
      this.lastIndex = index
      this.trail = false
      weight = 0
    } else {
      this.lastIndex = -1
      weight = this.playing ? previewShutterWeight(this.shutter, this.fps, deltaTime) : 0
      if (weight > 0) {
        if (!this.trail) weight = 0
        this.swap()
        this.trail = true
      } else {
        this.trail = false
        if (this.radialLength <= 0) {
          active.value = false
          return
        }
      }
    }
    const uniforms = (this.blend.fullscreenMaterial as ShaderMaterial).uniforms
    uniforms.historyBuffer.value = this.history.texture
    uniforms.historyWeight.value = weight
    uniforms.subFrame.value = subFrameIndex
    if (subFrameIndex >= 0 && this.centreCount !== count) {
      this.centreCount = count
      const centre = shutterCentreWeights(count)
      uniforms.centreWeight.value = Array.from({ length: SHUTTER_SUBFRAMES }, (_, i) => centre[i] ?? 1)
    }
    uniforms.radialCentre.value.copy(this.radialCentre)
    uniforms.radialLength.value = this.radialLength
    uniforms.radialAspect.value = inputBuffer.width / Math.max(1, inputBuffer.height)
    this.blend.render(renderer, inputBuffer, this.current)
    this.uniforms.get('shutterAverage')!.value = this.current.texture
    active.value = true
  }

  override setSize(width: number, height: number): void {
    this.history.setSize(width, height)
    this.current.setSize(width, height)
    this.trail = false
  }

  override dispose(): void {
    this.history.dispose()
    this.current.dispose()
    this.blend.dispose()
    super.dispose()
  }
}
