import os
import subprocess, sys
d = os.environ.get('NS_DIR', '.') + '/img/'
for c in ['ground', 'close']:
    for p in ['0.2', '0.5', '0.8']:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{d}{c}-{p}-before.png', '-i', f'{d}{c}-{p}-after.png',
                        '-filter_complex', 'hstack=inputs=2', f'{d}sbs-{c}-{p}.png'], check=True)
        print(f'{d}sbs-{c}-{p}.png')
