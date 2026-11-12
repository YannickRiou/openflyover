import type { Messages } from '../messages'

const messages: Messages['keys'] = {
  'camera.group': 'Fotogramas clave',
  'camera.prev': 'Fotograma clave anterior',
  'camera.next': 'Fotograma clave siguiente',
  'camera.remove': 'Eliminar el fotograma clave',
  'camera.add': 'Añadir un fotograma clave',
  'camera.removeTip': 'Eliminar el fotograma clave bajo el cabezal de reproducción',
  'camera.addTip': 'Añadir un fotograma clave: mantiene la vista 3D encuadrada en la posición del marcador',
  'marker.group': 'Claves del marcador',
  'marker.prev': 'Marcador: fotograma clave anterior',
  'marker.prevTip': 'Ir al fotograma clave de marcador anterior',
  'marker.remove': 'Marcador: eliminar el fotograma clave',
  'marker.add': 'Marcador: añadir un fotograma clave',
  'marker.removeTip': 'Eliminar el fotograma clave de marcador bajo el cabezal de reproducción',
  'marker.addTip': 'Añadir un fotograma clave de marcador: desde aquí, el marcador cambia de aspecto (bola, figura, imagen) con un fundido',
  'marker.next': 'Marcador: fotograma clave siguiente',
  'marker.nextTip': 'Ir al fotograma clave de marcador siguiente',
  'param.group': 'Claves: {label}',
  'param.prev': '{label}: fotograma clave anterior',
  'param.prevTip': 'Ir al fotograma clave anterior ({label})',
  'param.remove': '{label}: eliminar el fotograma clave',
  'param.add': '{label}: añadir un fotograma clave',
  'param.removeTip': 'Eliminar el fotograma clave bajo el cabezal de reproducción',
  'param.addTip': 'Añadir un fotograma clave en la posición del marcador, con el valor actual ({label})',
  'param.next': '{label}: fotograma clave siguiente',
  'param.nextTip': 'Ir al fotograma clave siguiente ({label})',
}

export default messages
