import type { Messages } from '../messages'

const messages: Messages['keys'] = {
  'camera.group': 'Keyframe',
  'camera.prev': 'Keyframe precedente',
  'camera.next': 'Keyframe successivo',
  'camera.remove': 'Elimina il keyframe',
  'camera.add': 'Aggiungi un keyframe',
  'camera.removeTip': 'Elimina il keyframe sotto la testina di lettura',
  'camera.addTip': 'Aggiungi un keyframe: mantiene la vista 3D inquadrata sulla posizione del marcatore',
  'marker.group': 'Keyframe del marcatore',
  'marker.prev': 'Marcatore: keyframe precedente',
  'marker.prevTip': 'Vai al keyframe del marcatore precedente',
  'marker.remove': 'Marcatore: elimina il keyframe',
  'marker.add': 'Marcatore: aggiungi un keyframe',
  'marker.removeTip': 'Elimina il keyframe del marcatore sotto la testina di lettura',
  'marker.addTip': 'Aggiungi un keyframe del marcatore: da qui il marcatore cambia aspetto (sfera, figurina, immagine) con una dissolvenza',
  'marker.next': 'Marcatore: keyframe successivo',
  'marker.nextTip': 'Vai al keyframe del marcatore successivo',
  'param.group': 'Keyframe: {label}',
  'param.prev': '{label}: keyframe precedente',
  'param.prevTip': 'Vai al keyframe precedente ({label})',
  'param.remove': '{label}: elimina il keyframe',
  'param.add': '{label}: aggiungi un keyframe',
  'param.removeTip': 'Elimina il keyframe sotto la testina di lettura',
  'param.addTip': 'Aggiungi un keyframe sulla posizione del marcatore, con il valore attuale ({label})',
  'param.next': '{label}: keyframe successivo',
  'param.nextTip': 'Vai al keyframe successivo ({label})',
}

export default messages
