import os
import json, numpy as np
from PIL import Image
d = os.environ.get('NS_DIR', '.') + '/img/'
r = json.load(open(d + 'results-after.json'))['burst']
w = [round(b['width'], 3) for b in r]; h = [round(b['height'], 3) for b in r]; t = [b['texel'] for b in r]
print('frames', len(r), 'distinct widths', sorted(set(w)), 'distinct heights', sorted(set(h)))
print('extent changes between consecutive frames', sum(1 for i in range(1, len(r)) if w[i] != w[i-1] or h[i] != h[i-1]))
bad = 0
for b in r:
    tx = b['width'] / b['mapSize']; ty = b['height'] / b['mapSize']
    if abs(b['left'] / tx - round(b['left'] / tx)) > 1e-4 or abs(b['bottom'] / ty - round(b['bottom'] / ty)) > 1e-4: bad += 1
print('frames with map origin off the texel grid', bad)
def lum(p):
    return np.asarray(Image.open(p).convert('L'), dtype=np.float32)
def diffs(prefix):
    ims = [lum(f'{d}{prefix}-{i:03d}.png') for i in range(90)]
    return np.array([np.abs(ims[i] - ims[i-1]).mean() for i in range(1, 90)]), ims
on, ims_on = diffs('burst-after')
off, ims_off = diffs('burstoff-after')
print('mean abs luminance step, shadows on %.3f off %.3f ratio %.3f' % (on.mean(), off.mean(), on.mean() / off.mean()))
# the shadow's own term: ratio image on/off, its frame-to-frame change relative to the camera-motion change
s = [np.log((a + 1) / (b + 1)) for a, b in zip(ims_on, ims_off)]
sd = np.array([np.abs(s[i] - s[i-1]).mean() for i in range(1, 90)])
print('mean abs step of the shadow term (log on/off): %.4f, max %.4f, p95 %.4f' % (sd.mean(), sd.max(), np.percentile(sd, 95)))
print('frames where on-step > 1.5x off-step:', int((on > 1.5 * off).sum()))
