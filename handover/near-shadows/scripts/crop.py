import os
import subprocess
d = os.environ.get('NS_DIR', '.') + '/img/'
# ground 0.5: lower-right shadow; close 0.8: left valley shadow edge
for name, crop in [('ground-0.5', '560:300:900:500'), ('close-0.8', '300:250:560:400')]:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{d}{name}-before.png', '-i', f'{d}{name}-after.png',
                    '-filter_complex', f'[0]crop={crop},scale=iw*2:ih*2:flags=neighbor[a];[1]crop={crop},scale=iw*2:ih*2:flags=neighbor[b];[a][b]hstack',
                    f'{d}crop-{name}.png'], check=True)
