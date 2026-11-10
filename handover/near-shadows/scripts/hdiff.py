import os
import json, sys, numpy as np
from PIL import Image
base = os.environ.get('NS_DIR', '.') + '/'
dirn = base + sys.argv[2] + '/'
r = json.load(open(f'{dirn}results-{sys.argv[1]}.json'))['views']
seen = set()
rows = []
for v in r:
    k = (v['p'], v['pitch'], v['sun'])
    if k in seen: continue
    seen.add(k)
    t = f'h{k[0]}-p{k[1]}-s{k[2]}'
    a = np.asarray(Image.open(f'{dirn}{t}-before.png').convert('L'), dtype=np.float32)
    b = np.asarray(Image.open(f'{dirn}{t}-after.png').convert('L'), dtype=np.float32)
    d = b - a  # negative = darker after (more shadow)
    # share of the frame darker/lighter by more than 8 levels, in 3 horizontal zones of the picture height
    h = d.shape[0]
    z = [d[int(h * i / 3):int(h * (i + 1) / 3)] for i in range(3)]
    print(t, 'mean diff top/mid/bottom third: %s' % ' '.join('%+.1f' % x.mean() for x in z),
          '| darker>8: %s' % ' '.join('%.1f%%' % (100 * (x < -8).mean()) for x in z),
          'lighter>8: %s' % ' '.join('%.1f%%' % (100 * (x > 8).mean()) for x in z))
    vis = np.clip(128 + d * 3, 0, 255).astype(np.uint8)
    Image.fromarray(vis).save(f'{dirn}diff-{t}.png')
