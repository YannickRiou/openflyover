import { afterEach, describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { buildFrameTimes } from '../export/schedule'
import { filmClockFor, type FilmClock } from '../film/clock'
import { DEFAULT_FILM } from '../film/model'
import { CAMERA_PRESETS } from '../flyover/cameraSettings'
import { CAMERA_FOV_DEG, computeFilmView } from '../flyover/filmCamera'
import { DEFAULT_PACING } from '../flyover/pacing'
import { trackPathOf } from '../flyover/path'
import { gpxTrack } from '../flyover/__fixtures__/smoothness'
import { createLocalFrame } from '../geo/ellipsoid'
import { centroid } from '../geo/lonLat'
import {
  DEFAULT_LENS,
  SHUTTER_STEP_PX,
  SHUTTER_SUBFRAMES,
  adaptiveShutterSamples,
  bloomParams,
  depthOfFieldParams,
  isValidLens,
  lensActive,
  previewShutterWeight,
  radialBlurLength,
  sameShot,
  setShutterSubFrame,
  shutterSamples,
  shutterSubFrame,
  subFrameCount,
  subFrameSlices,
  viewMotionPx,
  type ShutterView,
} from './lens'

describe('setting', () => {
  it('every effect is off by default: no composer is needed', () => {
    expect(isValidLens(DEFAULT_LENS)).toBe(true)
    expect(lensActive(DEFAULT_LENS, true)).toBe(false)
    expect(lensActive(DEFAULT_LENS, false)).toBe(false)
  })

  it('the flare needs the atmosphere, the other effects do not', () => {
    expect(lensActive({ ...DEFAULT_LENS, flare: 0.5 }, true)).toBe(true)
    expect(lensActive({ ...DEFAULT_LENS, flare: 0.5 }, false)).toBe(false)
    for (const key of ['shutter', 'bloom', 'depthOfField'] as const) expect(lensActive({ ...DEFAULT_LENS, [key]: 0.5 }, false), key).toBe(true)
  })

  it('rejects values out of range', () => {
    expect(isValidLens({ ...DEFAULT_LENS, shutter: 1.5 })).toBe(false)
    expect(isValidLens({ ...DEFAULT_LENS, depthOfField: -0.1 })).toBe(false)
  })
})

describe('effect parameters', () => {
  it('bloom grows with the amount, its radius stays inside the mipmap blur range', () => {
    expect(bloomParams(0, 0.6).intensity).toBe(0)
    expect(bloomParams(1, 0.6).intensity).toBeGreaterThan(bloomParams(0.5, 0.6).intensity)
    expect(bloomParams(1, 0).radius).toBeGreaterThan(0)
    expect(bloomParams(1, 1).radius).toBeLessThan(1)
  })

  it('depth of field: a stronger setting blurs more and narrows the sharp zone, which follows the focus distance', () => {
    const weak = depthOfFieldParams(0.2, 1000)
    const strong = depthOfFieldParams(1, 1000)
    expect(strong.bokehScale).toBeGreaterThan(weak.bokehScale)
    expect(strong.focusRange).toBeLessThan(weak.focusRange)
    expect(depthOfFieldParams(1, 2000).focusRange).toBeCloseTo(2 * strong.focusRange)
  })
})

describe('shutterSamples', () => {
  const times = [0, 0, 1, 2, 3, 3]
  const progress = [0, 0, 0.1, 0.2, 0.3, 0.3]

  it('a closed shutter or a single render gives the frame itself, exactly', () => {
    expect(shutterSamples(times, progress, 2, 0, SHUTTER_SUBFRAMES)).toEqual([{ progress: 0.1, timeS: 1 }])
    expect(shutterSamples(times, progress, 2, 0.6, 1)).toEqual([{ progress: 0.1, timeS: 1 }])
  })

  it('spreads the renders over the open shutter, centred on the frame', () => {
    const samples = shutterSamples(times, progress, 3, 1, 4)
    expect(samples.map((s) => s.timeS)).toEqual([1.625, 1.875, 2.125, 2.375])
    expect(samples[0].progress).toBeCloseTo(0.1625)
    const mean = samples.reduce((sum, s) => sum + s.timeS, 0) / samples.length
    expect(mean).toBeCloseTo(2)
    // a half-open shutter covers half the interval
    const half = shutterSamples(times, progress, 3, 0.5, 4).map((s) => s.timeS)
    expect(half[3] - half[0]).toBeCloseTo((1 - 1 / 4) / 2)
  })

  it('held frames do not move, the film ends are clamped', () => {
    expect(new Set(shutterSamples(times, progress, 0, 1, 4).map((s) => s.progress))).toEqual(new Set([0]))
    expect(shutterSamples(times, progress, 5, 1, 4).every((s) => s.progress === 0.3)).toBe(true)
  })

  it('an instant rejected (other side of a cut) is replaced by the frame itself', () => {
    const samples = shutterSamples(times, progress, 3, 1, 4, (t) => t <= 2)
    expect(samples.slice(2)).toEqual([
      { progress: 0.2, timeS: 2 },
      { progress: 0.2, timeS: 2 },
    ])
  })
})

describe('preview trail', () => {
  it('lags like the centre of the open shutter, whatever the preview frame rate', () => {
    for (const deltaS of [1 / 60, 1 / 30, 1 / 15]) {
      const w = previewShutterWeight(1, 30, deltaS)
      expect((deltaS * w) / (1 - w)).toBeCloseTo(1 / 60)
    }
    expect(previewShutterWeight(0, 30, 1 / 60)).toBe(0)
    expect(previewShutterWeight(1, 30, 0)).toBe(0)
  })
})

describe('radial speed blur', () => {
  it('grows with the speed of the camera relative to its aim distance, capped, none when still', () => {
    const slow = radialBlurLength(1, 5, 1000, 1 / 30)
    const fast = radialBlurLength(1, 15, 1000, 1 / 30)
    expect(fast).toBeCloseTo(3 * slow)
    expect(radialBlurLength(1, 15, 3000, 1 / 30)).toBeCloseTo(slow)
    expect(radialBlurLength(1, 1000, 1000, 1 / 30)).toBe(0.15)
    expect(radialBlurLength(1, 0.1, 1000, 1 / 30)).toBe(0)
    expect(radialBlurLength(0.5, 15, 1000, 1 / 30)).toBeCloseTo(fast / 2)
    expect(radialBlurLength(0, 15, 1000, 1 / 30)).toBe(0)
    // a jump longer than the aim distance is a cut: no blur on that frame
    expect(radialBlurLength(1, 1500, 1000, 1 / 30)).toBe(0)
  })

  it('a shot stops at a phase change and at a stage cut « À la suite »', () => {
    const clock = {
      stateAt: (t: number) => ({ phase: t < 2 ? 'opening' : 'flight' }),
      cuts: [{ atM: 1000, timeS: 10 }],
    } as unknown as FilmClock
    expect(sameShot(clock, 3, 9)).toBe(true)
    expect(sameShot(clock, 1.9, 2.1)).toBe(false)
    expect(sameShot(clock, 9.9, 10.1)).toBe(false)
    expect(sameShot(clock, 10.1, 9.9)).toBe(false)
  })

  it('does not depend on the frame rate', () => {
    expect(radialBlurLength(1, 10, 1000, 1 / 30)).toBeCloseTo(radialBlurLength(1, 20, 1000, 1 / 15))
  })
})

describe('sub-frames', () => {
  afterEach(() => setShutterSubFrame(0, 1))

  it('the export sets the sub-frame being rendered', () => {
    expect(shutterSubFrame()).toEqual({ index: 0, count: 1 })
    setShutterSubFrame(3, SHUTTER_SUBFRAMES)
    expect(shutterSubFrame()).toEqual({ index: 3, count: SHUTTER_SUBFRAMES })
  })

  it('the cloud noise slices of a frame are shared among its sub-frames, each its own', () => {
    expect(subFrameSlices(24, { index: 0, count: 1 })).toEqual({ first: 0, count: 24 })
    const used = new Set<number>()
    for (let index = 0; index < SHUTTER_SUBFRAMES; index++) {
      const { first, count } = subFrameSlices(24, { index, count: SHUTTER_SUBFRAMES })
      for (let k = 0; k < count; k++) used.add(first + k)
    }
    expect(used.size).toBe(24)
    expect(subFrameSlices(4, { index: 5, count: 8 })).toEqual({ first: 5, count: 1 })
  })

  it('every cloud slice is used exactly once whatever the number of sub-frames; a full frame splits as before', () => {
    for (const slices of [16, 24, 32]) {
      for (let count = 1; count <= SHUTTER_SUBFRAMES; count++) {
        const used: number[] = []
        for (let index = 0; index < count; index++) {
          const part = subFrameSlices(slices, { index, count })
          for (let k = 0; k < part.count; k++) used.push(part.first + k)
        }
        expect(used, `${slices} slices in ${count}`).toEqual([...Array(slices).keys()])
      }
      const per = slices / SHUTTER_SUBFRAMES
      for (let index = 0; index < SHUTTER_SUBFRAMES; index++) {
        expect(subFrameSlices(slices, { index, count: SHUTTER_SUBFRAMES })).toEqual({ first: index * per, count: per })
      }
    }
  })
})

/** Camera `distanceM` from `target` along z, looking at it (1080p frame, 16:9). */
const view = (x = 0, yawRad = 0, distanceM = 1000): ShutterView => {
  const position = { x, y: 100, z: 0 }
  const target = { x: x + distanceM * Math.sin(yawRad), y: 100, z: -distanceM * Math.cos(yawRad) }
  return { position, target, marker: target }
}
const motion = (a: ShutterView, b: ShutterView) => viewMotionPx(a, b, 1080, 16 / 9, 50)
const FOCAL_PX = 540 / Math.tan((25 * Math.PI) / 180)

describe('motion of the view on screen', () => {
  it('none when the camera and the marker stand still', () => {
    expect(motion(view(), view())).toBe(0)
  })

  it('a sideways move shifts the nearest relief guarded against (a quarter of the aim distance) by focal × move / depth', () => {
    expect(motion(view(0), view(1))).toBeCloseTo((FOCAL_PX * 1) / 250, 6)
  })

  it('a turn of the view counts, more at the corners than at the centre', () => {
    const turn = 0.01
    const px = motion(view(), view(0, turn))
    expect(px).toBeGreaterThan(FOCAL_PX * Math.tan(turn) * 0.99)
    expect(px).toBeLessThan(FOCAL_PX * turn * 2.5)
  })

  it('the marker moving on its own counts', () => {
    const a = view()
    const b = { ...a, marker: { ...a.marker, x: a.marker.x + 10 } }
    expect(motion(a, b)).toBeCloseTo((FOCAL_PX * 10) / 1000, 6)
  })

  it('a view that ends up looking away is a jump: infinite', () => {
    expect(motion(view(), view(0, Math.PI))).toBe(Infinity)
  })
})

describe('number of sub-frames', () => {
  it('1 without motion, the full count past SHUTTER_STEP_PX per reference step, in between by SHUTTER_STEP_PX steps', () => {
    expect(subFrameCount(0)).toBe(1)
    expect(subFrameCount(0.5 * SHUTTER_STEP_PX)).toBe(1)
    // the window is 8/7 of the span between the first and the last of the 8 reference renders
    expect(subFrameCount((SHUTTER_STEP_PX * 7) / 8)).toBe(1)
    expect(subFrameCount((SHUTTER_STEP_PX * 7) / 8 + 0.01)).toBe(2)
    expect(subFrameCount(3 * SHUTTER_STEP_PX)).toBe(4)
    expect(subFrameCount(7 * SHUTTER_STEP_PX)).toBe(SHUTTER_SUBFRAMES)
    expect(subFrameCount(1000)).toBe(SHUTTER_SUBFRAMES)
    expect(subFrameCount(Infinity)).toBe(SHUTTER_SUBFRAMES)
    expect(subFrameCount(NaN)).toBe(SHUTTER_SUBFRAMES)
    let last = 0
    for (let px = 0; px < 12; px += 0.1) {
      const n = subFrameCount(px)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
  })

  const times = [0, 1, 2, 3, 4, 5]
  const progress = [0, 0.1, 0.2, 0.3, 0.4, 0.5]
  const screen = { heightPx: 1080, aspect: 16 / 9, fovDeg: 50 }
  /** camera moving `pxPerFrame`-ish: 1 m per unit of film time per `speed` */
  const moving = (speed: number) => (s: { timeS: number }) => view(speed * s.timeS)

  it('a full frame is the 8 renders of before, to the bit', () => {
    const fast = adaptiveShutterSamples(times, progress, 3, 1, moving(50), screen)
    expect(fast).toEqual(shutterSamples(times, progress, 3, 1, SHUTTER_SUBFRAMES))
    expect(fast).toHaveLength(SHUTTER_SUBFRAMES)
  })

  it('standing still gives the frame itself, a closed shutter too', () => {
    expect(adaptiveShutterSamples(times, progress, 3, 1, moving(0), screen)).toEqual([{ progress: 0.3, timeS: 3 }])
    expect(adaptiveShutterSamples(times, progress, 3, 0, moving(50), screen)).toEqual([{ progress: 0.3, timeS: 3 }])
  })

  it('a slow move gets fewer renders, evenly spaced and centred like the full ones', () => {
    const slow = adaptiveShutterSamples(times, progress, 3, 1, moving(0.5), screen)
    expect(slow.length).toBeGreaterThan(1)
    expect(slow.length).toBeLessThan(SHUTTER_SUBFRAMES)
    expect(slow).toEqual(shutterSamples(times, progress, 3, 1, slow.length))
    expect(slow.reduce((sum, s) => sum + s.timeS, 0) / slow.length).toBeCloseTo(3)
  })

  it('a function of the film time: the same inputs, the same renders', () => {
    expect(adaptiveShutterSamples(times, progress, 3, 0.6, moving(0.5), screen)).toEqual(adaptiveShutterSamples(times, progress, 3, 0.6, moving(0.5), screen))
  })

  it('across a cut the renders stay in the shot: no motion measured over the jump', () => {
    const jump = (s: { timeS: number }) => view(s.timeS > 3 ? 5000 : 0)
    const own = adaptiveShutterSamples(times, progress, 3, 1, jump, screen, (t) => t <= 3)
    expect(own).toEqual([{ progress: 0.3, timeS: 3 }])
  })
})

describe('blur of fewer sub-frames, on a synthetic displacement model', () => {
  // image: a 1 px box-filtered signal; each sub-frame sees it shifted by the displacement at its instant
  const pixel = (signal: (x: number) => number, x: number) => {
    let sum = 0
    for (let k = 0; k < 8; k++) sum += signal(x + (k + 0.5) / 8 - 0.5)
    return sum / 8
  }
  const blend = (signal: (x: number) => number, x: number, windowPx: number, count: number) => {
    let sum = 0
    for (let j = 0; j < count; j++) sum += pixel(signal, x + windowPx * ((j + 0.5) / count - 0.5))
    return sum / count
  }
  const edge = (x: number) => (x >= 0 ? 1 : 0)
  // detail down to the pixel: random values a pixel apart, linearly interpolated
  let seed = 3
  const knots = Array.from({ length: 400 }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296))
  const texture = (x: number) => {
    const i = Math.floor(x)
    const t = x - i
    return knots[((i % 400) + 400) % 400] * (1 - t) + knots[(((i + 1) % 400) + 400) % 400] * t
  }

  it('stays within 10% of the contrast on a hard edge and 3% rms on pixel-scale detail, at any speed', () => {
    for (let windowPx = 0.05; windowPx <= 24; windowPx += 0.05) {
      // the count the controller derives from the span of the 8 reference renders
      const count = subFrameCount((windowPx * 7) / 8)
      let worst = 0
      let squares = 0
      let n = 0
      for (let x = -30; x < 30; x += 0.25) {
        worst = Math.max(worst, Math.abs(blend(edge, x, windowPx, count) - blend(edge, x, windowPx, SHUTTER_SUBFRAMES)))
        squares += (blend(texture, x, windowPx, count) - blend(texture, x, windowPx, SHUTTER_SUBFRAMES)) ** 2
        n++
      }
      expect(worst, `edge, ${windowPx.toFixed(2)} px`).toBeLessThan(0.1)
      expect(Math.sqrt(squares / n), `texture, ${windowPx.toFixed(2)} px`).toBeLessThan(0.03)
    }
  })
})

describe('sub-frames of a real film', () => {
  const track = gpxTrack(sampleGpx)
  const path = trackPathOf(track)
  const { lon, lat } = centroid(track.bounds)
  const frame = createLocalFrame(lon, lat)
  const FPS = 30
  /** counts of the 8-render frames per frame of the film: 120 s of flight with a still stop (« Fixe ») at 40% */
  function counts(presetName: string) {
    const camera = CAMERA_PRESETS.find((p) => p.name === presetName)!.camera
    const film = { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 's', atM: 0.4 * track.stats.distanceM, durationS: 4, camera: 'fixe' as const }] }
    const clock = filmClockFor({ track, film, durationS: 120, pacing: DEFAULT_PACING })
    const options = { exaggeration: 1, liftM: 3, camera, durationS: 120, aspect: 16 / 9 }
    const times = buildFrameTimes({ durationS: clock.totalTime(), fps: FPS })
    const progress = times.map((t) => clock.progressAtTime(t))
    const screen = { heightPx: 1080, aspect: 16 / 9, fovDeg: CAMERA_FOV_DEG }
    const viewOf = (s: { progress: number; timeS: number }) => computeFilmView(path, clock, s.timeS, s.progress, frame, null, options)
    const n = times.map((_, i) => adaptiveShutterSamples(times, progress, i, 1, viewOf, screen, (t) => sameShot(clock, t, times[i])).length)
    return { clock, times, n }
  }

  it('a still stop is rendered once per frame, the flight of a high camera needs fewer than 8 on average', () => {
    const { clock, times, n } = counts('Satellite')
    const stop = clock.stops[0]
    const held = times.flatMap((t, i) => (t > stop.holdStartS + 0.5 && t < stop.holdEndS - 0.5 ? [n[i]] : []))
    expect(held.length).toBeGreaterThan(30)
    expect(held.every((c) => c === 1)).toBe(true)
    expect(Math.max(...n)).toBeLessThanOrEqual(SHUTTER_SUBFRAMES)
    expect(n.reduce((a, b) => a + b, 0) / n.length).toBeLessThan(6)
  })

  it('the fast flight of a low camera keeps the 8 renders', () => {
    const { n } = counts('Poursuite')
    expect(n.filter((c) => c === SHUTTER_SUBFRAMES).length / n.length).toBeGreaterThan(0.9)
  })
})
