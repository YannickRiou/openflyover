import type { Messages } from '../messages'

const messages: Messages['platform'] = {
  'error.writeStopped': 'Writing the file stopped.',
  'error.folderWrite': 'This browser cannot write to a folder.',
  'error.folderRead': 'This browser cannot read a folder.',
  'error.diskWrite': 'This browser cannot write directly to disk.',
  'oauth.cancelled': 'Connection cancelled',
  'oauth.popupBlocked': 'Connection window blocked: allow pop-ups for this site.',
  'oauth.desktopDone': 'Connection passed on to OpenFlyover: you can close this tab.',
  'library.invalidId': 'Invalid project identifier: {id}',
  'library.emptyName': 'The project name is empty.',
  'library.gone': 'This project is no longer in “My projects”.',
  'app.updateAvailable': 'New version available',
  'app.iosInstall': 'To install OpenFlyover: tap Share, then “Add to Home Screen”.',
  'app.reload': 'Reload',
  'app.gotIt': 'Got it',
  shareSave: 'Share / Save',
  encoderNative: 'install ffmpeg (sudo apt install ffmpeg), which encodes the video on this system, then restart the app; the still image remains available here.',
  encoderTouch: 'this browser does not encode video (WebCodecs). On a phone or tablet, export from Chrome (Android) or Safari 16.4 or later (iPhone, iPad); the still image remains available here.',
  encoderMissing: 'video encoding (WebCodecs) is missing. Export from Chrome, Edge or a recent Firefox; the still image remains available here.',
}

export default messages
