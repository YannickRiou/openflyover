import sys
import json, subprocess, os
os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
r = json.load(open('results.json'))
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for v in r['results']:
    ms = v['moments']
    parts = []
    ins = []
    for i, m in enumerate(ms):
        lab = f"{int(m['fraction']*100)}%  cam-marker {m['dist']:.0f} m  height {m['heightAbove']:.0f} m  pitch {m['pitch']:.0f}"
        parts.append(f"[{i}:v]scale=640:-1,drawtext=fontfile={F}:text='{lab}':x=8:y=h-28:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6[s{i}]")
        ins += ['-i', m['file']]
    d = sorted(m['dist'] for m in ms)
    title = f"{v['name']} (asked pitch {v['pitchAsked']} deg, camera.distance {v['setDistance']:.3f}, median real distance {d[2]:.0f} m)"
    fc = ';'.join(parts) + ';' + ''.join(f'[s{i}]' for i in range(5)) + f"hstack=inputs=5,drawtext=fontfile={F}:text='{title}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=0x113B54@0.9:boxborderw=6[o]"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', fc, '-map', '[o]', '-q:v', '3', f"sheet-{v['id']}.jpg"], check=True)
ins = []
for v in r['results']:
    ins += ['-i', f"sheet-{v['id']}.jpg"]
fc = ''.join(f'[{i}:v]' for i in range(5)) + 'vstack=inputs=5[o]'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', fc, '-map', '[o]', '-q:v', '3', 'sheet-ALL.jpg'], check=True)
for v in r['results']:
    print(v['id'], v['name'], f"camera.distance={v['setDistance']:.3f}")
    for m in v['moments']:
        print(f"  {int(m['fraction']*100)}% t={m['timeS']} d={m['dist']:.0f} h={m['heightAbove']:.0f} hMk={m['heightAboveMarker']:.0f} pitch={m['pitch']:.1f} raise={m['raiseM']:.0f} v={m['speed']:.0f} frame={m['frameM']:.0f} fh/s={m['framesPerS']:.2f}")
