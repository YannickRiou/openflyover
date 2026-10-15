import type { Messages } from '../messages'

const messages: Messages['errors'] = {
  'boundary.saveFailed': 'No se ha podido guardar el proyecto: {error}',
  'boundary.unknown': 'Error desconocido',
  'boundary.title': 'Un error inesperado ha interrumpido OpenFlyover.',
  'boundary.details': 'Detalles',
  'boundary.save': 'Guardar el proyecto',
  'boundary.reload': 'Recargar',
  'name.quota': 'Espacio de almacenamiento insuficiente: libera espacio e inténtalo de nuevo.',
  'name.notAllowed': 'Permiso denegado por el navegador o el sistema.',
  'name.security': 'Acceso denegado por motivos de seguridad.',
  'name.notFound': 'Archivo o carpeta no encontrado.',
  'name.notReadable': 'Archivo ilegible: puede que lo esté usando otro programa.',
  'name.abort': 'Operación interrumpida.',
  'name.encoding': 'Error de codificación o decodificación.',
  'name.notSupported': 'Formato o función no admitidos por este navegador.',
  'name.operation': 'La operación ha fallado.',
  'name.invalidState': 'Operación imposible en el estado actual.',
  'text.denied': 'Acceso denegado: comprueba los permisos del archivo o de la carpeta.',
  'text.noSpace': 'Espacio en disco insuficiente.',
  'text.inUse': 'Archivo en uso por otro programa.',
  unexpected: 'Error inesperado ({text})',
  unknown: 'error desconocido',
  network: 'No se puede conectar: comprueba tu conexión a internet.',
  noTrackInFile: 'ningún track en este archivo',
  compositionImage: 'No se puede leer la imagen de composición.',
}

export default messages
