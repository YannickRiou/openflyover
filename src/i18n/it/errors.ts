import type { Messages } from '../messages'

const messages: Messages['errors'] = {
  'boundary.saveFailed': 'Impossibile salvare il progetto: {error}',
  'boundary.unknown': 'Errore sconosciuto',
  'boundary.title': 'Un errore imprevisto ha interrotto OpenFlyover.',
  'boundary.details': 'Dettagli',
  'boundary.save': 'Salva il progetto',
  'boundary.reload': 'Ricarica',
  'name.quota': 'Spazio di archiviazione insufficiente: libera dello spazio e riprova.',
  'name.notAllowed': 'Autorizzazione negata dal browser o dal sistema.',
  'name.security': 'Accesso negato per motivi di sicurezza.',
  'name.notFound': 'File o cartella non trovati.',
  'name.notReadable': 'File illeggibile: potrebbe essere in uso in un altro programma.',
  'name.abort': 'Operazione interrotta.',
  'name.encoding': 'Codifica o decodifica non riuscita.',
  'name.notSupported': 'Formato o funzione non supportati da questo browser.',
  'name.operation': 'Operazione non riuscita.',
  'name.invalidState': 'Operazione impossibile nello stato attuale.',
  'text.denied': 'Accesso negato: verifica i permessi sul file o sulla cartella.',
  'text.noSpace': 'Spazio su disco insufficiente.',
  'text.inUse': 'File in uso in un altro programma.',
  unexpected: 'Errore imprevisto ({text})',
  unknown: 'errore sconosciuto',
  network: 'Connessione impossibile: verifica la connessione a internet.',
  noTrackInFile: 'nessuna traccia in questo file',
  compositionImage: 'Impossibile leggere l’immagine di composizione.',
}

export default messages
