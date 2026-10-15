import type { Messages } from '../messages'

const messages: Messages['platform'] = {
  'error.writeStopped': 'La scrittura del file si è interrotta.',
  'error.folderWrite': 'Questo browser non sa scrivere in una cartella.',
  'error.folderRead': 'Questo browser non sa leggere una cartella.',
  'error.diskWrite': 'Questo browser non sa scrivere direttamente su disco.',
  'oauth.cancelled': 'Connessione annullata',
  'oauth.popupBlocked': 'Finestra di connessione bloccata: consenti i popup per questo sito.',
  'oauth.desktopDone': 'Connessione trasmessa a OpenFlyover: puoi chiudere questa scheda.',
  'library.invalidId': 'ID progetto non valido: {id}',
  'library.emptyName': 'Il nome del progetto è vuoto.',
  'library.gone': 'Questo progetto non è più in «I miei progetti».',
  'app.updateAvailable': 'Nuova versione disponibile',
  'app.iosInstall': 'Per installare OpenFlyover: tocca Condividi, poi «Aggiungi alla schermata Home».',
  'app.reload': 'Ricarica',
  'app.gotIt': 'Ho capito',
  shareSave: 'Condividi / Salva',
  encoderNative: 'installa ffmpeg (sudo apt install ffmpeg), che codifica il video su questo sistema, poi riavvia l’applicazione; l’immagine fissa resta disponibile qui.',
  encoderTouch: 'questo browser non codifica il video (WebCodecs). Su telefono o tablet, esporta da Chrome (Android) o Safari 16.4 o successivo (iPhone, iPad); l’immagine fissa resta disponibile qui.',
  encoderMissing: 'manca la codifica video (WebCodecs). Esporta da Chrome, Edge o un Firefox recente; l’immagine fissa resta disponibile qui.',
  'error.noUpdate': 'Nessun aggiornamento da installare: esegui prima la ricerca.',
}

export default messages
