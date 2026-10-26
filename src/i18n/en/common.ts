import type { Messages } from '../messages'

const messages: Messages['common'] = {
  close: 'Close',
  delete: 'Delete',
  closeEsc: 'Close (Esc)',
  colorHex: 'Colour code (hex)',
  undo: 'Undo',
  retry: 'Retry',
  languageLoadFailed: 'Cannot load this language right now.',
  cancel: 'Cancel',
  'modified.srOnly': ' (modified)',
  'modified.resetAria': 'Reset to default settings: {label}',
  'modified.resetTip': 'Modified: go back to the default settings (Ctrl+Z to undo)',
  'modified.toast': 'Settings reset to default',
  messages: 'Messages',
  closeMessage: 'Dismiss message',
  done: 'Done',
  save: 'Save',
  quoted: '“{text}”',
  yes: 'Yes',
  no: 'No',
}

export default messages
