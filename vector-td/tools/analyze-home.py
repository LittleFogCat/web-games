# Pixel-statistics analysis for a homepage screenshot.
# Usage: python analyze-home.py <screenshot.png>
import sys
from collections import Counter
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
print('size:', img.size)
small = img.resize((img.width // 2, img.height // 2))
px = list(small.getdata())
lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in px]
print('mean lum: %.1f, min: %.0f, max: %.0f' % (sum(lum) / len(lum), min(lum), max(lum)))
cnt = Counter(px)
print('top colors:')
for c, n in cnt.most_common(8):
    print('  rgb%-15s %5.1f%%' % (str(c), 100 * n / len(px)))
W, H = img.size
print('brightness by horizontal band:')
for i in range(10):
    box = img.crop((0, H * i // 10, W, H * (i + 1) // 10))
    d = list(box.getdata())
    l = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in d) / len(d)
    sat = sum(max(p) - min(p) for p in d) / len(d)
    print('  band %d: lum %.1f, sat %.1f' % (i, l, sat))
