import type { Messages } from '../messages'

const messages: Messages['common'] = {
  close: 'Close',
  delete: 'Delete',
  closeEsc: 'Close (Esc)',
  undo: 'Undo',
  retry: 'Retry',
  cancel: 'Cancel',
  'modified.srOnly': ' (modified)',
  'modified.badge': 'modified',
  'modified.reset': 'Default',
  'modified.resetAria': 'Reset to default settings: {label}',
  'modified.resetTip': 'Go back to the default settings (Ctrl+Z to undo)',
  'modified.toast': 'Settings reset to default',
  closeMessage: 'Dismiss message',
  done: 'Done',
  save: 'Save',
  quoted: '“{text}”',
  yes: 'Yes',
  no: 'No',
}

export default messages
