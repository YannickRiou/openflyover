import type { Messages } from '../messages'

const messages: Messages['platform'] = {
  'error.writeStopped': 'Das Schreiben der Datei wurde gestoppt.',
  'error.folderWrite': 'Dieser Browser kann nicht in einen Ordner schreiben.',
  'error.folderRead': 'Dieser Browser kann keinen Ordner lesen.',
  'error.diskWrite': 'Dieser Browser kann nicht direkt auf die Festplatte schreiben.',
  'oauth.cancelled': 'Anmeldung abgebrochen',
  'oauth.popupBlocked': 'Anmeldefenster blockiert: Pop-ups für diese Seite erlauben.',
  'oauth.desktopDone': 'Anmeldung an OpenFlyover übergeben: Dieser Tab kann geschlossen werden.',
  'library.invalidId': 'Ungültige Projektkennung: {id}',
  'library.emptyName': 'Der Projektname ist leer.',
  'library.gone': 'Dieses Projekt ist nicht mehr in „Meine Projekte“.',
  'library.versionGone': 'Diese Version gibt es nicht mehr.',
  'app.updateAvailable': 'Neue Version verfügbar',
  'app.iosInstall': 'OpenFlyover installieren: auf „Teilen“ tippen, dann auf „Zum Home-Bildschirm“.',
  'app.reload': 'Neu laden',
  'app.gotIt': 'Verstanden',
  shareSave: 'Teilen / Speichern',
  encoderNative: 'ffmpeg installieren (sudo apt install ffmpeg), das das Video auf diesem System kodiert, dann die App neu starten; das Standbild bleibt hier verfügbar.',
  encoderTouch: 'dieser Browser kann kein Video speichern. Auf Smartphone oder Tablet aus Chrome (Android) oder Safari 16.4 oder neuer (iPhone, iPad) exportieren; das Standbild bleibt hier verfügbar.',
  encoderMissing: 'dieser Browser kann kein Video speichern. Aus Chrome, Edge oder einem aktuellen Firefox exportieren; das Standbild bleibt hier verfügbar.',
  'error.noUpdate': 'Kein Update zu installieren: zuerst die Suche starten.',
}

export default messages
