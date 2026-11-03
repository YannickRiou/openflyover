import { Color } from 'three'
import type { Material } from 'three'
import { describe, expect, it } from 'vitest'
import { createPainter } from './markerGlbKit'

type Source = Material & { color: Color; name: string }
const source = (name: string, hex: string) => ({ name, color: new Color(hex) }) as unknown as Source

describe('createPainter', () => {
  const build = () => {
    const painter = createPainter({ main: 'Body', shade: 'Sleeve' })
    const body = painter.flat(source('Body', '#336699'))
    const sleeve = painter.flat(source('Sleeve', '#336699'))
    const boots = painter.flat(source('Boots', '#445566'))
    const outline = painter.shell(body)
    painter.setTrack(1, 0, 0)
    painter.setLight(1, 1, 1)
    return { painter, body, sleeve, boots, outline }
  }

  it('puts the colour of the track on its main part and a darker shade on the second, the rest keeping its own colour', () => {
    const { painter, body, sleeve, boots } = build()
    painter.paint()
    expect(body.color.getHex()).toBe(new Color(1, 0, 0).getHex())
    expect(sleeve.color.r).toBeCloseTo(0.7, 5)
    expect(boots.color.getHex()).toBe(new Color('#445566').getHex())
  })

  it('keeps every part in its own colour once natural, the main one too', () => {
    const { painter, body, sleeve } = build()
    painter.setNatural(true)
    painter.paint()
    expect(body.color.getHex()).toBe(new Color('#336699').getHex())
    expect(sleeve.color.getHex()).toBe(new Color('#336699').getHex())
    painter.setNatural(false)
    painter.paint()
    expect(body.color.getHex()).toBe(new Color(1, 0, 0).getHex())
  })

  it('draws the outline of a part as a darker shade of the colour it has', () => {
    const { painter, body, outline } = build()
    painter.setNatural(true)
    painter.paint()
    expect(outline.color.r).toBeCloseTo(body.color.r * 0.28, 5)
  })

  it('takes the colour of a material that has none from its name, and scales every own colour by the light', () => {
    const painter = createPainter({ main: 'Body', colors: { Frame: '#ff0000' } })
    const frame = painter.flat(source('Frame', '#ffffff'))
    painter.setLight(0.5, 0.5, 0.5)
    painter.paint()
    expect(frame.color.r).toBeCloseTo(0.5, 5)
    expect(frame.color.g).toBe(0)
  })
})
