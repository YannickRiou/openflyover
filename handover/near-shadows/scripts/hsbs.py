import os
import json, subprocess, sys
base = os.environ.get('NS_DIR', '.') + '/'
tagname = sys.argv[1] if len(sys.argv) > 1 else 'h1'
dirn = base + (sys.argv[2] if len(sys.argv) > 2 else 'hor') + '/'
r = json.load(open(f'{dirn}results-{tagname}.json'))['views']
by = {}
for v in r:
    by.setdefault((v['p'], v['pitch'], v['sun']), {})[v['mode']] = v
for (p, pitch, sun), m in by.items():
    t = f'h{p}-p{pitch}-s{sun}'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{dirn}{t}-before.png', '-i', f'{dirn}{t}-after.png',
                    '-filter_complex', 'hstack', f'{dirn}sbs-{t}.png'], check=True)
    y = int(min(max(m['after']['bandY'], 0.12), 0.88) * 821) - 100
    y = max(0, min(y, 821 - 200))
    crop = f'1460:200:0:{y}'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{dirn}{t}-before.png', '-i', f'{dirn}{t}-after.png',
                    '-filter_complex', f'[0]crop={crop},scale=iw*2:ih*2[a];[1]crop={crop},scale=iw*2:ih*2[b];[a][b]vstack', f'{dirn}band-{t}.png'], check=True)
    print(t, 'before D=%.0f texel=%.2f | after D=%.0f aim=%.0f texel=%.2f bandY=%.2f' % (m['before']['distance'], m['before']['texel'], m['after']['distance'], m['after']['aim'] or -1, m['after']['texel'], m['after']['bandY']))
