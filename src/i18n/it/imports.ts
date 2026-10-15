import type { Messages } from '../messages'

const messages: Messages['imports'] = {
  failure: '{label}: {message}',
  failedOne: 'Importazione impossibile — {failure}',
  failedMany: 'Importazioni impossibili:\n{failures}',
  oneTrack: 'Traccia «{name}» importata',
  tracks: { one: '{count} traccia importata', other: '{count} tracce importate' },
  elevationComputed: '{text}, altitudine calcolata in base al rilievo',
  'gpx.invalid': 'File GPX non valido: {reason}',
  'gpx.empty': 'file vuoto',
  'gpx.xmlMalformed': 'XML malformato ({detail})',
  'gpx.xmlMalformedPlain': 'XML malformato',
  'gpx.notGpx': 'l’elemento radice non è <gpx>',
  'gpx.noPoint': 'nessun punto trovato',
  'gpx.defaultName': 'Traccia',
  'gpx.defaultPoint': 'Punto {n}',
  'fit.invalid': 'File FIT non valido: {reason}',
  'fit.noHeader': 'intestazione «.FIT» assente',
  'fit.noDefinition': 'messaggio senza definizione',
  'fit.truncated': 'file troncato',
  'fit.tooShort': 'file troppo corto',
  'fit.decodeError': 'nessun punto ed errore di decodifica ({error})',
  'fit.noPosition': 'nessuna registrazione con posizione',
  'fit.defaultName': 'Attività FIT',
  'chainError.needTwo': 'Servono almeno due tracce da concatenare.',
  'chainError.overlap': '«{a}» e «{b}» sono state registrate nello stesso momento: impossibile concatenarle.',
  unsupported: 'Formato non supportato: {shown} (formati accettati: .gpx, .fit)',
}

export default messages
