import type { Messages } from '../messages'

const messages: Messages['imports'] = {
  failure: '{label}: {message}',
  failedOne: 'Import failed — {failure}',
  failedMany: 'Imports failed:\n{failures}',
  oneTrack: 'Track “{name}” imported',
  tracks: { one: '{count} track imported', other: '{count} tracks imported' },
  elevationComputed: '{text}, elevation computed from the terrain',
  'gpx.invalid': 'Invalid GPX file: {reason}',
  'gpx.empty': 'empty file',
  'gpx.xmlMalformed': 'malformed XML ({detail})',
  'gpx.xmlMalformedPlain': 'malformed XML',
  'gpx.notGpx': 'the root element is not <gpx>',
  'gpx.noPoint': 'no point found',
  'gpx.defaultName': 'Track',
  'gpx.defaultPoint': 'Point {n}',
  'fit.invalid': 'Invalid FIT file: {reason}',
  'fit.noHeader': '“.FIT” header missing',
  'fit.noDefinition': 'message without a definition',
  'fit.truncated': 'truncated file',
  'fit.tooShort': 'file too short',
  'fit.decodeError': 'no point and a decoding error ({error})',
  'fit.noPosition': 'no record with a position',
  'fit.defaultName': 'FIT activity',
  'chainError.needTwo': 'At least two tracks are needed to chain them.',
  'chainError.overlap': '“{a}” and “{b}” were recorded at the same time: they cannot be chained.',
  unsupported: 'Unsupported format: {shown} (accepted formats: .gpx, .fit)',
}

export default messages
