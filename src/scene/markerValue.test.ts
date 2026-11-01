// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../import/__fixtures__/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { overlayFrameAt, prepareOverlayTrack } from '../overlay/data'
import { COUNTER_IDS } from '../overlay/settings'
import { DEFAULT_MARKER_VALUE, MARKER_VALUE_IDS, isValidMarkerValue } from './markerValue'
import { markerValueText, valueLookKey } from './markerValuePanel'

const frame = overlayFrameAt(prepareOverlayTrack(parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]), 0.5)

describe('marker value', () => {
  it('offers every counter of the overlay but the number of outings, and none by default', () => {
    expect(DEFAULT_MARKER_VALUE).toBe('aucune')
    expect(MARKER_VALUE_IDS).toEqual(COUNTER_IDS.filter((id) => id !== 'outings'))
    expect(isValidMarkerValue('aucune')).toBe(true)
    expect(isValidMarkerValue('slope')).toBe(true)
    expect(isValidMarkerValue('outings' as never)).toBe(false)
    expect(isValidMarkerValue('pression' as never)).toBe(false)
  })

  it('reads the figure like the overlay counters, null when off or not recorded', () => {
    expect(markerValueText('aucune', frame)).toBeNull()
    expect(markerValueText('altitude', null)).toBeNull()
    expect(markerValueText('altitude', frame)?.unit).toBe('m')
    expect(markerValueText('altitude', { ...frame, ele: undefined })).toBeNull()
  })

  it('draws the panel again when the overlay style or colours change', () => {
    const base = valueLookKey({ style: 'editorial', overrides: undefined })
    expect(valueLookKey({ style: 'editorial', overrides: { text: '#fff000' } })).not.toBe(base)
    expect(valueLookKey({ style: 'editorial', overrides: undefined })).toBe(base)
  })
})
