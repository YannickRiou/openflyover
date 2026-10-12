import { describe, expect, it } from 'vitest'
import { BADGE_INK, BADGE_WHITE, drawBadge, drawMarker, luminance, markerLayout, readableInk, squareCrop } from './markerBadge'
import { MARKER_FIGURE_PATHS } from './markerFigures'

/** 2D context recording the calls drawBadge makes. */
function recordingContext() {
  const calls: string[] = []
  const ctx = new Proxy(
    {},
    {
      get: (_, name: string) => (...args: unknown[]) => {
        calls.push(`${name}(${args.map(String).join(',')})`)
        // a gradient records its stops
        return name === 'createRadialGradient' ? { addColorStop: (at: number, color: string) => calls.push(`stop(${at},${color})`) } : undefined
      },
      set: (_, name: string, value: unknown) => (calls.push(`${name}=${String(value)}`), true),
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const fakePath = (d: string) => d as unknown as Path2D

describe('marker badge', () => {
  it('picks ink on light colours and white on dark ones', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6)
    expect(luminance('#000000')).toBe(0)
    expect(readableInk('#FFC53D')).toBe(BADGE_INK)
    expect(readableInk(BADGE_INK)).toBe(BADGE_WHITE)
  })

  it('crops the centred square of a picture', () => {
    expect(squareCrop(400, 300)).toEqual({ x: 50, y: 0, side: 300 })
    expect(squareCrop(100, 160)).toEqual({ x: 0, y: 30, side: 100 })
  })

  it('draws a ball with its halo as two discs', () => {
    const { ctx, calls } = recordingContext()
    drawBadge(ctx, 64, { kind: 'disc', fill: '#5BC0EB', ring: BADGE_INK, ringWidth: 0.25 })
    expect(calls.filter((c) => c.startsWith('arc('))).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith('fillStyle='))).toEqual([`fillStyle=${BADGE_INK}`, 'fillStyle=#5BC0EB'])
  })

  it('strokes every path of the figure, mirrored when asked', () => {
    const plain = recordingContext()
    drawBadge(plain.ctx, 128, { kind: 'figure', figure: 'cycliste', fill: BADGE_INK, ring: BADGE_WHITE, mirrored: false }, fakePath)
    expect(plain.calls.filter((c) => c.startsWith('stroke('))).toHaveLength(MARKER_FIGURE_PATHS.cycliste.length)
    expect(plain.calls).toContain(`strokeStyle=${BADGE_WHITE}`)
    expect(plain.calls).not.toContain('scale(-1,1)')

    const mirrored = recordingContext()
    drawBadge(mirrored.ctx, 128, { kind: 'figure', figure: 'cycliste', fill: BADGE_INK, ring: BADGE_WHITE, mirrored: true }, fakePath)
    expect(mirrored.calls).toContain('scale(-1,1)')
  })

  it('draws the figure badge shapes: a pin, a rounded square, the figure alone over its outline', () => {
    const figure = { kind: 'figure', figure: 'nageur', fill: BADGE_INK, ring: BADGE_WHITE, mirrored: false } as const
    const pin = recordingContext()
    drawBadge(pin.ctx, 128, { ...figure, shape: 'epingle' }, fakePath)
    // outline and inner pin: from the tip, round the head
    expect(pin.calls.filter((c) => c.startsWith('moveTo(64,127)'))).toHaveLength(2)
    const square = recordingContext()
    drawBadge(square.ctx, 128, { ...figure, shape: 'carre' }, fakePath)
    expect(square.calls.filter((c) => c.startsWith('roundRect('))).toHaveLength(2)
    const alone = recordingContext()
    drawBadge(alone.ctx, 128, { ...figure, fill: '#E4572E', shape: 'contour' }, fakePath)
    expect(alone.calls.filter((c) => c.startsWith('arc('))).toHaveLength(0)
    expect(alone.calls.filter((c) => c.startsWith('stroke('))).toHaveLength(2 * MARKER_FIGURE_PATHS.nageur.length)
    expect(alone.calls.filter((c) => c.startsWith('strokeStyle='))).toEqual([`strokeStyle=${BADGE_WHITE}`, 'strokeStyle=#E4572E'])
  })

  it('draws a halo as a fading gradient and a pulse as a ring that fades out', () => {
    const halo = recordingContext()
    drawBadge(halo.ctx, 64, { kind: 'disc', fill: '#5BC0EB', style: 'halo' })
    expect(halo.calls).toContain('stop(1,rgba(91,192,235,0))')
    const early = recordingContext()
    drawBadge(early.ctx, 64, { kind: 'disc', fill: '#5BC0EB', style: 'pulsation', pulse: 0 })
    const late = recordingContext()
    drawBadge(late.ctx, 64, { kind: 'disc', fill: '#5BC0EB', style: 'pulsation', pulse: 0.8 })
    const ringRadius = (calls: string[]) => Number(calls.find((c) => c.startsWith('arc('))?.split(',')[2])
    expect(ringRadius(late.calls)).toBeGreaterThan(ringRadius(early.calls))
    expect(early.calls).toContain('strokeStyle=rgba(91,192,235,0.85)')
  })

  it('draws the stick, its shadow and the label around the badge', () => {
    const drawing = { badge: { kind: 'disc', fill: BADGE_WHITE } as const, diameter: 1, stick: true, label: 'Moi' }
    const layout = markerLayout(drawing, (text) => text.length * 40)
    const { ctx, calls } = recordingContext()
    drawMarker(ctx, layout, drawing, fakePath)
    expect(calls[0]).toBe(`clearRect(0,0,${layout.width},${layout.height})`)
    expect(calls.filter((c) => c.startsWith('lineTo('))).toEqual([
      `lineTo(${layout.width / 2},${layout.footY})`,
      `lineTo(${layout.width / 2},${layout.footY})`,
    ])
    expect(calls).toContain(`fillText(Moi,${layout.width / 2},${(layout.label?.top ?? 0) + (layout.label?.height ?? 0) / 2})`)
    // without extras: just the badge, on a canvas of its size
    const plain = markerLayout({ ...drawing, stick: false, label: '' }, () => 0)
    expect(plain).toMatchObject({ width: 128, height: 128, anchorY: 64, footY: null, label: null })
  })
})
