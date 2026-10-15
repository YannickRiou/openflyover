import type { Messages } from '../messages'

const messages: Messages['lens'] = {
  off: 'Aus',
  'shutter.label': 'Bewegungsunschärfe (Verschluss)',
  'shutter.tip': 'Geschwindigkeitseffekt: Die Bildränder ziehen je nach Kamerageschwindigkeit in Bewegungsrichtung, die Mitte bleibt scharf. Beim Export mittelt jedes Bild außerdem bis zu 8 Renderings (4 in der Qualität Standard) während der Verschlussöffnung (längerer Export bei schnell bewegter Kamera, kein Mehraufwand im Stillstand).',
  'bloom.label': 'Leuchten',
  'bloom.tip': 'Helle Bereiche strahlen: Sonne, Schnee, Spiegelungen auf dem Wasser.',
  'dof.label': 'Tiefenschärfe',
  'dof.tip': 'Scharf auf dem Marker, davor und dahinter zunehmend unscharf.',
  title: 'Objektiveffekte',
  'flare.label': 'Linsenreflex',
  'flare.tip': 'Reflexe im Objektiv, wenn die Sonne im Bild ist. Nur mit Atmosphäre.',
  'bloomRadius.label': 'Leuchtradius',
}

export default messages
