import type { Messages } from '../messages'

const messages: Messages['errors'] = {
  'boundary.saveFailed': 'Could not save the project: {error}',
  'boundary.unknown': 'Unknown error',
  'boundary.title': 'An unexpected error stopped OpenFlyover.',
  'boundary.details': 'Details',
  'boundary.save': 'Save the project',
  'boundary.reload': 'Reload',
  'name.quota': 'Not enough storage space: free up some space and try again.',
  'name.notAllowed': 'Permission denied by the browser or the system.',
  'name.security': 'Access denied for security reasons.',
  'name.notFound': 'File or folder not found.',
  'name.notReadable': 'Unreadable file: it may be in use by another program.',
  'name.abort': 'Operation interrupted.',
  'name.encoding': 'Encoding or decoding failed.',
  'name.notSupported': 'Format or feature not supported by this browser.',
  'name.operation': 'The operation failed.',
  'name.invalidState': 'Operation not possible in the current state.',
  'text.denied': 'Access denied: check the access rights of the file or folder.',
  'text.noSpace': 'Not enough disk space.',
  'text.inUse': 'File in use by another program.',
  unexpected: 'Unexpected error ({text})',
  unknown: 'unknown error',
  network: 'Unable to connect: check your internet connection.',
  noTrackInFile: 'no track in this file',
  compositionImage: 'Unable to read the composition image.',
}

export default messages
