import sys
from PIL import Image, ImageStat
for f in sys.argv[1:]:
    im = Image.open(f).convert('RGB')
    w, h = im.size
    g = im.convert('L')
    corner = ImageStat.Stat(g.crop((0, 0, w // 8, h // 8))).mean[0]
    centre = ImageStat.Stat(g.crop((w * 3 // 8, h * 3 // 8, w * 5 // 8, h * 5 // 8))).mean[0]
    sat = ImageStat.Stat(im.convert('HSV').split()[1]).mean[0]
    print(f.split('/')[-1], 'corner %.2f centre %.2f meanSaturation %.2f' % (corner, centre, sat))
