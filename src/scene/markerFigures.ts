/**
 * Pictograms of the « figurine » markers: SVG path data on a 24 × 24 grid, stroked with round caps and joins at
 * width 2 like the interface icons, every figure moving to the right (the marker mirrors it when the track heads
 * left on screen). Shared by the marker badge (canvas `Path2D`) and the chips of the interface (inline SVG).
 *
 * The bike of « cycliste » and the car of « voiture » follow Lucide's `bike` and `car` (ISC License, notice in
 * `src/ui/icons.tsx`); the other figures are drawn in the same style.
 */
import type { MarkerFigure } from './markerSettings'

/** Side of the drawing grid of the pictograms. */
export const FIGURE_GRID = 24

/** Circle as path data (two arcs), so that every part of a figure is one path string. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

export const MARKER_FIGURE_PATHS: Record<MarkerFigure, readonly string[]> = {
  randonneur: [
    circlePath(13, 4, 2),
    'M12.5 7 11 13',
    // backpack, behind the shoulders
    'M12 7.5 9.2 8.3 8.6 12.2 11.2 12.6',
    'M12.2 8.6 15 11.5',
    // walking pole
    'M15.3 9.8 16.8 22',
    'M11 13 13.4 17.2 13.6 22',
    'M11 13 9.6 17.5 7.5 21.6',
  ],
  alpiniste: [
    circlePath(11.5, 4.3, 2),
    'M11 7 9.8 12.6',
    // ice axe planted ahead: arm, shaft, head
    'M10.8 8.4 15.4 8.8',
    'M15.4 8.8 17.4 4.6',
    'M16 3.6 19.4 5',
    // legs on a steep slope
    'M9.8 12.6 13 15 14.4 19.6',
    'M9.8 12.6 8.6 17 6.8 20.9',
    'M2 22 22 18.4',
  ],
  coureur: [
    circlePath(15, 4, 2),
    'M14 7 11.5 12.5',
    'M13.6 8.2 16 11 18 9.5',
    'M13.6 8.2 10.6 9.6 9.2 12.4',
    'M11.5 12.5 15 15 14 20',
    'M11.5 12.5 9.8 16.6 6 17.6',
  ],
  traileur: [
    circlePath(15, 3.6, 2),
    'M14 6.4 11.6 11.6',
    // running vest on the back, one arm swinging forward
    'M13.6 7 11.2 7.4 10.4 10.6 12.2 10.8',
    'M13.6 7.6 16 10.2 18 8.8',
    'M11.6 11.6 15 14 14.4 17.4',
    'M11.6 11.6 10 15.2 6.6 16.2',
    // rocky ground
    'M2 21.5 5.5 19 9 20.5 13 18.8 17 20.4 22 18',
  ],
  cycliste: [circlePath(18.5, 17.5, 3.5), circlePath(5.5, 17.5, 3.5), circlePath(15, 5, 1), 'M12 17.5V14l-3-3 4-3 2 3h2'],
  vae: [
    circlePath(18.5, 17.5, 3.5),
    circlePath(5.5, 17.5, 3.5),
    circlePath(15, 5, 1),
    'M12 17.5V14l-3-3 4-3 2 3h2',
    // lightning bolt above the rear wheel
    'M6.2 2.5 3.4 7.4h3.2L5.6 11.6l3.4-5.2H5.9Z',
  ],
  bikepacking: [
    circlePath(18.5, 17.5, 3.5),
    circlePath(5.5, 17.5, 3.5),
    circlePath(15, 5, 1),
    'M12 17.5V14l-3-3 4-3 2 3h2',
    // bags: under the saddle, in the frame, on the handlebar
    'M8.6 9.8 5.2 10.6 6.2 12.4 9.4 11.6',
    'M10 11.6 12 13.4 12.6 10.2',
    'M17.4 9.6h2.6',
  ],
  vtt: [
    circlePath(18.5, 16.5, 3.5),
    circlePath(5.5, 16.5, 3.5),
    circlePath(15, 4, 1),
    'M12 16.5V13l-3-3 4-3 2 3h2',
    // rough ground under the wheels
    'M2 22.5 7 21.2 11 22.3 16 21 22 22',
  ],
  skieur: [
    circlePath(12.5, 4.3, 2),
    'M11.5 7 9.5 12',
    'M11.2 8 14.6 10.4',
    // pole, then the two legs on the ski
    'M14.6 10.4 17.2 19.8',
    'M9.5 12 13 14 11.5 18.5',
    'M9.5 12 11 15 8.5 17.6',
    'M3 16 21.5 21.5',
  ],
  'ski-rando': [
    circlePath(12.5, 4, 2),
    'M12 6.8 10.6 12.4',
    // backpack, the pole planted ahead, the legs striding up the slope on the ski
    'M11.6 7.4 8.8 8.4 8.4 11.6 10.8 11.8',
    'M11.8 8.4 15 10.6',
    'M15 10.6 16 16.6',
    'M10.6 12.4 13.2 14.6 13.4 17.4',
    'M10.6 12.4 9 15.4 7.6 19',
    'M2 21 22 15',
  ],
  nageur: [
    // front crawl: the head out of the water, one arm reaching ahead
    circlePath(17.5, 11, 2),
    'M14.8 12.4 3 14.4',
    'M12 12.8 14.6 7 20.6 8.2',
    'M2 18.5c1.7 0 1.7-1.2 3.3-1.2s1.7 1.2 3.3 1.2 1.7-1.2 3.3-1.2 1.7 1.2 3.4 1.2 1.7-1.2 3.3-1.2 1.7 1.2 3.4 1.2',
  ],
  kayak: [
    // the hull, the paddler sitting in it, the double paddle across
    'M2 16.4C6 19.4 18 19.4 22 16.4C18 15 6 15 2 16.4Z',
    circlePath(11, 5.6, 2),
    'M10.9 8.2 10.2 15.2',
    'M10.8 9.8 14.2 8.1',
    'M7.2 13.6 18.4 4.8',
    'M17.7 3.9 19.1 5.7',
    'M6.5 12.7 7.9 14.5',
  ],
  cavalier: [
    // the horse: body, neck and head to the right, legs and tail; the rider on its back holding the reins
    'M5.5 10.5h9a1.75 1.75 0 0 1 0 3.5h-9a1.75 1.75 0 0 1 0-3.5Z',
    'M14.6 10.8 17.6 5.4 21 8.4',
    'M5.6 14 4.8 20.5',
    'M8 14 8.6 20.5',
    'M13.6 14 13 20.5',
    'M15.6 13.8 17 20.2',
    'M3.9 11.6C2.6 12.4 2.2 14.2 2.4 16.4',
    circlePath(10.6, 3.4, 1.6),
    'M10.4 5.4 9.8 10',
    'M10.2 7.2 15.4 8.2',
  ],
  parapente: [
    // the wing, then the lines down to the pilot
    'M3 8C6 3.5 18 3.5 21 8C18 6.3 6 6.3 3 8Z',
    'M4 8 11.2 16',
    'M20 8 12.8 16',
    circlePath(12, 17.3, 1.4),
    'M10.2 20.2h3.6l1.2 1.6',
  ],
  moto: [
    circlePath(5, 17.5, 3),
    circlePath(19, 17.5, 3),
    // body: tank and seat, engine block, fork; the rider bent over the tank
    'M6 12.5h5l1.5-2h4l2.5 7',
    'M8.5 13.5h5.5v4H8.5Z',
    'M16.5 10.5 15.8 7.8h2.4',
    circlePath(11, 4.6, 1.6),
    'M10.4 6.4 8.6 10.4',
    'M10 7.6 15 8.8',
  ],
  voiture: [
    'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
    circlePath(7, 17, 2),
    'M9 17h6',
    circlePath(17, 17, 2),
  ],
  avion: [
    // fuselage nose to the right, tail fin, wing under the body, propeller
    'M2.5 12.5h15.5a2.5 1.6 0 0 0 0-3.2H6.2L3.6 5.6H2l.5 6.9Z',
    'M8.5 12.5 11 19.5h2.2l-.8-7',
    'M21.6 7v7.4',
  ],
}
