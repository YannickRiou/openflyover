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
  'marker.prev': 'Marcador: clave anterior',
  'marker.prevTip': 'Ir a la clave de marcador anterior',
  'marker.select': 'Marcador: seleccionar la clave',
  'marker.add': 'Marcador: añadir una clave',
  'marker.selectTip': 'Abrir en el inspector la clave de marcador bajo el cabezal de reproducción',
  'marker.addTip': 'Añadir una clave de marcador: desde aquí, el marcador cambia de aspecto (bola, figura, imagen) con un fundido',
  'marker.next': 'Marcador: clave siguiente',
  'marker.nextTip': 'Ir a la clave de marcador siguiente',
  'param.group': 'Claves: {label}',
  'param.prev': '{label}: clave anterior',
  'param.prevTip': 'Ir a la clave anterior ({label})',
  'param.select': '{label}: seleccionar la clave',
  'param.add': '{label}: añadir una clave',
  'param.selectTip': 'Abrir en el inspector la clave bajo el cabezal de reproducción',
  'param.addTip': 'Añadir una clave en la posición del marcador, con el valor actual ({label})',
  'param.next': '{label}: clave siguiente',
  'param.nextTip': 'Ir a la clave siguiente ({label})',
}

export default messages
