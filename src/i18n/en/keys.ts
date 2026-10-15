import type { Messages } from '../messages'

const messages: Messages['keys'] = {
  'camera.group': 'Keyframes',
  'camera.prev': 'Previous keyframe',
  'camera.next': 'Next keyframe',
  'camera.remove': 'Delete the keyframe',
  'camera.add': 'Add a keyframe',
  'camera.removeTip': 'Delete the keyframe under the playhead',
  'camera.addTip': 'Add a keyframe: keeps the 3D view framed at the marker position',
  'marker.group': 'Marker keyframes',
  'marker.prev': 'Marker: previous keyframe',
  'marker.prevTip': 'Go to the previous marker keyframe',
  'marker.remove': 'Marker: delete the keyframe',
  'marker.add': 'Marker: add a keyframe',
  'marker.removeTip': 'Delete the marker keyframe under the playhead',
  'marker.addTip': 'Add a marker keyframe: from here, the marker fades into a different look (ball, figurine, image)',
  'marker.next': 'Marker: next keyframe',
  'marker.nextTip': 'Go to the next marker keyframe',
  'param.group': 'Keyframes: {label}',
  'param.prev': '{label}: previous keyframe',
  'param.prevTip': 'Go to the previous keyframe ({label})',
  'param.remove': '{label}: delete the keyframe',
  'param.add': '{label}: add a keyframe',
  'param.removeTip': 'Delete the keyframe under the playhead',
  'param.addTip': 'Add a keyframe at the marker position, with the current value ({label})',
  'param.next': '{label}: next keyframe',
  'param.nextTip': 'Go to the next keyframe ({label})',
}

export default messages
