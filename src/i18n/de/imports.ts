import type { Messages } from '../messages'

const messages: Messages['imports'] = {
  failure: '{label}: {message}',
  failedOne: 'Import nicht möglich — {failure}',
  failedMany: 'Importe nicht möglich:\n{failures}',
  oneTrack: 'Track „{name}“ importiert',
  tracks: { one: '{count} Track importiert', other: '{count} Tracks importiert' },
  elevationComputed: '{text}, Höhe aus dem Gelände berechnet',
  'gpx.invalid': 'Ungültige GPX-Datei: {reason}',
  'gpx.empty': 'leere Datei',
  'gpx.xmlMalformed': 'fehlerhaftes XML ({detail})',
  'gpx.xmlMalformedPlain': 'fehlerhaftes XML',
  'gpx.notGpx': 'das Wurzelelement ist nicht <gpx>',
  'gpx.noPoint': 'kein Punkt gefunden',
  'gpx.defaultName': 'Track',
  'gpx.defaultPoint': 'Punkt {n}',
  'fit.invalid': 'Ungültige FIT-Datei: {reason}',
  'fit.noHeader': 'Header „.FIT“ fehlt',
  'fit.noDefinition': 'Nachricht ohne Definition',
  'fit.truncated': 'abgeschnittene Datei',
  'fit.tooShort': 'Datei zu kurz',
  'fit.decodeError': 'kein Punkt und ein Dekodierungsfehler ({error})',
  'fit.noPosition': 'kein Datensatz mit Position',
  'fit.defaultName': 'FIT-Aktivität',
  'chainError.needTwo': 'Zum Verketten sind mindestens zwei Tracks nötig.',
  'chainError.overlap': '„{a}“ und „{b}“ wurden zur selben Zeit aufgezeichnet: Sie lassen sich nicht verketten.',
  unsupported: 'Nicht unterstütztes Format: {shown} (unterstützte Formate: .gpx, .fit)',
}

export default messages
