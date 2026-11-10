import os
import json, sys
import numpy as np
d = json.load(open(sys.argv[1]))
keys = sys.argv[2].split(',') if len(sys.argv) > 2 else ['A', 'B', 'C25', 'C50']
for fid, data in d.items():
    if 'error' in data:
        print(fid, data['error']); continue
    rows = data['rows']
    for pose in ['real', 'low15']:
        print(f'== {fid} / {pose}  ({len(rows)} frames)')
        for k in keys:
            v = np.array([r[pose][k] for r in rows], dtype=float)
            ratio = np.maximum(v[1:], v[:-1]) / np.minimum(v[1:], v[:-1])
            n9 = int((ratio > 1.09).sum()); n25 = int((ratio > 1.25).sum()); n2 = int((ratio > 2).sum())
            share_near = float((v < 8000).mean())
            print(f'  {k:4s} >9%: {n9:4d}  >25%: {n25:4d}  >x2: {n2:4d}  max ratio {ratio.max():6.2f}  D min/median/max {v.min():7.0f} {np.median(v):7.0f} {v.max():7.0f}  frames D<8km {share_near:.0%}')
