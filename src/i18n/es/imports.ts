import type { Messages } from '../messages'

const messages: Messages['imports'] = {
  failure: '{label}: {message}',
  failedOne: 'No se puede importar — {failure}',
  failedMany: 'No se pueden importar:\n{failures}',
  oneTrack: 'Track «{name}» importado',
  tracks: { one: '{count} track importado', other: '{count} tracks importados' },
  elevationComputed: '{text}, altitud calculada a partir del relieve',
  'gpx.invalid': 'Archivo GPX no válido: {reason}',
  'gpx.empty': 'archivo vacío',
  'gpx.xmlMalformed': 'XML mal formado ({detail})',
  'gpx.xmlMalformedPlain': 'XML mal formado',
  'gpx.notGpx': 'el elemento raíz no es <gpx>',
  'gpx.noPoint': 'no se ha encontrado ningún punto',
  'gpx.defaultName': 'Track',
  'gpx.defaultPoint': 'Punto {n}',
  'fit.invalid': 'Archivo FIT no válido: {reason}',
  'fit.noHeader': 'falta la cabecera «.FIT»',
  'fit.noDefinition': 'mensaje sin definición',
  'fit.truncated': 'archivo truncado',
  'fit.tooShort': 'archivo demasiado corto',
  'fit.decodeError': 'ningún punto y un error de decodificación ({error})',
  'fit.noPosition': 'ningún registro con posición',
  'fit.defaultName': 'Actividad FIT',
  'chainError.needTwo': 'Se necesitan al menos dos tracks para encadenarlos.',
  'chainError.overlap': '«{a}» y «{b}» se grabaron al mismo tiempo: no se pueden encadenar.',
  unsupported: 'Formato no admitido: {shown} (formatos aceptados: .gpx, .fit)',
}

export default messages
