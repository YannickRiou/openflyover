import type { Messages } from '../messages'

const messages: Messages['lens'] = {
  off: 'Off',
  'shutter.label': 'Motion blur (shutter)',
  'shutter.tip': 'Speed effect: the edges of the image streak towards the direction of movement while the centre stays sharp, depending on the camera speed. On export, each frame also averages up to 8 renders (4 in Standard quality) while the shutter is open (longer export when the camera moves fast, no extra cost when it is still).',
  'bloom.label': 'Bloom',
  'bloom.tip': 'Bright areas glow: sun, snow, reflections on water.',
  'dof.label': 'Depth of field',
  'dof.tip': 'Sharp on the marker, increasingly blurred in front and behind.',
  title: 'Lens effects',
  'flare.label': 'Lens flare',
  'flare.tip': 'Reflections in the lens when the sun is in the frame. With the atmosphere only.',
  'bloomRadius.label': 'Bloom radius',
}

export default messages
