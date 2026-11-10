import sys
import json, subprocess, os
os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
r = json.load(open('results2.json'))['results']
get = lambda v, c: sorted([m for m in r if m['variant'] == v and m['config'] == c], key=lambda m: m['moment'])
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
NAMES = {'base': 'as today', 'a': 'line-of-sight rule off', 'd': 'line-of-sight + 80 m clearance + lead room off', 'f': 'those three + raise anticipation off'}
def still(v, c, i):
    return f'V5-{i}.png' if c == 'base' else f'W-{v}-{c}-{i}.png'
def sheet(v, c, out, title=None):
    ms = get(v, c)
    parts, ins = [], []
    for i, m in enumerate(ms):
        lab = f"{int(m['fraction']*100)} pct  axis {m['axisPitch']:.0f} deg  horizon {m['horizonFromTop']*100:.0f} pct from top  d {m['dist']:.0f} m  h {m['heightAbove']:.0f} m"
        parts.append(f"[{i}:v]scale=640:-1,drawtext=fontfile={F}:text='{lab}':x=6:y=h-26:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6[s{i}]")
        ins += ['-i', still(v, c, i)]
    t = title or f"{v} {NAMES[c]}  (asked pitch {'20' if v == 'V2' else '15'} deg)"
    fc = ';'.join(parts) + ';' + ''.join(f'[s{i}]' for i in range(5)) + f"hstack=inputs=5,drawtext=fontfile={F}:text='{t}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=0x113B54@0.9:boxborderw=6[o]"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', fc, '-map', '[o]', '-q:v', '3', out], check=True)
sheet('V4', 'd', 'sheetW-V4-d.jpg')
sheet('V4', 'f', 'sheetW-V4-f.jpg')
sheet('V5', 'd', 'sheetW-V5-d.jpg')
sheet('V5', 'f', 'sheetW-V5-f.jpg')
sheet('V5', 'a', 'sheetW-V5-a.jpg')
sheet('V5', 'base', 'sheetW-V5-base.jpg')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'sheetW-V5-base.jpg', '-i', 'sheetW-V5-a.jpg', '-filter_complex', 'vstack=inputs=2[o]', '-map', '[o]', '-q:v', '3', 'sheetW-V5-compare.jpg'], check=True)
