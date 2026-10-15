import type { Messages } from '../messages'

const messages: Messages['lens'] = {
  off: 'Off',
  'shutter.label': 'Sfocatura di movimento (otturatore)',
  'shutter.tip': 'Effetto velocità: i bordi dell’immagine sfilano nella direzione del movimento, il centro resta nitido, in base alla velocità della camera. In esportazione, ogni fotogramma fa anche la media di fino a 8 rendering (4 in qualità Standard) durante l’apertura dell’otturatore (esportazione più lunga quando la camera si muove veloce, nessun costo aggiuntivo da fermi).',
  'bloom.label': 'Bagliore',
  'bloom.tip': 'Le zone chiare irradiano luce: sole, neve, riflessi sull’acqua.',
  'dof.label': 'Profondità di campo',
  'dof.tip': 'Nitido sul marcatore, sempre più sfocato davanti e dietro.',
  title: 'Effetti obiettivo',
  'flare.label': 'Riflesso dell’obiettivo',
  'flare.tip': 'Riflessi nell’obiettivo quando il sole è nell’immagine. Solo con l’atmosfera.',
  'bloomRadius.label': 'Raggio del bagliore',
}

export default messages
