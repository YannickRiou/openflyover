import type { Messages } from '../messages'

const messages: Messages['platform'] = {
  'error.writeStopped': 'La escritura del archivo se ha interrumpido.',
  'error.folderWrite': 'Este navegador no puede escribir en una carpeta.',
  'error.folderRead': 'Este navegador no puede leer una carpeta.',
  'error.diskWrite': 'Este navegador no puede escribir directamente en el disco.',
  'oauth.cancelled': 'Conexión cancelada',
  'oauth.popupBlocked': 'Ventana de conexión bloqueada: permite las ventanas emergentes para este sitio.',
  'oauth.desktopDone': 'Conexión transmitida a OpenFlyover: puedes cerrar esta pestaña.',
  'library.invalidId': 'Identificador de proyecto no válido: {id}',
  'library.emptyName': 'El nombre del proyecto está vacío.',
  'library.gone': 'Este proyecto ya no está en «Mis proyectos».',
  'app.updateAvailable': 'Nueva versión disponible',
  'app.iosInstall': 'Para instalar OpenFlyover: toca Compartir y luego «Añadir a pantalla de inicio».',
  'app.reload': 'Recargar',
  'app.gotIt': 'Entendido',
  shareSave: 'Compartir / Guardar',
  encoderNative: 'instala ffmpeg (sudo apt install ffmpeg), que codifica el vídeo en este sistema, y reinicia la aplicación; la imagen fija sigue disponible aquí.',
  encoderTouch: 'este navegador no codifica vídeo (WebCodecs). En teléfono o tableta, exporta desde Chrome (Android) o Safari 16.4 o posterior (iPhone, iPad); la imagen fija sigue disponible aquí.',
  encoderMissing: 'falta la codificación de vídeo (WebCodecs). Exporta desde Chrome, Edge o un Firefox reciente; la imagen fija sigue disponible aquí.',
}

export default messages
