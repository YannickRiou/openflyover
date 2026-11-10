import sys
import json, os
os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
r = json.load(open('results2.json'))['results']
by = {}
for m in r:
    by.setdefault((m['variant'], m['config']), []).append(m)
for k, ms in by.items():
    ms.sort(key=lambda m: m['moment'])
    print(k[0], k[1])
    print('  axis  ', ' '.join(f"{m['axisPitch']:5.1f}" for m in ms), '| hor', ' '.join(f"{m['horizonFromTop']:5.2f}" for m in ms))
    print('  c2m   ', ' '.join(f"{m['camToMarkerPitch']:5.1f}" for m in ms), '| dist', ' '.join(f"{m['dist']:5.0f}" for m in ms))
    print('  hGnd  ', ' '.join(f"{m['heightAbove']:5.0f}" for m in ms), '| hMk', ' '.join(f"{m['hAboveMarker']:5.0f}" for m in ms), '| hAim', ' '.join(f"{(m['hAboveAim'] if m['hAboveAim'] is not None else float('nan')):5.0f}" for m in ms))
    print('  aimY-mkY', ' '.join(f"{((m['aimY'] if m['aimY'] is not None else float('nan'))-m['markerY']):5.0f}" for m in ms), '| tgtY-mkY', ' '.join(f"{(m['targetY']-m['markerY']):5.0f}" for m in ms))
    print('  mkTop ', ' '.join(f"{m['markerShareFromTop']:5.2f}" for m in ms), '| inFrame', ' '.join(str(int(m['markerInFrame'])) for m in ms), '| los', ' '.join(f"{m['losMinClear']:5.0f}" for m in ms), '| hid', ' '.join(str(int(m['hidden'])) for m in ms), '| low', ' '.join(str(int(m['low'])) for m in ms))
