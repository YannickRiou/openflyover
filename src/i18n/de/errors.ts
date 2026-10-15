import type { Messages } from '../messages'

const messages: Messages['errors'] = {
  'boundary.saveFailed': 'Das Projekt konnte nicht gespeichert werden: {error}',
  'boundary.unknown': 'Unbekannter Fehler',
  'boundary.title': 'Ein unerwarteter Fehler hat OpenFlyover unterbrochen.',
  'boundary.details': 'Details',
  'boundary.save': 'Projekt speichern',
  'boundary.reload': 'Neu laden',
  'name.quota': 'Nicht genug Speicherplatz: Platz schaffen und erneut versuchen.',
  'name.notAllowed': 'Berechtigung vom Browser oder vom System verweigert.',
  'name.security': 'Zugriff aus Sicherheitsgründen verweigert.',
  'name.notFound': 'Datei oder Ordner nicht gefunden.',
  'name.notReadable': 'Datei nicht lesbar: Sie wird möglicherweise von einem anderen Programm verwendet.',
  'name.abort': 'Vorgang abgebrochen.',
  'name.encoding': 'Kodierung oder Dekodierung fehlgeschlagen.',
  'name.notSupported': 'Format oder Funktion wird von diesem Browser nicht unterstützt.',
  'name.operation': 'Der Vorgang ist fehlgeschlagen.',
  'name.invalidState': 'Vorgang im aktuellen Zustand nicht möglich.',
  'text.denied': 'Zugriff verweigert: Zugriffsrechte der Datei oder des Ordners prüfen.',
  'text.noSpace': 'Nicht genug Speicherplatz auf dem Datenträger.',
  'text.inUse': 'Datei wird von einem anderen Programm verwendet.',
  unexpected: 'Unerwarteter Fehler ({text})',
  unknown: 'unbekannter Fehler',
  network: 'Verbindung nicht möglich: Internetverbindung prüfen.',
  noTrackInFile: 'kein Track in dieser Datei',
  compositionImage: 'Das Kompositionsbild kann nicht gelesen werden.',
}

export default messages
