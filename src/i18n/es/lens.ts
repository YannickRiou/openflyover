import type { Messages } from '../messages'

const messages: Messages['lens'] = {
  off: 'No',
  'shutter.label': 'Desenfoque de movimiento (obturador)',
  'shutter.tip': 'Efecto de velocidad: los bordes de la imagen se estiran en la dirección del movimiento y el centro se mantiene nítido, según la velocidad de la cámara. Al exportar, cada fotograma promedia además hasta 8 renders (4 en calidad Estándar) mientras el obturador está abierto (exportación más larga cuando la cámara se mueve deprisa, sin sobrecoste cuando está parada).',
  'bloom.label': 'Halo luminoso',
  'bloom.tip': 'Las zonas claras irradian luz: sol, nieve, reflejos en el agua.',
  'dof.label': 'Profundidad de campo',
  'dof.tip': 'Nítido en el marcador, cada vez más borroso por delante y por detrás.',
  title: 'Efectos de objetivo',
  'flare.label': 'Destello de lente',
  'flare.tip': 'Reflejos en el objetivo cuando el sol aparece en la imagen. Solo con la atmósfera.',
  'bloomRadius.label': 'Radio del halo',
}

export default messages
