import type { Messages } from '../messages'

const messages: Messages['keys'] = {
  'camera.group': 'Keyframes',
  'camera.prev': 'Vorheriger Keyframe',
  'camera.next': 'Nächster Keyframe',
  'camera.remove': 'Keyframe löschen',
  'camera.add': 'Keyframe hinzufügen',
  'camera.removeTip': 'Keyframe unter dem Abspielkopf löschen',
  'camera.addTip': 'Keyframe hinzufügen: hält die 3D-Ansicht an der Position des Markers fest',
  'marker.group': 'Marker-Keyframes',
  'marker.prev': 'Marker: vorheriger Keyframe',
  'marker.prevTip': 'Zum vorherigen Marker-Keyframe springen',
  'marker.select': 'Marker: Keyframe auswählen',
  'marker.add': 'Marker: Keyframe hinzufügen',
  'marker.selectTip': 'Marker-Keyframe unter dem Abspielkopf im Inspektor öffnen',
  'marker.addTip': 'Marker-Keyframe hinzufügen: An dieser Stelle wechselt der Marker sein Aussehen (Kugel, Figur, Bild) per Überblendung',
  'marker.next': 'Marker: nächster Keyframe',
  'marker.nextTip': 'Zum nächsten Marker-Keyframe springen',
  'param.group': 'Keyframes: {label}',
  'param.prev': '{label}: vorheriger Keyframe',
  'param.prevTip': 'Zum vorherigen Keyframe springen ({label})',
  'param.select': '{label}: Keyframe auswählen',
  'param.add': '{label}: Keyframe hinzufügen',
  'param.selectTip': 'Keyframe unter dem Abspielkopf im Inspektor öffnen',
  'param.addTip': 'Keyframe an der Position des Markers mit dem aktuellen Wert hinzufügen ({label})',
  'param.next': '{label}: nächster Keyframe',
  'param.nextTip': 'Zum nächsten Keyframe springen ({label})',
}

export default messages
